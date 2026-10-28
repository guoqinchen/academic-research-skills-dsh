/**
 * DSH write-scope guard — faithful port of upstream
 * `scripts/ars_write_scope_guard.py::evaluate_decision` (ARS 3.24.0).
 *
 * Two enforcement paths, mirroring upstream:
 *   * Infra self-protection — no caller (not even an unrestricted session) may
 *     write the plugin's own enforcement files. Anchored on the PLUGIN root and
 *     checked before the workspace escape check, exactly like upstream #448.
 *   * Bucket A phase fence — a single-phase agent may only write inside its
 *     phase-scoped directory, and all Bash is denied for it. It applies only
 *     when a caller supplies an explicit `agentType`.
 *
 * DSH differences documented honestly:
 *   * DSH tools are `write` / `edit` / `bash` (and use `file_path` for writes);
 *     `evaluateDecision` maps them through `toolMap` before applying upstream's
 *     exact-name tool boundary.
 *   * The plugin adds one tool upstream has no equivalent for: `ars_script`.
 *     It is inspected as a *declared-output* tool — a Bucket A agent may not
 *     run payload scripts at all (same rationale as Bash), and every caller is
 *     denied when an `--out`/`--output`/`-o` target resolves into the plugin's
 *     enforcement files. Positional arguments are not interpreted, so this is
 *     an infrastructure guard, not a sandbox (documented in README).
 *   * Upstream reads `agent_type` from the hook payload. DSH tool executions
 *     expose only `exec.agent` (a live Agent) and carry no agent type, and this
 *     module deliberately keeps no role registry, so `registerGuard` never
 *     supplies `agentType`: the phase fence is unavailable (see
 *     {@link PHASE_FENCE_STATUS}). `evaluateDecision` keeps the full
 *     `agentType`/phase logic for upstream Python parity and for a future
 *     integration that has a real, explicit role source. Infra protection and
 *     schema-drift denial still apply to every caller.
 *   * The workspace root is the executing session's canonical cwd
 *     (`agent.session.header.cwd`), with `process.cwd()` as the fallback.
 *
 * The pure decision function has no I/O; only `registerGuard` loads the
 * manifest once and subscribes the synchronous `ctx.tools.guard` hook.
 */
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { sep as PATH_SEP } from 'node:path'

/** Upstream's plugin-scoped agent prefix (`<plugin>:<agent>`). */
export const PLUGIN_AGENT_NAMESPACE = 'academic-research-skills:'

/** Structured editing tools: deterministic, single top-level `file_path`. */
export const STRUCTURED_WRITE_TOOLS = Object.freeze(['Write', 'Edit', 'MultiEdit'])

/**
 * Canonical name for the plugin's script tool. `ars_script` can write files
 * through its own arguments, so it is inspected for declared output paths
 * instead of being treated as an opaque execution tool.
 */
export const SCRIPT_TOOL_CANONICAL = 'ArsScript'

/** Every upstream-inspected tool. Anything else passes through untouched. */
export const INSPECTED_TOOLS = Object.freeze([...STRUCTURED_WRITE_TOOLS, 'Bash', SCRIPT_TOOL_CANONICAL])

const INSPECTED = new Set(INSPECTED_TOOLS)

/** DSH tool name -> upstream canonical name. */
export const DEFAULT_TOOL_MAP = Object.freeze({
  write: 'Write',
  edit: 'Edit',
  multi_edit: 'MultiEdit',
  bash: 'Bash',
  ars_script: SCRIPT_TOOL_CANONICAL,
})

/**
 * Flags that name an output location in an `ars_script` argv array. Only
 * explicitly declared outputs are resolved; positional arguments are not
 * guessed at (see {@link extractScriptOutputTargets}).
 *
 * The list is limited to flags that actually occur in the payload (`--out`,
 * `--output`, `--out-dir`, `--output-dir`, `--dest`, `--destination`,
 * `--target`, `-o`) plus `--dir` as the only generic alias; `--write`,
 * `--outfile`, and `--outputs` were dropped after a payload-wide scan showed
 * zero uses, which removes the risk of reading a boolean flag as a path.
 */
export const SCRIPT_OUTPUT_FLAGS = Object.freeze([
  '--out',
  '--out-dir',
  '--output',
  '--output-dir',
  '--dir',
  '--dest',
  '--destination',
  '--target',
  '-o',
])

const SCRIPT_OUTPUT_FLAG_SET = new Set(SCRIPT_OUTPUT_FLAGS)

/**
 * Honest status of the Bucket A phase fence for `ars_status` / documentation.
 *
 * DSH tool executions do not expose an agent type, and this module does not
 * invent one by keeping a role registry. The evaluator still implements the
 * fence for callers that have an explicit role source; the registered guard has
 * none, so the fence is reported as unavailable rather than silently assumed.
 */
export const PHASE_FENCE_STATUS = Object.freeze({
  mode: 'unavailable',
  reason:
    'DSH tool executions expose no agent type; the upstream phase fence needs an explicit role source.',
})

/**
 * Enforcement surfaces relative to the PLUGIN root.
 *
 * The upstream list protects the repo-root layout (`hooks/`, `scripts/`,
 * `<skill>/agents/`, `agents/`, `.claude-plugin/`); the payload copy keeps that
 * layout one level down, so both spellings are listed. The plugin's own wiring
 * files are protected as well — editing them would be equivalent to editing the
 * upstream enforcement files.
 */
export const INFRA_PROTECTED_GLOBS = Object.freeze([
  // Plugin code that registers and enforces the guard / tools.
  'index.js',
  'lib/**',
  'bin/**',
  'cordis.patch.yml',
  'package.json',
  // Payload copy of the upstream enforcement surface.
  'payload/hooks/**',
  'payload/scripts/ars_write_scope_guard.py',
  'payload/scripts/ars_phase_scope_manifest.json',
  'payload/scripts/check_v3_10_134_write_scope.py',
  'payload/*/agents/*.md',
  'payload/agents/*.md',
  // Upstream-shaped root entries (tests point the guard at the upstream repo;
  // also keeps a future flattened payload protected).
  'hooks/hooks.json',
  'hooks/*.sh',
  '.claude-plugin/plugin.json',
  'scripts/ars_write_scope_guard.py',
  'scripts/ars_phase_scope_manifest.json',
  'scripts/check_v3_10_134_write_scope.py',
  '*/agents/*.md',
  'agents/*.md',
  'shared/agents/*.md',
  'deep-research/agents/*.md',
  'academic-paper/agents/*.md',
  'academic-paper-reviewer/agents/*.md',
  'academic-pipeline/agents/*.md',
  // Filename-anchored protection in any subdirectory AND at the root.
  '**/ars_write_scope_guard.py',
  'ars_write_scope_guard.py',
  '**/ars_phase_scope_manifest.json',
  'ars_phase_scope_manifest.json',
  '**/check_v3_10_134_write_scope.py',
  'check_v3_10_134_write_scope.py',
])

const regexCache = new Map()
const normcase = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)

function escapeRegex(text) {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

/**
 * Translate one shell glob segment into a full-segment regular expression.
 * Mirrors `fnmatch.translate`; `*` and `?` are constrained to the segment by
 * construction (the segment never contains the path separator).
 */
function fnmatchTranslate(pattern) {
  let translated = ''
  let i = 0
  while (i < pattern.length) {
    const char = pattern[i]
    i += 1
    if (char === '*') {
      while (pattern[i] === '*') i += 1
      translated += '.*'
    } else if (char === '?') {
      translated += '.'
    } else if (char === '[') {
      let j = i
      if (pattern[j] === '!') j += 1
      if (pattern[j] === ']') j += 1
      while (j < pattern.length && pattern[j] !== ']') j += 1
      if (j >= pattern.length) {
        translated += '\\['
      } else {
        let stuff = pattern.slice(i, j)
        stuff = stuff.replace(/\\/g, '\\\\')
        if (stuff.startsWith('!')) {
          stuff = `^${stuff.slice(1)}`
        } else if (stuff.startsWith('^')) {
          stuff = `\\${stuff}`
        }
        translated += `[${stuff}]`
      }
      i = j + 1
    } else {
      translated += escapeRegex(char)
    }
  }
  return `^(?:${translated})$`
}

/** Shell-glob match for a single path segment (no `/` semantics). */
export function fnmatch(value, pattern) {
  const left = normcase(value)
  const right = normcase(pattern)
  let regex = regexCache.get(right)
  if (!regex) {
    try {
      regex = new RegExp(`(?:${fnmatchTranslate(right)})`, 'su')
    } catch {
      regex = new RegExp(`^(?:${escapeRegex(right)})$`, 'u')
    }
    regexCache.set(right, regex)
  }
  return regex.test(left)
}

/**
 * Path-segment-aware glob matcher (iterative NFA, no recursion).
 *
 * `*` / `?` / `[...]` never cross `/`; the literal segment `**` consumes ONE OR
 * MORE whole segments (a descendant, never the bare directory itself).
 */
export function matchSegments(pathSegments, patternSegments) {
  const n = pathSegments.length
  const m = patternSegments.length
  const stack = [[0, 0]]
  const seen = new Set()
  while (stack.length > 0) {
    const [i, j] = stack.pop()
    const key = `${i}:${j}`
    if (seen.has(key)) continue
    seen.add(key)
    if (j === m) {
      if (i === n) return true
      continue
    }
    const head = patternSegments[j]
    if (head === '**') {
      if (i < n) {
        stack.push([i + 1, j + 1])
        stack.push([i + 1, j])
      }
      continue
    }
    if (i < n && fnmatch(pathSegments[i], head)) {
      stack.push([i + 1, j + 1])
    }
  }
  return false
}

/** Workspace/plugin-root anchored glob match against a relative path. */
export function matchesAny(relPath, globs) {
  let value = relPath
  // Only treat `\` as a separator where the platform does; on POSIX it is a
  // legal filename character (upstream review finding #450).
  if (PATH_SEP === '\\') value = value.replace(/\\/g, '/')
  const segments = value.split('/').filter((part) => part !== '' && part !== '.')
  for (const glob of globs || []) {
    const patternSegments = String(glob).split('/').filter((part) => part !== '')
    if (matchSegments(segments, patternSegments)) return true
  }
  return false
}

/**
 * Faithful port of CPython `posixpath.realpath` (non-strict): resolves symlinks
 * and `..` together in true filesystem order, tolerates a not-yet-created leaf,
 * and detects symlink loops without throwing.
 *
 * Porting this instead of `path.resolve` matters: lexical `..` collapsing
 * before symlink resolution would blind the guard to the real target.
 */
export function realpath(rawPath) {
  const filename = String(rawPath)
  const path = filename.startsWith(PATH_SEP) ? PATH_SEP : process.cwd()
  let resolved = path
  // `filename.rstrip(sep).split(sep)[::-1]`
  let trimmed = filename
  while (trimmed.length > 1 && trimmed.endsWith(PATH_SEP)) {
    trimmed = trimmed.slice(0, -1)
  }
  if (trimmed === PATH_SEP) trimmed = ''
  const rest = trimmed.split(PATH_SEP).reverse()
  let partCount = rest.length
  const seen = new Map()

  while (partCount > 0) {
    const name = rest.pop()
    if (name === null) {
      seen.set(rest.pop(), resolved)
      continue
    }
    partCount -= 1
    if (!name || name === '.') continue
    if (name === '..') {
      const index = resolved.lastIndexOf(PATH_SEP)
      resolved = index <= 0 ? PATH_SEP : resolved.slice(0, index)
      continue
    }
    const candidate = resolved === PATH_SEP ? PATH_SEP + name : resolved + PATH_SEP + name
    let target
    let stat
    try {
      stat = lstatSync(candidate)
      if (!stat.isSymbolicLink()) {
        resolved = candidate
        continue
      }
      if (seen.has(candidate)) {
        const cached = seen.get(candidate)
        resolved = cached === null || cached === undefined ? candidate : cached
        continue
      }
      target = readlinkSync(candidate)
    } catch {
      // Ignored OSError (ENOENT/EACCES/...): treat as a plain component.
      resolved = candidate
      continue
    }
    if (target.startsWith(PATH_SEP)) resolved = PATH_SEP
    seen.set(candidate, null)
    rest.push(candidate)
    rest.push(null)
    const targetParts = target.split(PATH_SEP).reverse()
    rest.push(...targetParts)
    partCount += targetParts.length
  }
  return resolved
}

/**
 * Canonicalize the on-disk spelling of an existing path prefix.
 *
 * APFS/HFS+ (macOS) and NTFS (Windows) compare paths case-insensitively, so a
 * caller can name `LIB/guard.js` and overwrite `lib/guard.js`. `realpath`
 * above resolves symlinks but preserves the caller's case; `realpathSync.native`
 * returns the filesystem's spelling. Non-existent trailing components (a write
 * to a not-yet-created leaf) are appended verbatim so containment checks still
 * run on the canonical directory.
 */
function canonicalCase(absolutePath) {
  const parts = String(absolutePath).split(PATH_SEP)
  for (let index = parts.length; index > 0; index -= 1) {
    const prefix =
      index === 1 && parts[0] === '' ? PATH_SEP : parts.slice(0, index).join(PATH_SEP)
    try {
      const real = realpathSync.native(prefix)
      const rest = parts.slice(index)
      return rest.length === 0 ? real : real + PATH_SEP + rest.join(PATH_SEP)
    } catch {
      // Try the longest existing ancestor next.
    }
  }
  return absolutePath
}

/** Python `os.path.commonpath` for two absolute paths. */
export function commonPath(paths) {
  const split = (value) => String(value).split(PATH_SEP)
  const first = split(paths[0])
  let end = first.length
  for (const candidate of paths.slice(1)) {
    const parts = split(candidate)
    let index = 0
    while (index < end && index < parts.length && first[index] === parts[index]) index += 1
    end = index
  }
  return first.slice(0, end).join(PATH_SEP) || PATH_SEP
}

/**
 * Step 1 — resolve to a workspace-root-relative canonical path.
 *
 * @returns {{relPath: string|null, escaped: boolean}}
 */
export function normalizeTarget(rawPath, cwd, workspaceRoot) {
  const absolute = absolutize(rawPath, cwd)
  const normalized = canonicalCase(realpath(absolute))
  const realWorkspace = canonicalCase(realpath(workspaceRoot))
  if (commonPath([normalized, realWorkspace]) !== realWorkspace) {
    return { relPath: null, escaped: true }
  }
  const relPath = pathRelative(realWorkspace, normalized)
  if (relPath === '.') return { relPath: null, escaped: true }
  return { relPath, escaped: false }
}

/** Python `os.path.relpath` port (both arguments are absolute). */
function pathRelative(from, to) {
  const fromParts = from.split(PATH_SEP)
  const toParts = to.split(PATH_SEP)
  let common = 0
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common += 1
  }
  const up = new Array(fromParts.length - common).fill('..')
  const down = toParts.slice(common)
  return [...up, ...down].join(PATH_SEP) || '.'
}

/**
 * Step 2 — is the target one of the plugin's OWN enforcement files?
 * Runs FIRST, before the workspace escape check (upstream #448).
 */
export function infraProtectedTarget(rawPath, cwd, pluginRoot, globs = INFRA_PROTECTED_GLOBS) {
  if (!pluginRoot) return false
  const absolute = absolutize(rawPath, cwd)
  const normalized = canonicalCase(realpath(absolute))
  const realPlugin = canonicalCase(realpath(pluginRoot))
  if (commonPath([normalized, realPlugin]) !== realPlugin) return false
  const relPath = pathRelative(realPlugin, normalized)
  if (relPath === '.') return false
  return matchesAny(relPath, globs)
}

/** Strip this plugin's agent namespace: `<plugin>:<agent>` -> `<agent>`. */
export function manifestKey(agentType) {
  if (typeof agentType === 'string' && agentType.startsWith(PLUGIN_AGENT_NAMESPACE)) {
    return agentType.slice(PLUGIN_AGENT_NAMESPACE.length)
  }
  return agentType
}

function allowUnconstrained(agentType) {
  const result = { decision: 'allow', reason: '' }
  if (!agentType) result.absent_agent_type_advisory = true
  return result
}

function extractStructuredTarget(toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return null
  const filePath = toolInput.file_path
  return typeof filePath === 'string' && filePath.length > 0 ? filePath : null
}

/**
 * Declared output targets of one `ars_script` invocation.
 *
 * Handles `--out <path>`, `--out=<path>`, and `-o <path>` for the flags in
 * {@link SCRIPT_OUTPUT_FLAGS}. Positional arguments are deliberately ignored:
 * guessing which of them is an output would both over-deny reads and still
 * miss implicit writes, so the honest boundary is "declared outputs are
 * checked, the rest is not a sandbox".
 *
 * @param {unknown} toolInput
 * @returns {string[]}
 */
export function extractScriptOutputTargets(toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return []
  const args = toolInput.args
  if (!Array.isArray(args)) return []
  const targets = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (typeof arg !== 'string' || arg.length === 0) continue
    if (arg.startsWith('-')) {
      const equals = arg.indexOf('=')
      if (equals > 0) {
        if (SCRIPT_OUTPUT_FLAG_SET.has(arg.slice(0, equals))) {
          const value = arg.slice(equals + 1)
          if (value.length > 0) targets.push(value)
        }
        continue
      }
      if (!SCRIPT_OUTPUT_FLAG_SET.has(arg)) continue
      const next = args[index + 1]
      if (typeof next === 'string' && next.length > 0 && !next.startsWith('-')) {
        targets.push(next)
        index += 1
      }
    }
  }
  return targets
}

/**
 * Pure decision function — port of upstream `evaluate_decision`.
 *
 * @param {object} options
 * @param {string} options.toolName DSH tool name (`write`, `edit`, `bash`, ...)
 * @param {unknown} [options.toolInput]
 * @param {string|null} [options.agentType] bare or plugin-scoped ARS agent name
 * @param {string} [options.cwd] payload cwd for relative targets
 * @param {string} options.workspaceRoot user project root (phase-fence anchor)
 * @param {string} [options.pluginRoot] plugin install root (infra anchor)
 * @param {object|null} [options.manifest] parsed phase-scope manifest
 * @param {Record<string,string>} [options.toolMap] DSH -> canonical tool map
 * @param {boolean} [options.guardInfra=true] apply infra self-protection
 * @returns {{decision: 'allow'|'deny', reason: string, bash_denied?: boolean,
 *   schema_drift_advisory?: boolean, absent_agent_type_advisory?: boolean}}
 */
export function evaluateDecision({
  toolName,
  toolInput = {},
  agentType,
  cwd,
  workspaceRoot,
  pluginRoot,
  manifest,
  toolMap = DEFAULT_TOOL_MAP,
  guardInfra = true,
}) {
  // Upstream defaults the workspace root to the payload cwd when the hook has
  // none; keep that behavior instead of throwing on a malformed call.
  const effectiveWorkspaceRoot = workspaceRoot || cwd || process.cwd()
  const effectiveCwd =
    typeof cwd === 'string' && cwd.length > 0 ? cwd : effectiveWorkspaceRoot
  const resolvedPluginRoot = pluginRoot || effectiveWorkspaceRoot
  const canonicalName =
    (typeof toolName === 'string' && toolMap[toolName]) ||
    (typeof toolName === 'string' && INSPECTED.has(toolName) ? toolName : null)
  if (!canonicalName) return { decision: 'allow', reason: '' }

  const agents = manifest?.agents && typeof manifest.agents === 'object' ? manifest.agents : {}
  const agentKey = manifestKey(agentType)
  const isBucketA = Boolean(agentKey) && Object.prototype.hasOwnProperty.call(agents, agentKey)

  // --- Bash: deny ALL for a Bucket A agent; everything else passes through. ---
  if (canonicalName === 'Bash') {
    if (isBucketA) {
      return {
        decision: 'deny',
        reason:
          `ARS scope guard: ${agentType} (a single-phase agent) may not use Bash. ` +
          'Use the grep/glob tools to search and the write/edit tools to make file ' +
          'changes — those are scope-enforced deterministically. Bash is denied ' +
          "wholesale because neither 'writes a file' nor 'is read-only' is a property " +
          'that can be decided reliably from a command string (a tool can spawn a ' +
          'subprocess or be steered by an env var); all-deny is the only policy that ' +
          'cannot fail open (spec §3.2/§3.3/§7).',
        bash_denied: true,
      }
    }
    return { decision: 'allow', reason: '' }
  }

  // --- ars_script: a Bucket A agent may not run scripts at all; everyone
  // else keeps infrastructure protection for declared output paths. ---
  if (canonicalName === SCRIPT_TOOL_CANONICAL) {
    if (isBucketA) {
      return {
        decision: 'deny',
        reason:
          `ARS scope guard: ${agentType} (a single-phase agent) may not run payload ` +
          'scripts. Like Bash, a script can read and write outside its phase, and ' +
          '"is read-only" cannot be decided from its argument list (spec §3.2/§7).',
        script_denied: true,
      }
    }
    for (const target of extractScriptOutputTargets(toolInput)) {
      if (guardInfra && infraProtectedTarget(target, effectiveCwd, resolvedPluginRoot)) {
        return {
          decision: 'deny',
          reason:
            `ARS scope guard: ars_script output ${JSON.stringify(target)} is part of the ` +
            "ARS plugin's enforcement infrastructure and may not be written by any agent.",
        }
      }
    }
    return allowUnconstrained(agentType)
  }

  // --- Structured tools: extract the single top-level file_path. ---
  const raw = extractStructuredTarget(toolInput === null || typeof toolInput !== 'object' ? {} : toolInput)
  if (raw === null) {
    return {
      decision: 'deny',
      reason:
        `ARS scope guard: ${toolName} payload carried no top-level file_path ` +
        '(unexpected schema) — denying to avoid silent fail-open. ' +
        'Re-verify the tool_input shape.',
      schema_drift_advisory: true,
    }
  }

  // --- Step 2: infrastructure self-protection (anchored on pluginRoot). ---
  if (guardInfra && infraProtectedTarget(raw, effectiveCwd, resolvedPluginRoot)) {
    return {
      decision: 'deny',
      reason:
        `ARS scope guard: ${raw} is part of the ARS plugin's enforcement ` +
        'infrastructure and may not be written by any agent.',
    }
  }

  const { relPath, escaped } = normalizeTarget(raw, effectiveCwd, effectiveWorkspaceRoot)
  if (escaped) {
    // Escape denial is a Bucket A fence, not a global one (upstream #302).
    if (isBucketA) {
      return {
        decision: 'deny',
        reason:
          `ARS scope guard: ${agentType} write target ${JSON.stringify(raw)} escapes ` +
          'the workspace root (path traversal) — denied.',
      }
    }
    return allowUnconstrained(agentType)
  }

  // --- Step 3: agent gating. No known ARS role -> unconstrained. ---
  if (!isBucketA) return allowUnconstrained(agentType)

  // --- Step 4: Bucket A glob check (path already normalized). ---
  const allowed = Array.isArray(agents[agentKey].allowed_write_globs)
    ? agents[agentKey].allowed_write_globs
    : []
  if (!matchesAny(relPath, allowed)) {
    return {
      decision: 'deny',
      reason:
        `ARS scope guard: ${agentType} may not write ${relPath} ` +
        `(outside allowed_write_globs ${JSON.stringify(allowed)}).`,
    }
  }
  return { decision: 'allow', reason: '' }
}

/** Make a target absolute without lexical `..` normalization (see realpath). */
function absolutize(rawPath, cwd) {
  if (isAbsolute(rawPath)) return rawPath
  return `${cwd}${PATH_SEP}${rawPath}`
}

function loadManifest(paths, logger) {
  const manifestPath = paths.scriptManifestPath ?? join(paths.scriptsRoot, 'ars_phase_scope_manifest.json')
  try {
    return { manifest: JSON.parse(readFileSync(manifestPath, 'utf8')), path: manifestPath }
  } catch (error) {
    logger?.warn?.(
      `[ars] phase-scope manifest unreadable at ${manifestPath}; ` +
        `phase fencing unavailable (infra protection still active): ${error.message}`,
    )
    return { manifest: { version: 0, agents: {} }, path: manifestPath }
  }
}

/**
 * Register the synchronous `ctx.tools.guard` hook.
 *
 * DSH carries no `agent_type` field on tool executions and this module keeps no
 * role registry (see {@link PHASE_FENCE_STATUS}), so the registered guard never
 * supplies `agentType` to {@link evaluateDecision}: the Bucket A phase fence is
 * unavailable, exactly like upstream's unconstrained main session. Infra
 * self-protection and the schema-drift deny still apply to every caller.
 *
 * @param {object} ctx DSH plugin context (`ctx.tools.guard`, optional `ctx.effect`)
 * @param {object} options
 * @param {ReturnType<import('./paths.js').createPaths>} options.paths
 * @param {ReturnType<import('./config.js').normalizeConfig>} options.config
 * @param {object} [options.manifest] pre-parsed manifest (tests)
 * @param {Record<string,string>} [options.toolMap]
 * @param {string} [options.workspaceRoot] fixed workspace root (tests)
 * @returns {boolean} whether a guard was registered
 */
export function registerGuard(ctx, options = {}) {
  const { paths, config } = options
  if (config && config.guard === false) return false
  if (typeof ctx?.tools?.guard !== 'function') {
    ctx?.logger?.warn?.('[ars] ctx.tools.guard is unavailable; write-scope guard not registered')
    return false
  }
  const logger = ctx.logger
  const manifestPath = paths.phaseManifestPath ?? join(paths.scriptsRoot, 'ars_phase_scope_manifest.json')
  const loaded = options.manifest
    ? { manifest: options.manifest, path: manifestPath }
    : loadManifest({ ...paths, scriptManifestPath: manifestPath }, logger)
  const manifest = loaded.manifest
  const toolMap = options.toolMap || DEFAULT_TOOL_MAP
  const fixedWorkspaceRoot = options.workspaceRoot

  const guard = (execution) => {
    try {
      const agent = execution?.agent
      const workspaceRoot =
        fixedWorkspaceRoot || agent?.session?.header?.cwd || process.cwd()
      const decision = evaluateDecision({
        toolName: execution?.name,
        toolInput: execution?.arguments,
        agentType: null,
        cwd: workspaceRoot,
        workspaceRoot,
        pluginRoot: paths.pluginRoot,
        manifest,
        toolMap,
        guardInfra: config?.guardInfra !== false,
      })
      if (decision.decision === 'deny') {
        if (decision.schema_drift_advisory) {
          logger?.warn?.('[ars] write tool payload had no top-level file_path; denied (schema drift)')
        }
        return decision.reason || 'ARS write-scope guard denied this tool call.'
      }
      return undefined
    } catch (error) {
      // Fail closed: a guard bug must never silently widen write scope.
      logger?.warn?.(`[ars] write-scope guard internal error; denying: ${error?.message || error}`)
      return `ARS write-scope guard: internal error (${error?.message || error}); denying to avoid silent fail-open.`
    }
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => ctx.tools.guard(guard), 'ars-write-scope-guard')
  } else {
    ctx.tools.guard(guard)
  }
  return true
}
