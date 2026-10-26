/**
 * Pure reference-convention rules for the ARS payload.
 *
 * These rules are deliberately free of filesystem access so the runtime
 * adapter and the build-time payload tooling can share one convention owner.
 * `paths` and `inventory` provide the concrete roots elsewhere.
 *
 * @module reference-rules
 */
import { isAbsolute, join, normalize, posix } from 'node:path'

/** Prefixes whose relative references live in the current skill directory. */
export const SKILL_LOCAL_PREFIXES = Object.freeze(['references', 'agents', 'templates', 'examples'])

/** Prefixes whose relative references live at the payload root. */
export const PAYLOAD_ROOT_PREFIXES = Object.freeze(['shared', 'scripts', 'docs', 'tools'])

/** Root-level files a skill body can name directly. */
export const PAYLOAD_ROOT_FILES = Object.freeze(['MODE_REGISTRY.md'])

/** Skill names, imported lazily by callers so this module stays dependency-free. */
const SKILL_NAMES = Object.freeze(['deep-research', 'academic-paper', 'academic-paper-reviewer', 'academic-pipeline', 'sr-screener'])

/**
 * Classify one upstream relative reference.
 *
 * @param {string} raw reference as written in the Markdown
 * @param {{skill?: string | null}} [options] skill whose body contains it
 * @returns {{scope: 'skill'|'payload'|'absolute'|'url'|'unknown', path: string}}
 */
export function classifyReference(raw, { skill = null } = {}) {
  const value = String(raw).trim()
  if (/^[a-z]+:\/\//iu.test(value)) return { scope: 'url', path: value }
  if (value.startsWith('${CLAUDE_PLUGIN_ROOT}/')) return { scope: 'payload', path: value.slice('${CLAUDE_PLUGIN_ROOT}/'.length) }
  if (value.startsWith('~') || isAbsolute(value)) return { scope: 'absolute', path: value }
  const cleaned = normalize(value.replace(/^\.\//u, '')).replaceAll('\\', '/')
  if (cleaned.startsWith('..')) return { scope: 'unknown', path: cleaned }
  const first = cleaned.split('/')[0]
  if (first === 'sr-screener' || SKILL_NAMES.includes(first)) return { scope: 'payload', path: cleaned }
  // sr-screener ships its own scripts/ directory; upstream prose uses
  // `scripts/...` from inside that skill, not from the payload root.
  if (skill === 'sr-screener' && first === 'scripts') return { scope: 'skill', path: cleaned }
  if (SKILL_LOCAL_PREFIXES.includes(first)) return { scope: 'skill', path: cleaned }
  if (PAYLOAD_ROOT_PREFIXES.includes(first) || PAYLOAD_ROOT_FILES.includes(cleaned)) {
    return { scope: 'payload', path: cleaned }
  }
  return { scope: 'payload', path: cleaned }
}

/**
 * Resolve one reference to an absolute path when it names a payload resource.
 *
 * @param {string} raw
 * @param {{skill?: string|null, payloadRoot: string, skillDir?: string|null}} options
 * @returns {string|null}
 */
export function resolveReference(raw, { skill = null, payloadRoot, skillDir = null }) {
  const classified = classifyReference(raw, { skill })
  if (classified.scope === 'url' || classified.scope === 'absolute' || classified.scope === 'unknown') return null
  const base = classified.scope === 'skill' && skillDir !== null ? skillDir : payloadRoot
  return join(base, classified.path)
}

/** The directory that owns a skill's `scripts/` references. */
export function skillScriptDirectory(skill, payloadRoot) {
  return skill === 'sr-screener' ? join(payloadRoot, 'sr-screener', 'scripts') : join(payloadRoot, 'scripts')
}

/**
 * Normalize an upstream script invocation path to the directory that owns it.
 *
 * `scripts/foo.py` inside sr-screener resolves under the skill; every other
 * skill and every `sr-screener/scripts/foo.py` path resolves at the payload.
 *
 * @param {string} raw
 * @param {{skill?: string|null, payloadRoot: string}} options
 */
export function resolveScriptPath(raw, { skill = null, payloadRoot }) {
  const value = String(raw).replace(/^\.\//u, '')
  if (value.startsWith('sr-screener/')) return join(payloadRoot, value)
  if (skill === 'sr-screener' && value.startsWith('scripts/')) return join(payloadRoot, 'sr-screener', value)
  return join(payloadRoot, value)
}

/** POSIX-normalize a relative path for stable comparison in tooling. */
export function normalizeReferencePath(value) {
  return posix.normalize(String(value).replace(/^\.\//u, '').replaceAll('\\', '/'))
}
