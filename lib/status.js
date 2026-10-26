/**
 * Assemble the `ars_status` payload.
 *
 * Everything here is observational: missing payload files or a broken Python
 * installation degrade the report instead of throwing. Registration checks use
 * the Host registries (`ctx.skills.get`, `ctx.commands.find`) so `ars_status`
 * confirms what is actually live, not what should be live.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import {
  AGENT_ROLE_SPECS,
  COMMAND_FALLBACK_NAMES,
  SKILL_NAMES,
  createInventory,
} from './inventory.js'
import { DEEPSEEK_FLASH, MODEL_PROFILE_LABEL } from './model-profile.js'
import { PHASE_FENCE_STATUS } from './guard.js'
import { GENERATED_FILES, PAYLOAD_SNAPSHOT } from './payload-contract.js'

/** Compatibility exports derived from the one inventory owner. */
export const EXPECTED_SKILLS = SKILL_NAMES

/** Compatibility export: agent-role skills with their upstream file stem. */
export const EXPECTED_AGENT_SKILLS = Object.freeze(AGENT_ROLE_SPECS.map((entry) => ({
  name: entry.skill,
  agent: entry.file.replace(/\.md$/u, ''),
})))

/** Compatibility export: the command fallback (live names come from inventory). */
export const EXPECTED_COMMANDS = COMMAND_FALLBACK_NAMES

/** Directories that may hold upstream agent definition files. */
const AGENT_DIRS = Object.freeze([
  'agents',
  'shared/agents',
  ...EXPECTED_SKILLS.map((skill) => `${skill}/agents`),
])

const MODULE_NAME = 'academic-research-skills-dsh'

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function countFiles(dir, predicate = () => true) {
  return safeReaddir(dir).filter((entry) => entry.isFile() && predicate(entry.name)).length
}

/** Recursive regular-file count; used where the inventory is inherently nested. */
function countFilesRecursive(dir, predicate = () => true) {
  let total = 0
  for (const entry of safeReaddir(dir)) {
    if (entry.isDirectory()) total += countFilesRecursive(join(dir, entry.name), predicate)
    else if (entry.isFile() && predicate(entry.name)) total += 1
  }
  return total
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function readVersion(pluginRoot) {
  const manifest = readJson(join(pluginRoot, 'package.json'))
  return typeof manifest?.version === 'string' ? manifest.version : '0.0.0'
}

function displayPath(paths, target) {
  const pluginRel = relative(paths.pluginRoot, target)
  if (pluginRel && !pluginRel.startsWith('..') && !isAbsolute(pluginRel)) {
    return pluginRel.split('\\').join('/')
  }
  return target
}

function summarizePayload(root) {
  let files = 0
  let bytes = 0
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(join(current, entry.name))
      else if (entry.isFile() && !GENERATED_FILES.includes(entry.name)) {
        files += 1
        try { bytes += statSync(join(current, entry.name)).size } catch { /* vanished */ }
      }
    }
  }
  return { files, bytes }
}

function countAgentFiles(paths) {
  let total = 0
  for (const dir of AGENT_DIRS) {
    total += countFiles(join(paths.payloadRoot, dir), (name) => name.endsWith('.md'))
  }
  return total
}

async function registrationState(ctx, name, kind, agent) {
  if (kind === 'command') {
    if (!ctx?.commands?.find) return false
    try {
      return Boolean(ctx.commands.find(agent, name))
    } catch {
      return false
    }
  }
  if (!ctx?.skills?.get) return false
  try {
    return Boolean(await ctx.skills.get(name))
  } catch {
    return false
  }
}

/**
 * Build one status snapshot.
 *
 * @param {object} options
 * @param {ReturnType<import('./paths.js').createPaths>} options.paths
 * @param {ReturnType<import('./config.js').normalizeConfig>} options.config
 * @param {{status: () => Promise<object>}} options.env
 * @param {object} [options.ctx] DSH plugin context (skills/commands registries)
 * @param {object} [options.agent] executing agent (scope for `ctx.commands.find`)
 * @param {{lint?: (text: string) => string[]}} [options.adapter]
 * @param {string[]} [options.warnings] registration-time lint warnings supplied by the caller
 * @returns {Promise<object>}
 */
export async function buildStatus({ paths, config, env, ctx, agent, adapter, inventory, report, warnings = [] }) {
  const payloadPresent = existsSync(paths.payloadRoot)
  const resolvedInventory = inventory ?? createInventory({ paths, strict: false })
  const skillDirs = resolvedInventory.skills.map((entry) => entry.name)
  const commandFiles = resolvedInventory.commands
  const agentDefinitions = resolvedInventory.agentRoles.length

  const provenance = readJson(paths.provenancePath)
  const actual = summarizePayload(paths.payloadRoot)
  const manifest = readJson(join(paths.scriptsRoot, 'ars_phase_scope_manifest.json'))
  const manifestAgents = manifest?.agents && typeof manifest.agents === 'object'
    ? Object.keys(manifest.agents).length
    : 0

  const expectedPaths = [
    ['payload root', paths.payloadRoot],
    ['requirements', paths.requirementsPath],
    ['provenance', paths.provenancePath],
    ['reference index', paths.referenceIndexPath],
    ['phase-scope manifest', paths.phaseManifestPath ?? join(paths.scriptsRoot, 'ars_phase_scope_manifest.json')],
    ['write-scope guard script', paths.guardScriptPath ?? join(paths.scriptsRoot, 'ars_write_scope_guard.py')],
    ['interpreter wrapper', paths.wrapperPath ?? join(paths.binRoot, 'ars-python')],
    ...resolvedInventory.skillNames.map((skill) => [`skill ${skill}`, join(paths.payloadRoot, skill, 'SKILL.md')]),
  ]
  const missing = expectedPaths
    .filter(([, target]) => !existsSync(target))
    .map(([label, target]) => `${label}: ${displayPath(paths, target)}`)

  let python
  try {
    python = await env.status()
  } catch {
    python = {
      mode: 'unavailable',
      executable: '',
      venvPath: config.envDir,
      ready: false,
      missing: [],
      uv: false,
      pythonVersion: null,
    }
  }

  const skills = []
  for (const name of resolvedInventory.skillNames) {
    skills.push({ name, registered: await registrationState(ctx, name, 'skill', agent) })
  }
  const agentSkills = []
  for (const { name } of resolvedInventory.agentRoleNames.map((name) => ({ name }))) {
    agentSkills.push({ name, registered: await registrationState(ctx, name, 'skill', agent) })
  }
  const commands = []
  for (const name of resolvedInventory.commandNames) {
    commands.push({ name, registered: await registrationState(ctx, name, 'command', agent) })
  }

  const collected = report?.snapshot?.()
  const lintWarnings = new Set(
    (Array.isArray(warnings) ? warnings : []).filter((warning) => typeof warning === 'string'),
  )
  for (const warning of collected?.warnings ?? []) lintWarnings.add(warning)
  for (const failure of collected?.failures ?? []) lintWarnings.add(failure.message)

  return {
    plugin: {
      name: MODULE_NAME,
      version: readVersion(paths.pluginRoot),
      pluginRoot: paths.pluginRoot,
      payloadRoot: paths.payloadRoot,
    },
    payload: {
      present: payloadPresent,
      counts: {
        skills: skillDirs.length,
        commands: commandFiles.length,
        agentDefinitions,
        agentFiles: countAgentFiles(paths),
        scripts: countFilesRecursive(paths.scriptsRoot),
        hooks: countFiles(paths.hooksRoot),
      },
      provenance,
      contract: {
        expectedFiles: PAYLOAD_SNAPSHOT.files,
        expectedBytes: PAYLOAD_SNAPSHOT.bytes,
        actualFiles: actual.files,
        actualBytes: actual.bytes,
        matches: actual.files === PAYLOAD_SNAPSHOT.files && actual.bytes === PAYLOAD_SNAPSHOT.bytes,
      },
      missing,
    },
    model: {
      id: config.modelProfile ?? DEEPSEEK_FLASH.id,
      label: MODEL_PROFILE_LABEL,
      contextTokens: DEEPSEEK_FLASH.contextTokens,
      inputs: [...DEEPSEEK_FLASH.inputs],
      reasoningEfforts: [...DEEPSEEK_FLASH.reasoningEfforts],
      noClaudeDependency: true,
    },
    webSearch: {
      enabled: config.webSearch !== false,
      tool: DEEPSEEK_FLASH.searchTool,
      provider: DEEPSEEK_FLASH.searchProvider,
      maxQueriesPerSearch: DEEPSEEK_FLASH.maxQueriesPerSearch,
      toolAvailable: Boolean(ctx?.tools?.get && (() => {
        try { return ctx.tools.get(DEEPSEEK_FLASH.searchTool, agent) } catch { return null }
      })()),
    },
    python,
    guard: {
      enabled: config.guard !== false,
      infraProtected: config.guardInfra !== false,
      manifestLoaded: manifestAgents > 0,
      manifestAgents,
      phaseFence: PHASE_FENCE_STATUS.mode,
      phaseFenceReason: PHASE_FENCE_STATUS.reason,
      workspaceRoot: agent?.session?.header?.cwd ?? null,
    },
    registrations: {
      available: Boolean(ctx?.skills?.get && ctx?.commands?.find),
      skills,
      agentSkills,
      commands,
    },
    lint: { warnings: [...lintWarnings].sort() },
  }
}

const stringSchema = Object.freeze({ type: 'string' })
const booleanSchema = Object.freeze({ type: 'boolean' })
const stringArraySchema = Object.freeze({ type: 'array', items: stringSchema })
const stringOrNullSchema = Object.freeze({ oneOf: [stringSchema, { type: 'null' }] })
const registrationListSchema = Object.freeze({
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: stringSchema,
      registered: booleanSchema,
    },
    required: ['name', 'registered'],
  },
})

/**
 * Raw JSON Schema for the `ars_status` canonical value.
 *
 * DSH accepts only its enforced JSON Schema subset: a single scalar `type` per
 * node, object `properties`, array `items`, and `oneOf` (not `anyOf`) for unions.
 */
export const STATUS_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    plugin: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: stringSchema,
        version: stringSchema,
        pluginRoot: stringSchema,
        payloadRoot: stringSchema,
      },
      required: ['name', 'version', 'pluginRoot', 'payloadRoot'],
    },
    payload: {
      type: 'object',
      additionalProperties: false,
      properties: {
        present: booleanSchema,
        counts: {
          type: 'object',
          additionalProperties: false,
          properties: {
            skills: { type: 'integer' },
            commands: { type: 'integer' },
            agentDefinitions: { type: 'integer' },
            agentFiles: { type: 'integer' },
            scripts: { type: 'integer' },
            hooks: { type: 'integer' },
          },
          required: ['skills', 'commands', 'agentDefinitions', 'agentFiles', 'scripts', 'hooks'],
        },
        provenance: {
          oneOf: [
            { type: 'object', additionalProperties: true },
            { type: 'null' },
          ],
        },
        contract: {
          type: 'object',
          additionalProperties: false,
          properties: {
            expectedFiles: { type: 'integer' },
            expectedBytes: { type: 'integer' },
            actualFiles: { type: 'integer' },
            actualBytes: { type: 'integer' },
            matches: booleanSchema,
          },
          required: ['expectedFiles', 'expectedBytes', 'actualFiles', 'actualBytes', 'matches'],
        },
        missing: stringArraySchema,
      },
      required: ['present', 'counts', 'provenance', 'contract', 'missing'],
    },
    model: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: stringSchema,
        label: stringSchema,
        contextTokens: { type: 'integer' },
        inputs: stringArraySchema,
        reasoningEfforts: stringArraySchema,
        noClaudeDependency: booleanSchema,
      },
      required: ['id', 'label', 'contextTokens', 'inputs', 'reasoningEfforts', 'noClaudeDependency'],
    },
    webSearch: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: booleanSchema,
        tool: stringSchema,
        provider: stringSchema,
        maxQueriesPerSearch: { type: 'integer' },
        toolAvailable: booleanSchema,
      },
      required: ['enabled', 'tool', 'provider', 'maxQueriesPerSearch', 'toolAvailable'],
    },
    python: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: stringSchema,
        executable: stringSchema,
        venvPath: stringSchema,
        ready: booleanSchema,
        missing: stringArraySchema,
        uv: booleanSchema,
        pythonVersion: stringOrNullSchema,
      },
      required: ['mode', 'executable', 'venvPath', 'ready', 'missing', 'uv', 'pythonVersion'],
    },
    guard: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: booleanSchema,
        infraProtected: booleanSchema,
        manifestLoaded: booleanSchema,
        manifestAgents: { type: 'integer' },
        phaseFence: stringSchema,
        phaseFenceReason: stringSchema,
        workspaceRoot: stringOrNullSchema,
      },
      required: [
        'enabled',
        'infraProtected',
        'manifestLoaded',
        'manifestAgents',
        'phaseFence',
        'phaseFenceReason',
        'workspaceRoot',
      ],
    },
    registrations: {
      type: 'object',
      additionalProperties: false,
      properties: {
        available: booleanSchema,
        skills: registrationListSchema,
        agentSkills: registrationListSchema,
        commands: registrationListSchema,
      },
      required: ['available', 'skills', 'agentSkills', 'commands'],
    },
    lint: {
      type: 'object',
      additionalProperties: false,
      properties: { warnings: stringArraySchema },
      required: ['warnings'],
    },
  },
  required: ['plugin', 'payload', 'model', 'webSearch', 'python', 'guard', 'registrations', 'lint'],
})
