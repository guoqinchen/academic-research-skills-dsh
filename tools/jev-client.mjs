/**
 * Minimal, dependency-free TypeSafe client for the optional Jev tools.
 *
 * This module is NOT imported by the host bundle. It is used only by the
 * opt-in tools in tools/jev-*.mjs and by their tests.
 */
export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const DEFAULT_MODEL = 'jev-latest'

export class JevError extends Error {
  constructor(message, options = {}) {
    super(message, options)
    this.name = 'JevError'
  }
}

/**
 * @param {{
 *   apiKey?: string,
 *   endpoint?: string,
 *   model?: string,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 */
export function createJevClient({
  apiKey = process.env.TYPESAFE_API_KEY,
  endpoint = TYPESAFE_ENDPOINT,
  model = DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new JevError('TYPESAFE_API_KEY is required for the optional Jev tools')
  }
  if (typeof fetchImpl !== 'function') {
    throw new JevError('a fetch implementation is required (Node.js >= 22)')
  }
  if (!endpoint.startsWith('https://') && !endpoint.startsWith('http://127.0.0.1')) {
    throw new JevError('TypeSafe endpoint must be HTTPS (or loopback HTTP for tests)')
  }

  return {
    model,
    endpoint,
    /**
     * @param {{state: unknown, questions: Record<string, unknown>}} request
     */
    async ask({ state, questions }) {
      if (questions === null || typeof questions !== 'object' || Object.keys(questions).length === 0) {
        throw new JevError('at least one question is required')
      }
      let response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model, state, questions }),
        })
      } catch (error) {
        throw new JevError(`TypeSafe request failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
      const text = await response.text()
      if (!response.ok) {
        throw new JevError(`TypeSafe API ${response.status}: ${text.slice(0, 300)}`)
      }
      let data
      try {
        data = JSON.parse(text)
      } catch (error) {
        throw new JevError('TypeSafe returned invalid JSON', { cause: error })
      }
      if (data === null || typeof data !== 'object' || data.answers === null || typeof data.answers !== 'object') {
        throw new JevError('TypeSafe response has no answers object')
      }
      return data
    },
  }
}

/** @param {number} noul @param {{yes: number, no: number}} thresholds */
export function noulVerdict(noul, { yes = 0.7, no = 0.3 } = {}) {
  if (typeof noul !== 'number' || Number.isNaN(noul)) {
    throw new JevError(`invalid Noul value: ${String(noul)}`)
  }
  if (noul >= yes) return 'yes'
  if (noul <= no) return 'no'
  return 'unresolved'
}

export function readJsonLines(text) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new JevError(`invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
}

export function parseArgs(argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      args._.push(token)
      continue
    }
    const [rawKey, inline] = token.slice(2).split('=', 2)
    const key = rawKey.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())
    if (inline !== undefined) {
      args[key] = inline
      continue
    }
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next
      index += 1
    } else {
      args[key] = true
    }
  }
  return args
}

export function numberOption(value, fallback, name) {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) throw new JevError(`${name} must be a number`)
  return number
}

export function assertFileArg(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new JevError(`${name} is required`)
  }
  return value
}
