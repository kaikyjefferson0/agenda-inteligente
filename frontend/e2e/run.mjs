// `npm run test:e2e` (D102): starts the system of docker-compose.e2e.yml,
// prepares its database, runs Playwright and stops everything.
//
//   npm run test:e2e                      # the whole suite
//   npm run test:e2e -- --headed          # arguments go to `playwright test`
//   npm run test:e2e -- --keep            # leaves the system up afterwards
//
// The same script runs locally (Windows) and in CI (Linux), so it is plain Node.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = path.resolve(frontendDir, '..', 'docker-compose.e2e.yml')
const playwrightCli = path.resolve(frontendDir, 'node_modules', '@playwright', 'test', 'cli.js')
const logFile = path.resolve(frontendDir, 'test-results', 'docker-compose.log')

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const playwrightArgs = args.filter((arg) => arg !== '--keep')

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', cwd: frontendDir, ...options })
  if (result.error) throw result.error
  return result.status ?? 1
}

function compose(...composeArgs) {
  return run('docker', ['compose', '-f', composeFile, ...composeArgs])
}

function step(label, action) {
  const started = Date.now()
  console.log(`\n[e2e] ${label}`)
  const status = action()
  console.log(`[e2e] ${label}: ${((Date.now() - started) / 1000).toFixed(1)} s`)
  return status
}

function saveLogs() {
  mkdirSync(path.dirname(logFile), { recursive: true })
  const result = spawnSync('docker', ['compose', '-f', composeFile, 'logs', '--no-color'], {
    cwd: frontendDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  writeFileSync(logFile, `${result.stdout ?? ''}${result.stderr ?? ''}`)
  console.log(`[e2e] logs dos contêineres em ${logFile}`)
}

const started = Date.now()
let status = 0
try {
  // Leftovers of a run with --keep would carry yesterday's demo.
  step('removendo uma execução anterior', () => compose('down', '-v', '--remove-orphans'))
  // `up --build db` would build only what db needs (nothing): the API and the
  // frontend would come up from images of an earlier run, with old code.
  status = step('construindo as imagens da API e do frontend', () => compose('build', 'api', 'frontend'))
  if (status === 0) {
    status = step('subindo o banco', () => compose('up', '-d', '--wait', 'db'))
  }
  if (status === 0) {
    status = step('recriando o banco agenda_e2e e restaurando a demo', () =>
      compose('run', '--rm', 'api', 'python', '-m', 'app.scripts.prepare_e2e_database'),
    )
  }
  if (status === 0) {
    status = step('subindo a API e o build de produção do frontend', () =>
      compose('up', '-d', '--wait', 'api', 'frontend'),
    )
  }
  if (status === 0) {
    status = step('rodando o Playwright', () =>
      run(process.execPath, [playwrightCli, 'test', ...playwrightArgs]),
    )
  }
  if (status !== 0) saveLogs()
} finally {
  if (keep) {
    console.log('\n[e2e] --keep: o sistema continua em http://localhost:5175')
  } else {
    compose('down', '-v', '--remove-orphans')
  }
  console.log(`\n[e2e] total: ${((Date.now() - started) / 1000).toFixed(1)} s`)
}
process.exit(status)
