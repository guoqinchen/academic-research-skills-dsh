/**
 * Python interpreter contract — the single owner of virtualenv resolution and
 * child-process environment policy for the plugin's deterministic Python
 * scripts.
 *
 * Everything here is either frozen data or a pure function: no filesystem
 * access, no spawning, no writes. `lib/env.js` applies this policy with real
 * I/O, and `bin/ars-python` is generated from {@link renderWrapper} by
 * `tools/build-python-wrapper.mjs`, so the JS and POSIX-shell paths cannot
 * drift apart.
 *
 * Resolution order shared by both paths (first usable interpreter wins):
 *   1. an explicit `ARS_DSH_VENV` whose `bin/python` is executable;
 *   2. this plugin's `envDir` from the runtime-state table (written by
 *      `env.writeRuntimeState()`, so a model-issued `bash bin/ars-python`
 *      honors a custom `envDir`);
 *   3. this plugin's `pythonPath` from the same row, so `config.pythonPath`
 *      also governs `ars_script` when no managed venv exists;
 *   4. the default managed virtualenv under the default cache root;
 *   5. `python3` on `PATH`.
 *
 * The runtime-state file is plain text: one tab-separated row per plugin root,
 * `<pluginRoot>\t<envDir>\t<python>`. `lib/env.js` owns writing it; this module
 * owns the format, the location, and the wrapper that reads it.
 */
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export const CONTRACT_VERSION = 1

/** Environment variable that overrides the managed virtualenv directory. */
export const VENV_ENV_VAR = 'ARS_DSH_VENV'

/** Environment variable exporting the payload root to upstream Python scripts. */
export const PAYLOAD_ENV_VAR = 'ARS_PAYLOAD_ROOT'

/** Environment variable used to make payload modules importable. */
export const PYTHONPATH_ENV_VAR = 'PYTHONPATH'

/** Environment variable that suppresses `__pycache__` writes. */
export const BYTECODE_ENV_VAR = 'PYTHONDONTWRITEBYTECODE'

/**
 * Bytecode policy value.
 *
 * The payload is a byte-immutable provenance snapshot; CPython writes
 * `__pycache__` next to imported sibling modules by default, which would mutate
 * the payload and invalidate `tools/check-payload.mjs`.
 */
export const BYTECODE_POLICY = '1'

/** Interpreter used when no managed virtualenv is available. */
export const DEFAULT_PYTHON = 'python3'

/** POSIX sh wrapper installed at `<plugin>/bin/ars-python`. */
export const WRAPPER_NAME = 'ars-python'

/** Plain-text file under the default cache root recording one entry per plugin root. */
export const STATE_FILE_NAME = 'runtime-state'

/**
 * Runtime-state format version.
 *
 * v1 was a single line holding one `envDir`, which made concurrent plugin
 * profiles overwrite each other. v2 is a tab-separated table keyed by the
 * plugin root, so each install resolves only its own interpreter policy.
 */
export const STATE_FORMAT_VERSION = 2

/** Header lines written before the state entries. */
export const STATE_HEADER_LINES = Object.freeze([
  `# ars-dsh runtime state v${STATE_FORMAT_VERSION}`,
  '# One entry per plugin root, tab-separated: <pluginRoot>\\t<envDir>\\t<python>',
  '# Written by lib/env.js (writeRuntimeState); read by bin/ars-python.',
])

/** Directory name of the managed virtualenv inside a cache root. */
export const ENV_DIR_NAME = 'venv'

/** Path segments of the default cache root, relative to the user home directory. */
export const CACHE_ROOT_SEGMENTS = Object.freeze(['.cache', 'ars-dsh'])

/** POSIX spelling of {@link CACHE_ROOT_SEGMENTS} (used by the generated wrapper). */
export const CACHE_ROOT_POSIX = CACHE_ROOT_SEGMENTS.join('/')

/** Default cache root: `~/.cache/ars-dsh` on POSIX; `join(home, ...)` elsewhere. */
export function defaultCacheRoot(home = homedir()) {
  return join(home, ...CACHE_ROOT_SEGMENTS)
}

/** Default managed envDir: `<cacheRoot>/venv`. */
export function defaultEnvDir(cacheRoot = defaultCacheRoot()) {
  return join(cacheRoot, ENV_DIR_NAME)
}

/** Runtime-state file: a plain-text `pluginRoot/environment` table under the default cache root. */
export function runtimeStatePath(home = homedir()) {
  return join(defaultCacheRoot(home), STATE_FILE_NAME)
}

/**
 * Parse the runtime-state table.
 *
 * Comments and blank lines are skipped; a legacy v1 file (a single bare
 * `envDir` line) yields an empty map, which degrades to the default venv
 * instead of pointing the wrapper at another install's environment.
 *
 * @param {string} text
 * @returns {Map<string, {envDir: string, python: string}>}
 */
export function parseStateText(text) {
  const entries = new Map()
  for (const line of String(text).split('\n')) {
    if (line.length === 0 || line.startsWith('#')) continue
    const [pluginRoot, envDir = '', python = ''] = line.split('\t')
    if (pluginRoot.length === 0) continue
    // A v1 file has no tab: treat it as legacy and ignore it.
    if (!line.includes('\t')) continue
    entries.set(pluginRoot, { envDir, python })
  }
  return entries
}

/**
 * Render the runtime-state table deterministically (bytewise plugin-root order).
 *
 * @param {Map<string, {envDir?: string, python?: string}> | Array<[string, {envDir?: string, python?: string}]>} entries
 * @returns {string}
 */
export function renderStateText(entries) {
  const rows = [...entries]
    .map(([pluginRoot, entry]) => [
      pluginRoot,
      entry?.envDir ?? '',
      entry?.python ?? '',
    ])
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')))
  const body = rows.map((row) => row.join('\t')).join('\n')
  return `${STATE_HEADER_LINES.join('\n')}\n${body}${body.length > 0 ? '\n' : ''}`
}

/**
 * Platform-specific interpreter path inside a virtualenv.
 *
 * POSIX virtualenvs use `bin/python`; Windows virtualenvs use
 * `Scripts/python.exe`. `platform` is injectable so both branches are testable.
 *
 * @param {string} envDir virtualenv directory
 * @param {string} [platform] `process.platform` value
 * @returns {string}
 */
export function venvPythonPath(envDir, platform = process.platform) {
  return platform === 'win32'
    ? join(envDir, 'Scripts', 'python.exe')
    : join(envDir, 'bin', 'python')
}

/**
 * Interpreter selection policy: managed venv first, then the configured
 * interpreter, then `python3`.
 *
 * The caller supplies `hasVenv` because probing the filesystem is I/O and this
 * contract stays pure.
 *
 * @param {{envDir?: string|null, hasVenv?: boolean, pythonPath?: string|null}} [options]
 * @returns {string}
 */
export function resolvePythonExecutable({ envDir = null, hasVenv = false, pythonPath = null } = {}) {
  if (hasVenv && envDir) return venvPythonPath(envDir)
  return pythonPath || DEFAULT_PYTHON
}

/**
 * Child-process environment policy for Python scripts.
 *
 * Prepends the payload root to `PYTHONPATH`, exports `ARS_PAYLOAD_ROOT`, pins
 * the bytecode policy, and (when a managed venv is in use) exports
 * `ARS_DSH_VENV` so nested wrappers/scripts resolve the same interpreter.
 *
 * @param {{baseEnv?: Record<string, string|undefined>, payloadRoot: string,
 *   envDir?: string|null, hasVenv?: boolean}} options
 * @returns {Record<string, string|undefined>}
 */
export function buildScriptEnv({ baseEnv = {}, payloadRoot, envDir = null, hasVenv = false }) {
  const env = {
    ...baseEnv,
    [PAYLOAD_ENV_VAR]: payloadRoot,
    [BYTECODE_ENV_VAR]: BYTECODE_POLICY,
  }
  const existing = env[PYTHONPATH_ENV_VAR]
  env[PYTHONPATH_ENV_VAR] = existing ? `${payloadRoot}${delimiter}${existing}` : payloadRoot
  if (hasVenv && envDir) env[VENV_ENV_VAR] = envDir
  return env
}

/** Absolute path of the POSIX sh wrapper inside a `bin/` directory. */
export function wrapperPath(binRoot) {
  return join(binRoot, WRAPPER_NAME)
}

/**
 * Render the complete `bin/ars-python` wrapper.
 *
 * The wrapper is self-locating (plugin root derived from `$0`), so the
 * generated bytes are portable and independent of installation path. It must
 * stay byte-identical to the checked-in file; `node
 * tools/build-python-wrapper.mjs --check` enforces that.
 *
 * @returns {string} POSIX sh script text (trailing newline included)
 */
export function renderWrapper() {
  const stateFile = `$HOME/${CACHE_ROOT_POSIX}/${STATE_FILE_NAME}`
  const defaultVenv = `$HOME/${CACHE_ROOT_POSIX}/${ENV_DIR_NAME}`
  const lines = [
    '#!/bin/sh',
    '# Managed Python interpreter for Academic Research Skills scripts.',
    '#',
    '# GENERATED FILE - do not edit by hand.',
    '# Source of truth: lib/python-contract.js (renderWrapper)',
    '# Regenerate: node tools/build-python-wrapper.mjs',
    '# Verify:     node tools/build-python-wrapper.mjs --check',
    '#',
    '# Resolution order (first usable interpreter wins):',
    '#   1. $ARS_DSH_VENV/bin/python                       explicit override',
    `#   2. this plugin's envDir in ${stateFile}`,
    '#      (written by env.writeRuntimeState() for a custom configured envDir)',
    '#   3. this plugin\'s configured pythonPath from the same state entry',
    '#      (so config.pythonPath also governs ars_script, not only venv creation)',
    `#   4. ${defaultVenv}/bin/python   default managed venv`,
    '#   5. python3 on PATH',
    '#',
    '# The payload root is prepended to PYTHONPATH and exported as ARS_PAYLOAD_ROOT',
    '# so upstream scripts resolve sibling modules from the payload. Bytecode writing',
    '# is disabled because the payload is a read-only provenance snapshot; CPython',
    '# would otherwise create __pycache__ directories inside it. All arguments are',
    '# forwarded verbatim.',
    'set -eu',
    '',
    'script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)',
    'plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)',
    'if [ -d "$plugin_root/payload" ]; then',
    '  payload_root="$plugin_root/payload"',
    'else',
    '  payload_root="$plugin_root"',
    'fi',
    '',
    '# The state file holds one tab-separated entry per plugin root, so two',
    '# profiles with different envDir/pythonPath cannot overwrite each other.',
    '# A model-issued `bash bin/ars-python` does not inherit the ars_script child',
    '# environment, which is why this file (not an env var) carries the policy.',
    'venv_dir="${ARS_DSH_VENV:-}"',
    'stated_python=""',
    `if [ -z "$venv_dir" ] && [ -n "\${HOME:-}" ] && [ -f "${stateFile}" ]; then`,
    `  state_entry=$(grep -F "$plugin_root\t" "${stateFile}" 2>/dev/null | tail -n 1 || true)`,
    '  if [ -n "$state_entry" ]; then',
    '    venv_dir=$(printf \'%s\\n\' "$state_entry" | cut -f2 -s)',
    '    stated_python=$(printf \'%s\\n\' "$state_entry" | cut -f3 -s)',
    '  fi',
    'fi',
    '',
    'python=""',
    'if [ -n "$venv_dir" ] && [ -x "$venv_dir/bin/python" ]; then',
    '  python="$venv_dir/bin/python"',
    '  ARS_DSH_VENV="$venv_dir"',
    '  export ARS_DSH_VENV',
    'fi',
    'if [ -z "$python" ] && [ -n "$stated_python" ]; then',
    '  case "$stated_python" in',
    '    */*)',
    '      if [ -x "$stated_python" ]; then',
    '        python="$stated_python"',
    '      fi',
    '      ;;',
    '    *)',
    '      if command -v "$stated_python" >/dev/null 2>&1; then',
    '        python="$stated_python"',
    '      fi',
    '      ;;',
    '  esac',
    'fi',
    `if [ -z "$python" ] && [ -n "\${HOME:-}" ] && [ -x "${defaultVenv}/bin/python" ]; then`,
    `  python="${defaultVenv}/bin/python"`,
    `  ARS_DSH_VENV="${defaultVenv}"`,
    '  export ARS_DSH_VENV',
    'fi',
    'if [ -z "$python" ]; then',
    '  if command -v python3 >/dev/null 2>&1; then',
    '    python="python3"',
    '  else',
    '    echo "ars-python: no Python interpreter found" >&2',
    '    echo "ars-python: set ARS_DSH_VENV, run ars_env_setup, or install python3" >&2',
    '    exit 127',
    '  fi',
    'fi',
    '',
    'if [ -n "${PYTHONPATH:-}" ]; then',
    '  PYTHONPATH="$payload_root:$PYTHONPATH"',
    'else',
    '  PYTHONPATH="$payload_root"',
    'fi',
    'export PYTHONPATH',
    'PYTHONDONTWRITEBYTECODE=1',
    'export PYTHONDONTWRITEBYTECODE',
    'ARS_PAYLOAD_ROOT="$payload_root"',
    'export ARS_PAYLOAD_ROOT',
    '',
    'exec "$python" "$@"',
    '',
  ]
  return lines.join('\n')
}
