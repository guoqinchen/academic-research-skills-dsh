import { homedir } from 'node:os'
import { defaultCacheRoot, defaultEnvDir } from './python-contract.js'

/** Defaults for every supported plugin option. */
export const DEFAULT_CONFIG = Object.freeze({
  announce: true,
  commands: true,
  tools: true,
  guard: true,
  guardInfra: true,
  pythonPath: null,
  cacheRoot: null,
  envDir: null,
  scriptTimeoutMs: 120000,
  maxScriptOutputBytes: 200000,
  modelProfile: 'deepseek-flash',
  webSearch: true,
})

/**
 * Normalize the row config from cordis.patch.yml.
 *
 * @param {Record<string, unknown> | undefined} raw
 * @param {{home?: string}} [options]
 * @returns {typeof DEFAULT_CONFIG & {cacheRoot: string, envDir: string}}
 */
export function normalizeConfig(raw = undefined, options = {}) {
  const home = options.home ?? homedir()
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const cacheRoot = stringOr(input.cacheRoot, defaultCacheRoot(home))
  return {
    announce: boolOr(input.announce, DEFAULT_CONFIG.announce),
    commands: boolOr(input.commands, DEFAULT_CONFIG.commands),
    tools: boolOr(input.tools, DEFAULT_CONFIG.tools),
    guard: boolOr(input.guard, DEFAULT_CONFIG.guard),
    guardInfra: boolOr(input.guardInfra, DEFAULT_CONFIG.guardInfra),
    pythonPath: stringOr(input.pythonPath, DEFAULT_CONFIG.pythonPath),
    cacheRoot,
    envDir: stringOr(input.envDir, defaultEnvDir(cacheRoot)),
    scriptTimeoutMs: numberOr(input.scriptTimeoutMs, DEFAULT_CONFIG.scriptTimeoutMs, 1000),
    maxScriptOutputBytes: numberOr(input.maxScriptOutputBytes, DEFAULT_CONFIG.maxScriptOutputBytes, 4096),
    modelProfile: stringOr(input.modelProfile, DEFAULT_CONFIG.modelProfile),
    webSearch: boolOr(input.webSearch, DEFAULT_CONFIG.webSearch),
  }
}

function boolOr(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true' || value === 'on') return true
  if (value === 0 || value === '0' || value === 'false' || value === 'off') return false
  return fallback
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function numberOr(value, fallback, minimum) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= minimum ? number : fallback
}
