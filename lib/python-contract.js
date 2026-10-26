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
 *   2. the `envDir` recorded in the runtime-state file under the default cache
 *      root (written by `env.writeRuntimeState()`, so a model-issued
 *      `bash bin/ars-python` honors a custom `envDir`);
 *   3. the default managed virtualenv under the default cache root;
 *   4. `python3` on `PATH`.
 *
 * The runtime-state file is plain text: one absolute `envDir` path, one line.
 * `lib/env.js` owns writing it; this module only owns its location and name.
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

/** Plain-text file under the default cache root recording the configured envDir. */
export const STATE_FILE_NAME = 'runtime-state'

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

/** Runtime-state file: a plain-text `envDir` record under the default cache root. */
export function runtimeStatePath(home = homedir()) {
  return join(defaultCacheRoot(home), STATE_FILE_NAME)
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
    `#   2. the envDir on line 1 of ${stateFile}`,
    '#      (written by env.writeRuntimeState() for a custom configured envDir)',
    `#   3. ${defaultVenv}/bin/python   default managed venv`,
    '#   4. python3 on PATH',
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
    '# A custom envDir is recorded in a plain-text file under the default cache',
    '# root, so a model-issued `bash bin/ars-python` resolves it even though that',
    '# shell does not inherit the ars_script child environment.',
    'venv_dir="${ARS_DSH_VENV:-}"',
    `if [ -z "$venv_dir" ] && [ -n "\${HOME:-}" ] && [ -f "${stateFile}" ]; then`,
    '  stated_venv=""',
    `  IFS= read -r stated_venv < "${stateFile}" || true`,
    '  venv_dir="$stated_venv"',
    'fi',
    '',
    'if [ -n "$venv_dir" ] && [ -x "$venv_dir/bin/python" ]; then',
    '  python="$venv_dir/bin/python"',
    '  ARS_DSH_VENV="$venv_dir"',
    '  export ARS_DSH_VENV',
    `elif [ -n "\${HOME:-}" ] && [ -x "${defaultVenv}/bin/python" ]; then`,
    `  python="${defaultVenv}/bin/python"`,
    `  ARS_DSH_VENV="${defaultVenv}"`,
    '  export ARS_DSH_VENV',
    'elif command -v python3 >/dev/null 2>&1; then',
    '  python="python3"',
    'else',
    '  echo "ars-python: no Python interpreter found" >&2',
    '  echo "ars-python: set ARS_DSH_VENV, run ars_env_setup, or install python3" >&2',
    '  exit 127',
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
