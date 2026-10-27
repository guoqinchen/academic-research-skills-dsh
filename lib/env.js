/**
 * Managed Python environment for the deterministic ARS scripts.
 *
 * The virtualenv layout, interpreter resolution order, and child-process
 * environment policy are owned by `lib/python-contract.js`; this module applies
 * them with real filesystem I/O and process spawning. `bin/ars-python` is
 * generated from the same contract, so `ars_script` and a model-issued
 * `bash bin/ars-python` cannot disagree.
 *
 * Two execution modes:
 *   * `venv`   — the plugin-owned virtualenv at `config.envDir` exists and its
 *                interpreter is used for every probe / install / script run.
 *   * `system` — no virtualenv; `config.pythonPath` (or `python3`) runs directly.
 *
 * `status()` is a pure observer: it never installs, never writes, and never
 * throws. `ensure()` is the only network-mutating call; it is exposed to the
 * model through the `ars_env_setup` tool so installation is always an explicit
 * action. `writeRuntimeState()` records the configured `envDir` in the
 * contract's runtime-state file so the POSIX wrapper resolves the same
 * interpreter for a model-issued shell command.
 *
 * No external npm dependencies; child processes are invoked with an argument
 * array (never a shell).
 */
import { spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  DEFAULT_PYTHON,
  buildScriptEnv,
  parseStateText,
  renderStateText,
  resolvePythonExecutable,
  runtimeStatePath,
  venvPythonPath,
  wrapperPath as contractWrapperPath,
} from './python-contract.js'

// Compatibility re-export: tests, tools/verify-install.mjs, and the upstream
// parity probes import `venvPythonPath` from this module.
export { venvPythonPath } from './python-contract.js'

/** Python import names probed by `status()` (import name, not package name). */
export const DEPENDENCY_MODULES = Object.freeze([
  'yaml',
  'jsonschema',
  'ruamel.yaml',
  'pypdf',
  'defusedxml',
  'openpyxl',
  'markdown_it',
  'linkify_it',
])

/** Import-name -> human package name, used in install logs. */
const PACKAGE_NAMES = Object.freeze({
  yaml: 'pyyaml',
  jsonschema: 'jsonschema',
  'ruamel.yaml': 'ruamel.yaml',
  pypdf: 'pypdf',
  defusedxml: 'defusedxml',
  openpyxl: 'openpyxl',
  markdown_it: 'markdown-it-py',
  linkify_it: 'linkify-it-py',
})

/** The payload uses tomllib and other 3.11+ syntax. */
export const MINIMUM_PYTHON = '3.11'

function versionParts(value) {
  return String(value)
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part))
}

/** Compare dotted numeric versions without a semver dependency. */
export function versionAtLeast(actual, minimum) {
  const left = versionParts(actual)
  const right = versionParts(minimum)
  if (left.length === 0) return false
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return true
}

/** One probe process reports the interpreter version and every missing import. */
const PROBE_SCRIPT = [
  'import importlib.util, json, sys',
  `modules = ${JSON.stringify(DEPENDENCY_MODULES)}`,
  'missing = []',
  'for name in modules:',
  '    try:',
  '        spec = importlib.util.find_spec(name)',
  '    except Exception:',
  '        spec = None',
  '    if spec is None:',
  '        missing.append(name)',
  'print(json.dumps({"version": sys.version.split()[0], "missing": missing}))',
].join('\n')

/**
 * Spawn one child process and settle with its output.
 *
 * Never rejects: a missing executable or an abort resolves with `error` set so
 * callers (especially `status()`) can report a degraded environment instead of
 * throwing into the Host.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<{code: number|null, stdout: string, stderr: string, error: Error|null}>}
 */
export function spawnRun(command, args, options = {}) {
  const { cwd, env, timeoutMs, signal } = options
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', error })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (code, error = null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        code: timedOut ? null : code,
        stdout,
        stderr: timedOut
          ? `${stderr}${stderr ? '\n' : ''}[ars] command timed out after ${timeoutMs}ms`
          : stderr,
        error: timedOut ? new Error(`timeout after ${timeoutMs}ms`) : error,
      })
    }

    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          try {
            child.kill('SIGKILL')
          } catch {
            /* already gone */
          }
        }, timeoutMs)
      : null
    timer?.unref?.()

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => finish(null, error))
    child.on('close', (code) => finish(code))

    if (signal) {
      if (signal.aborted) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      } else {
        signal.addEventListener(
          'abort',
          () => {
            try {
              child.kill('SIGKILL')
            } catch {
              /* already gone */
            }
          },
          { once: true },
        )
      }
    }
  })
}

/**
 * Age after which an env-setup lock is considered abandoned.
 *
 * A killed process (SIGKILL, power loss, container stop) leaves the lock file
 * behind; without a staleness rule every later `ars_env_setup` would wait for
 * the full timeout and then fail permanently.
 */
export const LOCK_STALE_MS = 10 * 60 * 1000

function readLockRecord(lockPath) {
  try {
    const text = readFileSync(lockPath, 'utf8').trim()
    if (text.length === 0) return null
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function lockAgeMs(lockPath, now) {
  const record = readLockRecord(lockPath)
  if (record !== null && Number.isFinite(record.startedAt)) return now - record.startedAt
  try {
    return now - statSync(lockPath).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Canonical spelling of a plugin root for the runtime-state key.
 *
 * `paths.pluginRoot` comes from `fileURLToPath(new URL('..', import.meta.url))`
 * and keeps a trailing separator; the wrapper uses `pwd -P`, which resolves
 * symlinks (macOS `/var` → `/private/var`) and drops the separator.
 *
 * @param {string} root
 * @returns {string}
 */
function canonicalPluginRoot(root) {
  const value = String(root)
  const trimmed = value.replace(/[\\/]+$/u, '') || value
  try {
    return realpathSync.native(trimmed)
  } catch {
    return trimmed
  }
}

/** `EPERM` means the process exists but belongs to someone else. */
function lockOwnerAlive(lockPath) {
  const record = readLockRecord(lockPath)
  if (record === null || !Number.isInteger(record.pid) || record.pid <= 0) return true
  try {
    process.kill(record.pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/**
 * Acquire one exclusive lock file for a managed-environment mutation.
 *
 * The lock records `{pid, startedAt}` and is stolen when its owner process is
 * gone or the record is older than `staleMs`, so a crash cannot permanently
 * block `ars_env_setup`. At most one steal attempt is made per acquisition;
 * a lost steal race falls back to normal polling.
 *
 * @param {string} lockPath
 * @param {{timeoutMs?: number, staleMs?: number, pollMs?: number, now?: () => number}} [options]
 * @returns {Promise<number>} open file descriptor; caller closes and unlinks
 */
export function acquireLock(lockPath, options = {}) {
  const {
    timeoutMs = 120000,
    staleMs = LOCK_STALE_MS,
    pollMs = 100,
    now = Date.now,
  } = options
  const deadline = now() + timeoutMs
  return new Promise((resolveLock, rejectLock) => {
    let stealAttempted = false
    const attempt = () => {
      try {
        const fd = openSync(lockPath, 'wx')
        try {
          writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: now() }))
        } catch {
          /* an unwritable fd still holds the lock */
        }
        resolveLock(fd)
        return
      } catch (error) {
        if (error?.code !== 'EEXIST') {
          rejectLock(error)
          return
        }
      }

      const abandoned = lockAgeMs(lockPath, now()) > staleMs || !lockOwnerAlive(lockPath)
      if (abandoned && !stealAttempted) {
        stealAttempted = true
        try {
          unlinkSync(lockPath)
        } catch {
          /* someone else may have removed it first */
        }
        attempt()
        return
      }
      if (now() > deadline) {
        rejectLock(
          new Error(
            `timed out waiting for env setup lock: ${lockPath} ` +
              '(remove it if no ars_env_setup is running)',
          ),
        )
        return
      }
      setTimeout(attempt, pollMs)
    }
    attempt()
  })
}

/**
 * Create the environment manager for one plugin row.
 *
 * @param {object} options
 * @param {ReturnType<import('./paths.js').createPaths>} options.paths
 * @param {ReturnType<import('./config.js').normalizeConfig>} options.config
 * @param {(command: string, args: string[], options?: object) => Promise<{code: number|null, stdout: string, stderr: string, error: Error|null}>} [options.run]
 *   process runner injection point (tests use it to avoid touching the network)
 * @param {string} [options.requirementsPath] override for tests / non-default layouts
 * @param {string} [options.home] home directory for the contract's default-cache-root
 *   runtime-state file (defaults to the OS home directory; tests override it)
 * @returns {{status: () => Promise<object>,
 *   ensure: (options?: {force?: boolean, signal?: AbortSignal}) => Promise<object>,
 *   pythonExecutable: () => string,
 *   scriptEnv: () => Record<string, string|undefined>,
 *   wrapperPath: () => string,
 *   writeRuntimeState: () => boolean}}
 */
export function createPythonEnv({ paths, config, run = spawnRun, requirementsPath, home }) {
  const envDir = config.envDir
  const requirements = requirementsPath ?? paths.requirementsPath
  // The wrapper always looks under the *default* cache root, even when the row
  // configured a custom cacheRoot, so record the configured envDir there.
  const statePath = runtimeStatePath(home)
  // The wrapper derives its plugin root with `pwd -P` (no trailing separator,
  // symlinks resolved); key the state entry the same way or a macOS
  // `/var` → `/private/var` install would never match its own row.
  const stateKey = canonicalPluginRoot(paths.pluginRoot)

  async function commandExists(command) {
    try {
      const result = await run(command, ['--version'], { timeoutMs: 15000 })
      return !result.error && result.code === 0
    } catch {
      return false
    }
  }

  /** True when the managed virtualenv interpreter exists on disk. */
  function hasManagedVenv() {
    return existsSync(venvPythonPath(envDir))
  }

  /** Interpreter used for scripts: venv first, then the configured/system one. */
  function pythonExecutable() {
    return resolvePythonExecutable({
      envDir,
      hasVenv: hasManagedVenv(),
      pythonPath: config.pythonPath,
    })
  }

  /** Child-process environment: importable payload modules plus interception-safe roots. */
  function scriptEnv() {
    const built = buildScriptEnv({
      baseEnv: process.env,
      payloadRoot: paths.payloadRoot,
      envDir,
      hasVenv: hasManagedVenv(),
    })
    // A stale inherited ARS_DSH_VENV must not disagree with status()/ensure();
    // only the managed venv this adapter actually resolves is exported.
    if (!hasManagedVenv()) delete built.ARS_DSH_VENV
    return built
  }

  /** Absolute path of the generated POSIX sh wrapper for this plugin install. */
  function wrapperPath() {
    return contractWrapperPath(paths.binRoot)
  }

  /**
   * Record this plugin's `envDir` and `pythonPath` in the runtime-state table.
   *
   * The POSIX wrapper reads the entry keyed by this plugin root, which is what
   * makes a model-issued `bash bin/ars-python` honor a custom `envDir` **and**
   * the configured `pythonPath` (that shell does not inherit the `ars_script`
   * child environment). Other plugin installs keep their own rows, so two
   * profiles cannot overwrite each other's interpreter policy.
   *
   * Best effort: returns `false` instead of throwing so a read-only home
   * directory never breaks registration.
   *
   * @returns {boolean} whether the state file was written
   */
  function writeRuntimeState() {
    try {
      mkdirSync(dirname(statePath), { recursive: true })
      let entries = new Map()
      try {
        entries = parseStateText(readFileSync(statePath, 'utf8'))
      } catch {
        // Missing state file: start a fresh table.
      }
      entries.set(stateKey, { envDir, python: config.pythonPath ?? '' })
      const temporary = `${statePath}.${process.pid}.tmp`
      writeFileSync(temporary, renderStateText(entries), 'utf8')
      renameSync(temporary, statePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Probe readiness without mutating anything. Never throws.
   *
   * @returns {Promise<{mode: 'venv'|'system'|'unavailable', executable: string,
   *   venvPath: string, ready: boolean, missing: string[], uv: boolean,
   *   pythonVersion: string|null}>}
   */
  async function status() {
    const venvPath = envDir
    const venvPython = venvPythonPath(venvPath)
    const hasVenv = existsSync(venvPython)
    const executable = pythonExecutable()
    const allMissing = [...DEPENDENCY_MODULES]
    let uv = false
    let pythonVersion = null
    let missing = allMissing
    let interpreterFound = false
    let versionOk = true

    try {
      uv = await commandExists('uv')
    } catch {
      uv = false
    }

    try {
      const result = await run(executable, ['-c', PROBE_SCRIPT], {
        env: scriptEnv(),
        timeoutMs: 30000,
      })
      if (!result.error && result.code === 0 && result.stdout) {
        const line = result.stdout.trim().split('\n').pop()
        const parsed = JSON.parse(line)
        interpreterFound = true
        pythonVersion = typeof parsed.version === 'string' ? parsed.version : null
        versionOk = pythonVersion === null ? true : versionAtLeast(pythonVersion, MINIMUM_PYTHON)
        missing = Array.isArray(parsed.missing)
          ? parsed.missing.filter((name) => DEPENDENCY_MODULES.includes(name))
          : allMissing
      } else if (!result.error) {
        // The interpreter ran but the probe failed: report what we cannot verify.
        interpreterFound = true
      }
    } catch {
      interpreterFound = false
    }

    const mode = hasVenv ? 'venv' : interpreterFound ? 'system' : 'unavailable'
    return {
      mode,
      executable,
      venvPath,
      ready: interpreterFound && missing.length === 0 && versionOk,
      missing,
      uv,
      pythonVersion,
    }
  }

  /**
   * Create the virtualenv if needed and install `requirements-runtime.txt`.
   *
   * Prefers `uv`; falls back to `<python> -m venv` + `pip install`. Network
   * access is required for the install step, so this is only called from the
   * explicit `ars_env_setup` tool.
   *
   * @param {{force?: boolean, signal?: AbortSignal}} [options]
   * @returns {Promise<{ok: boolean, mode: string, venvPath: string, python: string,
   *   installed: string[], log: string}>}
   */
  async function ensure({ force = false, signal } = {}) {
    const venvPath = envDir
    await mkdir(dirname(venvPath), { recursive: true }).catch(() => {})
    const lockPath = venvPath + '.lock'
    const lockFd = await acquireLock(lockPath)
    try {
      return await ensureLocked({ force, signal })
    } finally {
      try { closeSync(lockFd) } catch { /* ignore */ }
      try { unlinkSync(lockPath) } catch { /* ignore */ }
    }
  }

  async function ensureLocked({ force = false, signal } = {}) {
    const log = []
    const note = (line) => log.push(line)
    const venvPath = envDir
    const venvPython = venvPythonPath(venvPath)
    const basePython = config.pythonPath || DEFAULT_PYTHON

    // force means "repair from scratch": remove the managed tree first so a
    // venv with a broken pip/interpreter is rebuilt instead of reused.
    if (force && existsSync(venvPath)) {
      note('force: removing the existing managed virtualenv')
      await rm(venvPath, { recursive: true, force: true }).catch(() => {})
    }

    const before = await status()
    note(
      `status before: mode=${before.mode} ready=${before.ready} ` +
        `missing=[${before.missing.join(', ')}] uv=${before.uv}`,
    )
    if (before.pythonVersion !== null && !versionAtLeast(before.pythonVersion, MINIMUM_PYTHON)) {
      note(`Python ${before.pythonVersion} is below the required minimum ${MINIMUM_PYTHON}`)
      return {
        ok: false,
        mode: before.mode,
        venvPath,
        python: before.executable,
        installed: [],
        log: log.join('\n'),
      }
    }

    if (before.ready && !force && existsSync(venvPython)) {
      note('managed virtualenv already ready; nothing to install')
      return { ok: true, mode: 'venv', venvPath, python: venvPython, installed: [], log: log.join('\n') }
    }

    if (!existsSync(requirements)) {
      note(`requirements file not found: ${requirements}`)
      return {
        ok: false,
        mode: before.mode,
        venvPath,
        python: pythonExecutable(),
        installed: [],
        log: log.join('\n'),
      }
    }

    const uv = before.uv
    if (!existsSync(venvPython)) {
      await mkdir(dirname(venvPath), { recursive: true }).catch(() => {})
      if (uv) {
        note(`uv venv --python ${basePython} ${venvPath}`)
        const created = await run('uv', ['venv', '--python', basePython, venvPath], {
          env: scriptEnv(),
          timeoutMs: 300000,
          signal,
        })
        note(`uv venv exit=${created.code}${created.error ? ` error=${created.error.message}` : ''}`)
        if (created.error || created.code !== 0) {
          note('uv venv failed; falling back to <python> -m venv')
        }
      }
      if (!existsSync(venvPython)) {
        note(`${basePython} -m venv ${venvPath}`)
        const created = await run(basePython, ['-m', 'venv', venvPath], {
          env: scriptEnv(),
          timeoutMs: 300000,
          signal,
        })
        note(
          `${basePython} -m venv exit=${created.code}` +
            `${created.error ? ` error=${created.error.message}` : ''}`,
        )
        if (created.error || created.code !== 0 || !existsSync(venvPython)) {
          note('virtualenv creation failed')
          return {
            ok: false,
            mode: 'unavailable',
            venvPath,
            python: pythonExecutable(),
            installed: [],
            log: log.join('\n'),
          }
        }
      }
    }

    let installOk = false
    if (uv) {
      note(`uv pip install --python ${venvPython} -r ${requirements}`)
      const installed = await run(
        'uv',
        ['pip', 'install', '--python', venvPython, '-r', requirements],
        { env: scriptEnv(), timeoutMs: 900000, signal },
      )
      installOk = !installed.error && installed.code === 0
      note(
        `uv pip install exit=${installed.code}` +
          `${installed.error ? ` error=${installed.error.message}` : ''}`,
      )
      if (!installOk) note('uv install failed; falling back to pip')
    }
    if (!installOk) {
      note(`${venvPython} -m pip install -r ${requirements}`)
      const installed = await run(venvPython, ['-m', 'pip', 'install', '-r', requirements], {
        env: scriptEnv(),
        timeoutMs: 900000,
        signal,
      })
      installOk = !installed.error && installed.code === 0
      note(
        `pip install exit=${installed.code}` +
          `${installed.error ? ` error=${installed.error.message}` : ''}`,
      )
    }

    const after = await status()
    const installed = before.missing.filter((name) => !after.missing.includes(name))
    note(
      `status after: mode=${after.mode} ready=${after.ready} ` +
        `missing=[${after.missing.join(', ')}]`,
    )
    if (!installOk && after.ready) note('install command reported failure but dependencies are present')
    return {
      ok: after.ready,
      mode: after.mode,
      venvPath,
      python: after.executable,
      installed: installed.map((name) => PACKAGE_NAMES[name] || name),
      log: log.join('\n'),
    }
  }

  return { status, ensure, pythonExecutable, scriptEnv, wrapperPath, writeRuntimeState }
}
