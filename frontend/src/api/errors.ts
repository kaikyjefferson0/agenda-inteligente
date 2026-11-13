/**
 * Errors of the API client (D53).
 *
 * Every response outside 2xx becomes an `ApiError`, built from the
 * `application/problem+json` body (RFC 9457) when there is one. A request that
 * never reaches the API becomes a `NetworkError`.
 */

import type { components } from './schema'

/** Stable codes of the API, generated from the `ErrorCode` enum of the OpenAPI (D97). */
export type ApiErrorCode = components['schemas']['ErrorCode']

/**
 * Codes whose body has fields of its own, declared in the OpenAPI (D94): the
 * type comes from `schema.d.ts`, never from a check by hand (D97).
 */
export interface TypedProblems {
  APPOINTMENT_CONFLICTS: components['schemas']['AppointmentConflictsProblem']
  TIME_BLOCK_OVERLAP: components['schemas']['TimeBlockOverlapProblem']
  SLOT_UNAVAILABLE: components['schemas']['StaffConflictProblem']
}

/** One item of `errors` in a `422`, with the location joined by dots. */
export interface FieldError {
  /** Location without the first segment (`body`, `query`, `path`, `header`). */
  field: string
  /** Message from the API, in English: forms show their own text by field. */
  message: string
  type: string
}

/** Body of an `application/problem+json` response, as the API sends it. */
export interface ProblemBody {
  type?: string
  title?: string
  status?: number
  code?: string
  detail?: string
  errors?: unknown
  [key: string]: unknown
}

const LOCATIONS = new Set(['body', 'query', 'path', 'header', 'cookie'])

export class ApiError extends Error {
  readonly status: number
  /** The stable `code`, or `null` when the body is not a problem (e.g. a proxy page). */
  readonly code: string | null
  readonly title: string | null
  readonly detail: string | null
  readonly fieldErrors: FieldError[]
  /** Seconds from `Retry-After` in a `429`; `null` otherwise. */
  readonly retryAfterSeconds: number | null
  /** The parsed body, for extra fields such as `conflicts`. */
  readonly body: ProblemBody | null

  constructor(init: {
    status: number
    code?: string | null
    title?: string | null
    detail?: string | null
    fieldErrors?: FieldError[]
    retryAfterSeconds?: number | null
    body?: ProblemBody | null
  }) {
    super(init.detail ?? init.title ?? `HTTP ${init.status}`)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code ?? null
    this.title = init.title ?? null
    this.detail = init.detail ?? null
    this.fieldErrors = init.fieldErrors ?? []
    this.retryAfterSeconds = init.retryAfterSeconds ?? null
    this.body = init.body ?? null
  }

  hasCode(code: ApiErrorCode): boolean {
    return this.code === code
  }
}

export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Network request failed', { cause })
    this.name = 'NetworkError'
  }
}

/** `Retry-After` in seconds: either delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.ceil((date - now) / 1000))
}

function parseFieldErrors(errors: unknown): FieldError[] {
  if (!Array.isArray(errors)) return []
  return errors.flatMap((item): FieldError[] => {
    if (typeof item !== 'object' || item === null) return []
    const { loc, msg, type } = item as { loc?: unknown; msg?: unknown; type?: unknown }
    const segments = Array.isArray(loc) ? loc.map(String) : []
    const path = segments.length > 1 && LOCATIONS.has(segments[0]) ? segments.slice(1) : segments
    return [
      {
        field: path.join('.'),
        message: typeof msg === 'string' ? msg : '',
        type: typeof type === 'string' ? type : '',
      },
    ]
  })
}

async function readProblem(response: Response): Promise<ProblemBody | null> {
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!/json/i.test(contentType)) return null
  try {
    const body: unknown = await response.clone().json()
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as ProblemBody)
      : null
  } catch {
    return null
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

export async function toApiError(response: Response): Promise<ApiError> {
  const body = await readProblem(response)
  return new ApiError({
    status: response.status,
    code: text(body?.code),
    title: text(body?.title),
    detail: text(body?.detail),
    fieldErrors: parseFieldErrors(body?.errors),
    retryAfterSeconds:
      response.status === 429 ? parseRetryAfter(response.headers.get('Retry-After')) : null,
    body,
  })
}

/**
 * The body of an `ApiError` with this `code`, typed as the OpenAPI declares it
 * (D97), or `null` for any other error. The API tests check each real body
 * against its schema (D94), so the client trusts the contract here, in one place.
 */
export function problemOf<C extends keyof TypedProblems>(error: unknown, code: C): TypedProblems[C] | null {
  if (!(error instanceof ApiError) || error.code !== code || error.body === null) return null
  return error.body as unknown as TypedProblems[C]
}

/** By name: the `DOMException` of fetch may come from another realm. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}
