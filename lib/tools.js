/**
 * Model-facing tools for the plugin runtime: `ars_status`, `ars_script`, and
 * `ars_env_setup`.
 *
 * Tool definitions are plain objects (no Host helper imports): DSH validates
 * both `parameters` and `output.schema` against its enforced raw JSON Schema
 * subset — a single scalar `type` per node, object `properties`, array `items`,
 * and `oneOf` for unions. `required` is a top-level array (never a per-property
 * `required: true`).
 */
import { spawn } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'

import { buildStatus, STATUS_OUTPUT_SCHEMA } from './status.js'

const SCRIPT_EXTENSIONS = new Set(['.py', '.sh'])

const stringSchema = { type: 'string' }
const booleanSchema = { type: 'boolean' }

const SCRIPT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    stdout: stringSchema,
    stderr: stringSchema,
    truncated: booleanSchema,
    script: stringSchema,
    // Despite the historical name, this is the interpreter or managed wrapper
    // path that executed the script — not necessarily a bare python binary.
    python: { type: 'string', description: 'Interpreter or managed wrapper that executed the script.' },
  },
  required: ['exitCode', 'stdout', 'stderr', 'truncated', 'script', 'python'],
}

const ENV_SETUP_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: booleanSchema,
    mode: stringSchema,
    venvPath: stringSchema,
    python: stringSchema,
    installed: { type: 'array', items: stringSchema },
    log: stringSchema,
  },
  required: ['ok', 'mode', 'venvPath', 'python', 'installed', 'log'],
}

/** Register a factory through Cordis' effect scope when the Host provides it. */
function useEffect(ctx, factory) {
  if (typeof ctx.effect === 'function') {
    return ctx.effect(factory, 'academic-research-skills-tools')
  }
  return factory()
}

/**
 * Resolve a target that must stay inside `root`, rejecting traversal and
 * symlink escapes. The target must already exist.
 */
function resolveInside(root, candidate, label) {
  let realRoot
  try {
    realRoot = realpathSync(root)
  } catch {
    throw new Error(`ars_script: payload root is not available: ${root}`)
  }
  const absolute = isAbsolute(candidate) ? candidate : resolve(realRoot, candidate)
  let realTarget
  try {
    realTarget = realpathSync(absolute)
  } catch {
    throw new Error(`ars_script: ${label} not found under the payload root: ${candidate}`)
  }
  const rel = relative(realRoot, realTarget)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`ars_script: ${label} escapes the payload root: ${candidate}`)
  }
  return { realRoot, realTarget, rel }
}

function normalizeArgs(args) {
  if (args === undefined) return []
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('ars_script: args must be an array of strings')
  }
  return args
}

/** Drop an incomplete trailing UTF-8 sequence so capped output decodes cleanly. */
function trimIncompleteUtf8(buffer) {
  let end = buffer.length
  if (end === 0) return buffer
  let start = end - 1
  while (start >= 0 && (buffer[start] & 0xc0) === 0x80) start -= 1
  if (start < 0) return buffer
  const lead = buffer[start]
  const needed = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1
  if (start + needed <= end) return buffer
  return buffer.subarray(0, start)
}

function appendCapped(state, chunk, cap) {
  if (state.bytes >= cap) {
    state.truncated = true
    return
  }
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
  const remaining = cap - state.bytes
  if (buffer.length > remaining) {
    const kept = trimIncompleteUtf8(buffer.subarray(0, remaining))
    state.parts.push(kept)
    state.bytes = cap
    state.truncated = true
  } else {
    state.parts.push(buffer)
    state.bytes += buffer.length
  }
}

function renderCapped(state) {
  return trimIncompleteUtf8(Buffer.concat(state.parts)).toString('utf8')
}

/**
 * Run one script under the payload root.
 *
 * @param {object} options
 * @param {ReturnType<import('./paths.js').createPaths>} options.paths
 * @param {ReturnType<import('./config.js').normalizeConfig>} options.config
 * @param {{pythonExecutable: () => string, scriptEnv: () => Record<string,string>}} options.env
 * @param {{script?: unknown, args?: unknown, cwd?: unknown, timeoutMs?: unknown}} args
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>}
 */
export async function runScript({ paths, config, env }, args, signal) {
  if (!args || typeof args.script !== 'string' || args.script.length === 0) {
    throw new Error('ars_script: "script" must be a non-empty string')
  }
  const { realTarget } = resolveInside(paths.payloadRoot, args.script, 'script')
  if (!existsSync(realTarget) || !statSync(realTarget).isFile()) {
    throw new Error(`ars_script: not a regular file: ${args.script}`)
  }
  const extension = extname(realTarget).toLowerCase()
  if (!SCRIPT_EXTENSIONS.has(extension)) {
    throw new Error(`ars_script: unsupported script type "${extension || '(none)'}" (only .py and .sh)`)
  }

  let cwd = paths.payloadRoot
  if (args.cwd !== undefined) {
    if (typeof args.cwd !== 'string' || args.cwd.length === 0) {
      throw new Error('ars_script: "cwd" must be a non-empty string when provided')
    }
    const { realTarget: realCwd } = resolveInside(paths.payloadRoot, args.cwd, 'cwd')
    if (!statSync(realCwd).isDirectory()) {
      throw new Error(`ars_script: cwd is not a directory: ${args.cwd}`)
    }
    cwd = realCwd
  }

  const scriptArgs = normalizeArgs(args.args)
  let timeoutMs = config.scriptTimeoutMs
  if (args.timeoutMs !== undefined) {
    if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0 || args.timeoutMs > 2 ** 31 - 1) {
      throw new Error('ars_script: "timeoutMs" must be a positive integer <= 2147483647')
    }
    timeoutMs = args.timeoutMs
  }
  const cap = Math.max(1024, config.maxScriptOutputBytes)
  // One resolver for execution: the generated wrapper owns envDir/venv order,
  // PYTHONPATH, and bytecode policy. env.writeRuntimeState() keeps a custom
  // envDir visible to a model-issued `bash bin/ars-python` too.
  const interpreter = extension === '.py'
    ? (typeof env.wrapperPath === 'function' ? env.wrapperPath() : env.pythonExecutable())
    : 'bash'
  const argv = [realTarget, ...scriptArgs]

  return await new Promise((resolvePromise) => {
    const stdout = { parts: [], bytes: 0, truncated: false }
    const stderr = { parts: [], bytes: 0, truncated: false }
    let settled = false
    let aborted = false
    let timedOut = false
    let killTimer = null
    let timeoutTimer = null

    const settle = (exitCode, error) => {
      if (settled) return
      settled = true
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (killTimer) clearTimeout(killTimer)
      signal?.removeEventListener?.('abort', onAbort)
      if (timedOut) {
        appendCapped(stderr, `\n[ars_script] timed out after ${timeoutMs}ms`, cap)
      }
      if (aborted) {
        appendCapped(stderr, '\n[ars_script] aborted by the caller', cap)
      }
      if (error) {
        appendCapped(stderr, `\n[ars_script] ${error.message}`, cap)
      }
      resolvePromise({
        exitCode:
          timedOut || aborted ? null : typeof exitCode === 'number' ? exitCode : null,
        stdout: renderCapped(stdout),
        stderr: renderCapped(stderr),
        truncated: stdout.truncated || stderr.truncated,
        script: realTarget,
        python: interpreter,
      })
    }

    let child
    try {
      child = spawn(interpreter, argv, {
        cwd,
        env: env.scriptEnv(),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // POSIX: own process group so a timeout can kill grandchildren too.
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      settle(null, error)
      return
    }

    const killTree = (signalName) => {
      try {
        if (process.platform !== 'win32' && typeof child.pid === 'number') {
          process.kill(-child.pid, signalName)
        } else {
          child.kill(signalName)
        }
      } catch {
        /* already gone */
      }
    }

    const onAbort = () => {
      aborted = true
      killTree('SIGKILL')
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (chunk) => appendCapped(stdout, chunk, cap))
    child.stderr?.on('data', (chunk) => appendCapped(stderr, chunk, cap))
    child.on('error', (error) => settle(null, error))
    child.on('close', (code) => settle(code))
    // A script may exit while a background grandchild still holds the pipe.
    // Settle after a short grace so ars_script cannot hang forever.
    child.on('exit', (code) => {
      const grace = setTimeout(() => {
        child.stdout?.destroy()
        child.stderr?.destroy()
        settle(code)
      }, 1000)
      grace.unref?.()
    })

    timeoutTimer = setTimeout(() => {
      timedOut = true
      killTree('SIGTERM')
      killTimer = setTimeout(() => {
        killTree('SIGKILL')
      }, 2000)
      killTimer.unref?.()
    }, timeoutMs)
    timeoutTimer.unref?.()
  })
}

/**
 * Register the three ARS tools.
 *
 * @param {object} ctx DSH plugin context
 * @param {object} options
 * @param {ReturnType<import('./paths.js').createPaths>} options.paths
 * @param {ReturnType<import('./config.js').normalizeConfig>} options.config
 * @param {{status: Function, ensure: Function, pythonExecutable: Function, scriptEnv: Function}} options.env
 * @param {{lint?: Function}} [options.adapter]
 * @param {string[]} [options.warnings] registration-time lint warnings to expose in ars_status
 * @returns {void}
 */
export function registerTools(ctx, { paths, config, env, adapter, inventory, report, warnings = [] }) {
  if (config?.tools === false) return
  if (typeof ctx?.tools?.register !== 'function') {
    throw new Error('registerTools requires ctx.tools.register')
  }

  const statusTool = {
    name: 'ars_status',
    description:
      'Report the Academic Research Skills runtime state: payload counts and provenance, ' +
      'Python dependency readiness, guard configuration, live registration of the ARS ' +
      'skills and /ars-* commands, and compatibility-lint warnings. Use it to diagnose a ' +
      'missing payload, missing Python packages, or an incomplete registration.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: STATUS_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec) {
      return await buildStatus({
        paths,
        config,
        env,
        ctx,
        agent: exec?.agent,
        adapter,
        inventory,
        report,
        warnings,
      })
    },
  }

  const scriptTool = {
    name: 'ars_script',
    description:
      'Run one upstream Python (.py) or shell (.sh) script from the payload with the generated ' +
      'managed interpreter wrapper (bin/ars-python). Arguments are passed as a literal argv array (no shell). stdout and stderr ' +
      'are captured separately with a per-stream byte cap, so long gate output stays bounded. ' +
      'Use it for deterministic ARS gates instead of composing shell commands.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        script: {
          type: 'string',
          description:
            'Path to a .py or .sh script inside the payload root; absolute or payload-relative.',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Literal argv entries appended after the script path.',
        },
        cwd: {
          type: 'string',
          description:
            'Working directory; relative values resolve against the payload root. Defaults to the payload root.',
        },
        timeoutMs: {
          type: 'integer',
          description:
            'Hard timeout in milliseconds; defaults to the configured scriptTimeoutMs.',
        },
      },
      required: ['script'],
    },
    output: {
      schema: SCRIPT_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const parts = [
          `exitCode=${value.exitCode === null ? 'null' : value.exitCode} script=${value.script} interpreter=${value.python}`,
          value.truncated ? 'output truncated at the configured byte cap' : null,
          '--- stdout ---',
          value.stdout || '(empty)',
          '--- stderr ---',
          value.stderr || '(empty)',
        ].filter(Boolean)
        return [{ type: 'text', text: parts.join('\n') }]
      },
    },
    async execute(args, exec) {
      return await runScript({ paths, config, env }, args || {}, exec?.signal)
    },
  }

  const envSetupTool = {
    name: 'ars_env_setup',
    description:
      'Create or refresh the managed Python virtualenv and install the runtime dependencies ' +
      'from requirements-runtime.txt. Prefers uv when available and falls back to python -m venv ' +
      'plus pip. Requires network access to the package index; run it only when ars_status ' +
      'reports missing packages.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        force: {
          type: 'boolean',
          description: 'Reinstall dependencies even when the environment already reports ready.',
        },
      },
    },
    output: {
      schema: ENV_SETUP_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const installed = value.installed.length > 0 ? value.installed.join(', ') : '(none)'
        return [
          {
            type: 'text',
            text:
              `ok=${value.ok} mode=${value.mode} python=${value.python} venv=${value.venvPath}\n` +
              `installed: ${installed}\n${value.log}`,
          },
        ]
      },
    },
    async execute(args, exec) {
      const result = await env.ensure({ force: args?.force === true, signal: exec?.signal })
      if (typeof env.writeRuntimeState === 'function') {
        try {
          env.writeRuntimeState()
        } catch {
          /* state publication must never fail the setup result */
        }
      }
      return result
    },
  }

  useEffect(ctx, () => {
    const disposers = [
      ctx.tools.register(statusTool),
      ctx.tools.register(scriptTool),
      ctx.tools.register(envSetupTool),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {
          /* individual disposer failures must not block the rest */
        }
      }
    }
  })
}

export { SCRIPT_OUTPUT_SCHEMA, ENV_SETUP_OUTPUT_SCHEMA }
