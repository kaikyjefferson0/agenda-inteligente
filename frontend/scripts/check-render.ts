// `npm run check:render` (D117): the CSP of the site in render.yaml must be
// exactly CONTENT_SECURITY_POLICY of csp.ts, and the VITE_API_BASE_URL of the
// build must be an origin its connect-src allows. Exits with 1 on any problem.
//
// A plain script and not a Vitest test: render.yaml sits at the root of the
// repository, outside the frontend container (docker-compose.yml mounts only
// ./frontend). Node 24 runs this TypeScript file directly (type stripping).
// Run it from the host or in CI, from frontend/.
//
// No YAML library: the script reads only the layout render.yaml uses (the site
// as an item of `services`, `headers` and `envVars` as lists of `key: value`
// maps, one per line) and reports any other layout instead of guessing.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apiBaseUrlProblem, CONTENT_SECURITY_POLICY } from '../csp.ts'

interface Line {
  number: number
  indent: number
  text: string
}

type Item = Record<string, string>

class LayoutError extends Error {
  constructor(line: Line, problem: string) {
    super(`linha ${line.number}: ${problem} ("${line.text}")`)
  }
}

/** Lines with content, without comment lines and blank lines. */
function contentLines(text: string): Line[] {
  return text
    .split(/\r?\n/)
    .map((raw, index) => ({
      number: index + 1,
      indent: raw.length - raw.trimStart().length,
      text: raw.trim(),
    }))
    .filter((line) => line.text !== '' && !line.text.startsWith('#'))
}

/** A scalar: plain, or double-quoted without escapes. */
function scalar(line: Line, raw: string): string {
  if (raw.startsWith('"')) {
    const inner = raw.slice(1, -1)
    if (!raw.endsWith('"') || raw.length < 2 || /["\\]/.test(inner)) {
      throw new LayoutError(line, 'use aspas duplas sem escapes, ou um valor sem aspas')
    }
    return inner
  }
  if (raw.startsWith("'") || raw.includes(' #')) {
    throw new LayoutError(line, 'use aspas duplas, sem comentário na mesma linha')
  }
  return raw
}

function keyValue(line: Line, text: string): [string, string] {
  const match = /^([A-Za-z][\w-]*):(?: (.*))?$/.exec(text)
  if (match === null) throw new LayoutError(line, 'esperava "chave: valor"')
  return [match[1], match[2] === undefined ? '' : scalar(line, match[2])]
}

/** The lines below `key:` at `indent`, up to the next line at that indent or less. */
function block(lines: Line[], indent: number, key: string): Line[] | null {
  const start = lines.findIndex((line) => line.indent === indent && line.text === `${key}:`)
  if (start === -1) return null
  const end = lines.findIndex((line, index) => index > start && line.indent <= indent)
  return lines.slice(start + 1, end === -1 ? undefined : end)
}

/** A list of maps: `- a: 1` followed by `b: 2` lines aligned with `a`. */
function listOfMaps(lines: Line[]): Item[] {
  const items: Item[] = []
  const itemIndent = lines[0]?.indent
  for (const line of lines) {
    if (line.indent === itemIndent && line.text.startsWith('- ')) {
      const [key, value] = keyValue(line, line.text.slice(2))
      items.push({ [key]: value })
    } else if (line.indent === (itemIndent ?? 0) + 2 && items.length > 0) {
      const [key, value] = keyValue(line, line.text)
      items[items.length - 1][key] = value
    } else {
      throw new LayoutError(line, 'esperava um item de lista ("- chave: valor") e as suas chaves')
    }
  }
  return items
}

/** The lines of each item of `services`. */
function services(lines: Line[]): Line[][] {
  const list = block(lines, 0, 'services') ?? []
  const groups: Line[][] = []
  for (const line of list) {
    if (line.indent === 2 && line.text.startsWith('- ')) {
      // The first key of the item becomes a line of its own, aligned with the others.
      groups.push([{ ...line, indent: 4, text: line.text.slice(2) }])
    } else if (groups.length > 0) {
      groups[groups.length - 1].push(line)
    }
  }
  return groups
}

function renderProblems(text: string): string[] {
  const lines = contentLines(text)
  const sites = services(lines).filter((service) =>
    service.some((line) => line.indent === 4 && line.text === 'runtime: static'),
  )
  if (sites.length !== 1) {
    return [`deve ter um único serviço com runtime: static; tem ${sites.length}`]
  }
  const site = sites[0]
  const problems: string[] = []

  const headers = listOfMaps(block(site, 4, 'headers') ?? [])
  // Render does not document which rule wins when two set the same header.
  const names = headers.map((header) => (header.name ?? '').toLowerCase())
  for (const name of new Set(names)) {
    if (names.filter((other) => other === name).length > 1) {
      problems.push(`o cabeçalho ${name} aparece em mais de uma regra do site`)
    }
  }

  const csp = headers.find((header) => header.name?.toLowerCase() === 'content-security-policy')
  if (csp === undefined) {
    problems.push('o site não tem o cabeçalho Content-Security-Policy')
  } else {
    if (csp.path !== '/*') {
      problems.push(`a CSP do site deve valer para /*, não para ${csp.path}`)
    }
    if (csp.value !== CONTENT_SECURITY_POLICY) {
      problems.push(
        'a CSP é diferente da de frontend/csp.ts\n' +
          `  render.yaml: ${csp.value}\n` +
          `  csp.ts:      ${CONTENT_SECURITY_POLICY}`,
      )
    }
  }

  const envVars = listOfMaps(block(site, 4, 'envVars') ?? [])
  const apiBaseUrl = envVars.find((envVar) => envVar.key === 'VITE_API_BASE_URL')?.value
  if (apiBaseUrl === undefined || apiBaseUrl === '') {
    problems.push('o site não tem um VITE_API_BASE_URL com valor')
  } else {
    const problem = apiBaseUrlProblem(apiBaseUrl)
    if (problem !== null) problems.push(problem)
  }

  return problems
}

const renderYaml = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'render.yaml')
let problems: string[]
try {
  problems = renderProblems(readFileSync(renderYaml, 'utf8'))
} catch (error) {
  if (!(error instanceof LayoutError)) throw error
  problems = [`formato que a conferência não lê, ${error.message}`]
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`render.yaml: ${problem}`)
  process.exit(1)
}
console.log('render.yaml: a CSP e o VITE_API_BASE_URL do site conferem com frontend/csp.ts')
