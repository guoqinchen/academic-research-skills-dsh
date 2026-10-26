/**
 * Dependency-free YAML frontmatter parser for the upstream Academic Research
 * Skills Markdown documents.
 *
 * The upstream corpus (5 `SKILL.md`, 16 `commands/*.md`, 4 top-level
 * `agents/*.md`, plus the role files referenced from skills) only uses a small
 * YAML subset:
 *
 *   - one-line plain and quoted scalars (`name`, `description`, `model`, ...);
 *   - nested maps introduced by `key:` plus an indented block (`metadata:`);
 *   - `- item` sequences at one indentation level (`related_skills:`);
 *   - `true` / `false` booleans.
 *
 * Unknown scalar values deliberately stay strings: dates (`last_updated:
 * "2026-08-15"` or an unquoted `2026-08-15`) and version numbers must not be
 * coerced into `Date`/`number`, because the registration layer round-trips
 * them as metadata.
 *
 * The parser is intentionally strict about structure. It accepts the corpus
 * shapes and rejects malformed indentation instead of silently dropping
 * instructions, since a corrupted frontmatter would mis-register a skill.
 *
 * @module frontmatter
 */

/** A fence is a line that is exactly three hyphens (optionally surrounded by spaces). */
const FENCE = /^---[ \t]*$/u

/** YAML also permits `...` to close a document; accept it as a closing fence. */
const CLOSING_FENCE = /^(?:---|\.\.\.)[ \t]*$/u

/** A `- item` sequence entry, matching YAML's block sequence indicator. */
const SEQUENCE_ENTRY = /^-[ \t]*(.*)$/u

/** Frontmatter keys used across the corpus. `-` appears in command keys. */
const KEY = /^[A-Za-z0-9_.-]+$/u

/**
 * A sequence entry that is a one-key map: the colon must be followed by
 * whitespace or end-of-line. `https://example.com` is a scalar in YAML, not a
 * map named `https`.
 */
const MAP_ENTRY = /^([A-Za-z0-9_.-]+):(?:[ 	]+(.*))?$/u

const ESCAPES = Object.freeze({
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
})

/**
 * Parse a leading YAML frontmatter block.
 *
 * @param {string} text Markdown source
 * @returns {{data: Record<string, unknown>, body: string} | null}
 *   `null` when the text does not start with a `---` fence or the fence is
 *   never closed. `body` is the text after the closing fence, trimmed.
 */
export function parseFrontmatter(text) {
  if (typeof text !== 'string') {
    throw new TypeError('parseFrontmatter: text must be a string')
  }
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = source.split(/\r?\n/u)
  if (lines.length === 0 || !FENCE.test(lines[0])) return null

  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (CLOSING_FENCE.test(lines[index])) {
      closing = index
      break
    }
  }
  if (closing === -1) return null

  const tokens = tokenize(lines, 1, closing)
  const parsed = parseBlock(tokens, 0, tokens.length > 0 ? tokens[0].indent : 0)
  if (parsed.index !== tokens.length) {
    const token = tokens[parsed.index]
    throw new SyntaxError(`frontmatter: unparsed content at line ${token.line + 1}`)
  }
  const body = lines
    .slice(closing + 1)
    .join('\n')
    .trim()
  return { data: parsed.value, body }
}

/**
 * Parse a Markdown file that may or may not carry frontmatter.
 *
 * @param {string} text Markdown source
 * @returns {{data: Record<string, unknown>, body: string}}
 *   A missing frontmatter block yields `{ data: {}, body: text.trim() }`.
 */
export function parseMarkdownFile(text) {
  const parsed = parseFrontmatter(text)
  if (parsed !== null) return parsed
  if (typeof text !== 'string') {
    throw new TypeError('parseMarkdownFile: text must be a string')
  }
  return { data: {}, body: text.trim() }
}

/**
 * Convert raw lines into indentation-aware tokens, dropping blank lines and
 * whole-line comments.
 *
 * @param {string[]} lines file lines
 * @param {number} start first line index (inclusive)
 * @param {number} end last line index (exclusive), the closing fence
 * @returns {Array<{indent: number, text: string, line: number}>}
 */
function tokenize(lines, start, end) {
  const tokens = []
  for (let index = start; index < end; index += 1) {
    const raw = lines[index]
    if (raw.trim() === '') continue
    if (/^[ \t]*#/u.test(raw)) continue
    const indentation = /^[ \t]*/u.exec(raw)[0]
    const text = raw.slice(indentation.length).replace(/[ \t]+$/u, '')
    tokens.push({
      indent: expandIndent(indentation),
      text,
      line: index,
    })
  }
  return tokens
}

/**
 * Count indentation width, treating a tab as two columns. The corpus uses two
 * spaces per nesting level; both are accepted as long as blocks are consistent.
 *
 * @param {string} indentation leading whitespace
 * @returns {number}
 */
function expandIndent(indentation) {
  let width = 0
  for (const character of indentation) width += character === '\t' ? 2 : 1
  return width
}

/**
 * Parse one indented block into an object or an array.
 *
 * @param {Array<{indent: number, text: string, line: number}>} tokens
 * @param {number} start first token of the block
 * @param {number} indent block indentation width
 * @returns {{value: Record<string, unknown> | unknown[], index: number}}
 */
function parseBlock(tokens, start, indent) {
  if (start >= tokens.length) return { value: {}, index: start }
  const first = tokens[start]
  if (first.indent !== indent) {
    throw new SyntaxError(`frontmatter: unexpected indentation at line ${first.line + 1}`)
  }
  if (SEQUENCE_ENTRY.test(first.text)) return parseSequence(tokens, start, indent)
  return parseMapping(tokens, start, indent)
}

/**
 * Parse `key: value` lines at one indentation level.
 *
 * @param {Array<{indent: number, text: string, line: number}>} tokens
 * @param {number} start
 * @param {number} indent
 * @returns {{value: Record<string, unknown>, index: number}}
 */
function parseMapping(tokens, start, indent) {
  /** @type {Record<string, unknown>} */
  const value = {}
  let index = start
  while (index < tokens.length) {
    const token = tokens[index]
    if (token.indent < indent) break
    if (token.indent > indent) {
      throw new SyntaxError(`frontmatter: unexpected indentation at line ${token.line + 1}`)
    }
    if (SEQUENCE_ENTRY.test(token.text)) break
    const colon = token.text.indexOf(':')
    if (colon <= 0) {
      throw new SyntaxError(`frontmatter: expected "key: value" at line ${token.line + 1}`)
    }
    const key = token.text.slice(0, colon).trim()
    if (!KEY.test(key)) {
      throw new SyntaxError(`frontmatter: unsupported key "${key}" at line ${token.line + 1}`)
    }
    const rest = stripInlineComment(token.text.slice(colon + 1)).trim()
    if (rest.length === 0) {
      const next = index + 1
      // YAML allows an indentationless block sequence directly under a key.
      if (next < tokens.length && tokens[next].indent === indent && SEQUENCE_ENTRY.test(tokens[next].text)) {
        const child = parseSequence(tokens, next, indent)
        value[key] = child.value
        index = child.index
        continue
      }
      if (next < tokens.length && tokens[next].indent > indent) {
        const child = parseBlock(tokens, next, tokens[next].indent)
        value[key] = child.value
        index = child.index
      } else {
        value[key] = null
        index = next
      }
      continue
    }
    value[key] = parseScalar(rest)
    index += 1
  }
  return { value, index }
}

/**
 * Parse a `- item` block at one indentation level. Scalar entries are the
 * corpus shape; a `- key: value` entry (or an empty `-` followed by a nested
 * block) is also accepted so future upstream edits do not crash the loader.
 *
 * @param {Array<{indent: number, text: string, line: number}>} tokens
 * @param {number} start
 * @param {number} indent
 * @returns {{value: unknown[], index: number}}
 */
function parseSequence(tokens, start, indent) {
  /** @type {unknown[]} */
  const value = []
  let index = start
  while (index < tokens.length) {
    const token = tokens[index]
    if (token.indent < indent) break
    if (token.indent > indent) {
      throw new SyntaxError(`frontmatter: unexpected indentation at line ${token.line + 1}`)
    }
    const match = SEQUENCE_ENTRY.exec(token.text)
    if (match === null) break
    const entry = match[1].trim()
    if (entry.length === 0) {
      const next = index + 1
      if (next < tokens.length && tokens[next].indent > indent) {
        const child = parseBlock(tokens, next, tokens[next].indent)
        value.push(child.value)
        index = child.index
      } else {
        value.push(null)
        index = next
      }
      continue
    }
    const mapEntry = MAP_ENTRY.exec(entry)
    if (mapEntry === null) {
      value.push(parseScalar(stripInlineComment(entry)))
      index += 1
      continue
    }
    // A `- key: value` sequence entry is a one-key map that may continue with
    // deeper `key: value` lines belonging to the same item.
    let itemIndex = index + 1
    /** @type {Record<string, unknown>} */
    const item = {}
    const key = mapEntry[1]
    const rest = stripInlineComment(mapEntry[2] ?? '').trim()
    if (rest.length === 0) {
      if (itemIndex < tokens.length && tokens[itemIndex].indent > indent) {
        const nested = parseBlock(tokens, itemIndex, tokens[itemIndex].indent)
        item[key] = nested.value
        itemIndex = nested.index
      } else {
        item[key] = null
      }
    } else {
      item[key] = parseScalar(rest)
    }
    if (itemIndex < tokens.length && tokens[itemIndex].indent > indent) {
      const continuation = parseBlock(tokens, itemIndex, tokens[itemIndex].indent)
      if (
        continuation.value !== null &&
        typeof continuation.value === 'object' &&
        !Array.isArray(continuation.value)
      ) {
        Object.assign(item, continuation.value)
      }
      itemIndex = continuation.index
    }
    value.push(item)
    index = itemIndex
  }
  return { value, index }
}

/**
 * Strip a YAML inline comment while preserving `#` inside quoted scalars.
 * A `#` starts a comment only at line start or after whitespace.
 *
 * @param {string} raw
 * @returns {string}
 */
function stripInlineComment(raw) {
  let quote = null
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (quote === '"') {
      if (character === '\\') index += 1
      else if (character === '"') quote = null
      continue
    }
    if (quote === "'") {
      if (character === "'" && raw[index + 1] === "'") index += 1
      else if (character === "'") quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '#' && (index === 0 || raw[index - 1] === ' ' || raw[index - 1] === '\t')) {
      return raw.slice(0, index).replace(/[ \t]+$/u, '')
    }
  }
  return raw
}

/**
 * Decode one scalar. Quoted scalars are unquoted/unescaped; `true`/`false`
 * become booleans; everything else stays a string.
 *
 * @param {string} raw value text without the key
 * @returns {string | boolean}
 */
function parseScalar(raw) {
  const value = raw.trim()
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return unescapeDoubleQuoted(value.slice(1, -1))
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/gu, "'")
  }
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

/**
 * Decode YAML double-quoted escapes used by the corpus and common variants.
 *
 * @param {string} inner quoted content without the surrounding quotes
 * @returns {string}
 */
function unescapeDoubleQuoted(inner) {
  return inner.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/gu, (match, code) => {
    if (code.length === 5 && code[0] === 'u') {
      return String.fromCharCode(Number.parseInt(code.slice(1), 16))
    }
    if (code.length === 3 && code[0] === 'x') {
      return String.fromCharCode(Number.parseInt(code.slice(1), 16))
    }
    return ESCAPES[code] ?? code
  })
}
