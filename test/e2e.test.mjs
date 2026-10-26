/**
 * End-to-end wiring tests for the DeepSeek Harness Academic Research Skills
 * port (independent verifier suite).
 *
 * `index.js#apply` is executed with the REAL payload and the REAL lib modules;
 * only the DSH host context is faked. The fake context implements the
 * documented service contracts:
 *   - `ctx.effect(factory)` runs the factory and records its disposer;
 *   - `ctx.skills.register` / `ctx.commands.register` / `ctx.tools.register`
 *     each return a disposer, and `ctx.tools.guard(fn)` returns one;
 *   - `ctx.systemPrompt.section(section)` returns one;
 *   - `ctx.skills.get(name)` and `ctx.commands.find(agent, name)` are the
 *     registries `ars_status` verifies against.
 *
 * The tests additionally validate every tool schema against the real DSH
 * raw-JSON-Schema validator when the installed `@deepseek-ai/dsh-tools` module
 * can be reached, so the "DSH-compatible schema" claim is not only checked by a
 * local mirror of the subset.
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import * as plugin from '../index.js'
import { createPaths } from '../lib/paths.js'
import { normalizeConfig } from '../lib/config.js'
import { createAdapter } from '../lib/adapt.js'
import { createHost, mountHost } from './support/host.mjs'
import { createInventory } from '../lib/inventory.js'
import { createPythonEnv, DEPENDENCY_MODULES, venvPythonPath } from '../lib/env.js'

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const HERE = dirname(fileURLToPath(import.meta.url))
// Use the same path factory as `index.js#apply` (the default plugin root keeps a
// trailing separator; every join/stat below is separator-agnostic).
const paths = createPaths()
const PLUGIN_ROOT = paths.pluginRoot
const adapter = createAdapter({ paths })
const DEFAULT_CONFIG = normalizeConfig(undefined)
const inventoryNames = createInventory({ paths })

const SKILL_NAMES = inventoryNames.skillNames
const AGENT_SKILL_NAMES = inventoryNames.agentRoleNames
const EXPECTED_COMMANDS = inventoryNames.commandNames
const TOOL_NAMES = ['ars_status', 'ars_script', 'ars_env_setup']
const realPayloadScript = join(paths.payloadRoot, 'scripts', 'check_skill_description_length.py')

const EFFECT_COUNT = {
  default: 28, // 5 skills + 4 agents + 16 commands + tools + guard + announce
  announceOff: 27,
  commandsOff: 12,
  toolsOff: 27,
  guardOff: 27,
  allOff: 9,
}

const RESIDUAL_TOKENS = [
  '${CLAUDE_PLUGIN_ROOT}',
  'academic-research-skills:',
  'Skill tool',
  'subagent_type',
  'python3 scripts/',
  'python scripts/',
]

/* -------------------------------------------------------------------------- */
/* Fake DSH host                                                              */
/* -------------------------------------------------------------------------- */

function mount(rawConfig) {
  return mountHost(plugin.apply, rawConfig)
}

const createdWorkspaces = []
after(() => {
  for (const directory of createdWorkspaces) rmSync(directory, { recursive: true, force: true })
})

function tempWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), 'ars-e2e-ws-'))
  createdWorkspaces.push(directory)
  return directory
}

function fakeAgent(cwd) {
  return { id: 'verifier-agent', session: { header: { cwd } } }
}

/* -------------------------------------------------------------------------- */
/* Schema mirror (DSH's enforced raw JSON Schema subset)                      */
/* -------------------------------------------------------------------------- */

const ALLOWED_SCHEMA_KEYS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'description',
  'title',
  'default',
  'examples',
])
const SCALAR_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

function assertRawSchema(node, path = 'schema') {
  assert.ok(node !== null && typeof node === 'object' && !Array.isArray(node), `${path}: not an object`)
  for (const key of Object.keys(node)) {
    assert.ok(ALLOWED_SCHEMA_KEYS.has(key), `${path}: unsupported keyword ${key}`)
  }
  if (node.type !== undefined) assert.ok(SCALAR_TYPES.has(node.type), `${path}: unsupported type ${node.type}`)
  if (node.oneOf !== undefined) {
    assert.ok(Array.isArray(node.oneOf) && node.oneOf.length >= 2, `${path}: oneOf needs 2+ branches`)
    node.oneOf.forEach((branch, index) => assertRawSchema(branch, `${path}.oneOf[${index}]`))
  }
  if (node.properties !== undefined) {
    assert.equal(node.type, 'object', `${path}: properties require type object`)
    for (const [name, child] of Object.entries(node.properties)) {
      assertRawSchema(child, `${path}.properties.${name}`)
      assert.notEqual(child.required, true, `${path}.properties.${name}: per-property required is rejected`)
    }
  }
  if (node.required !== undefined) {
    assert.ok(Array.isArray(node.required), `${path}: required is a top-level array`)
    assert.equal(node.type, 'object', `${path}: required only on objects`)
    for (const name of node.required) {
      assert.ok(node.properties && Object.hasOwn(node.properties, name), `${path}: required ${name} has no property`)
    }
  }
  if (node.additionalProperties !== undefined) {
    assert.equal(typeof node.additionalProperties, 'boolean', `${path}: additionalProperties must be boolean`)
  }
  if (node.items !== undefined) {
    assert.equal(node.type, 'array', `${path}: items require type array`)
    assertRawSchema(node.items, `${path}.items`)
  }
}

async function loadDshTools() {
  const candidates = [
    process.env.ARS_DSH_TOOLS_MODULE,
    join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      return await import(pathToFileURL(candidate).href)
    } catch {
      /* fall through to the next candidate */
    }
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Module contract                                                            */
/* -------------------------------------------------------------------------- */

test('index.js exposes the Cordis plugin contract', () => {
  assert.equal(plugin.name, 'academic-research-skills')
  assert.deepEqual(plugin.inject, ['skills', 'commands', 'tools', 'systemPrompt'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(plugin.apply.length, 2, 'apply(ctx, config)')
})

test('apply registers the complete surface and logs no compatibility warnings', () => {
  const { state } = mount(undefined)

  assert.deepEqual([...state.skills.keys()], [...SKILL_NAMES, ...AGENT_SKILL_NAMES])
  assert.equal(state.commands.size, 16)
  assert.deepEqual([...EXPECTED_COMMANDS].sort(), [...state.commands.keys()].sort())
  assert.deepEqual([...state.tools.keys()], TOOL_NAMES)
  assert.equal(state.guards.length, 1, 'exactly one synchronous write-scope guard')
  assert.equal(state.sections.length, 1, 'exactly one system-prompt section')
  assert.equal(state.effects.length, EFFECT_COUNT.default)
  assert.equal(state.disposers.length, EFFECT_COUNT.default)
  assert.deepEqual(state.warnings, [])
  assert.equal(state.infos.length, 1)
  assert.match(String(state.infos[0][0]), /ARS port loaded/u)
})

test('every optional surface is suppressed by its own config flag', () => {
  const cases = [
    ['announce', EFFECT_COUNT.announceOff, (state) => state.sections.length === 0],
    ['commands', EFFECT_COUNT.commandsOff, (state) => state.commands.size === 0],
    ['tools', EFFECT_COUNT.toolsOff, (state) => state.tools.size === 0 && state.guards.length === 1],
    ['guard', EFFECT_COUNT.guardOff, (state) => state.guards.length === 0 && state.tools.size === 3],
  ]
  for (const [flag, effects, assertion] of cases) {
    const { state } = mount({ [flag]: false })
    assert.ok(assertion(state), `${flag}: surface suppressed`)
    assert.equal(state.effects.length, effects, `${flag}: effect count`)
    // Skills and agent-role skills are not flagged off; they always register.
    assert.equal(state.skills.size, 9, `${flag}: skills stay registered`)
  }

  const { state } = mount({ announce: false, commands: false, tools: false, guard: false })
  assert.equal(state.effects.length, EFFECT_COUNT.allOff)
  assert.equal(state.skills.size, 9)
  assert.equal(state.commands.size, 0)
  assert.equal(state.tools.size, 0)
  assert.equal(state.guards.length, 0)
  assert.equal(state.sections.length, 0)
})

/* -------------------------------------------------------------------------- */
/* Tools                                                                      */
/* -------------------------------------------------------------------------- */

test('the three tools declare object-rooted schemas with top-level required arrays', () => {
  const { state } = mount(undefined)

  for (const [name, tool] of state.tools) {
    assert.equal(tool.name, name)
    assert.ok(tool.description.trim().length > 40, `${name}: usable description`)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')

    assertRawSchema(tool.parameters, `${name}.parameters`)
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.parameters.additionalProperties, false)

    assertRawSchema(tool.output.schema, `${name}.output.schema`)
    assert.equal(tool.output.schema.type, 'object')
    assert.ok(Array.isArray(tool.output.schema.required), `${name}: output schema requires its fields`)

    const rendered = tool.output.render({}, name === 'ars_script'
      ? { exitCode: 0, stdout: '', stderr: '', truncated: false, script: '/x.py', python: 'python3' }
      : name === 'ars_env_setup'
        ? { ok: true, mode: 'venv', venvPath: '/v', python: '/v/bin/python', installed: [], log: 'ok' }
        : {
            plugin: { name: 'x', version: '1', pluginRoot: '/p', payloadRoot: '/p/payload' },
            payload: {
              present: true,
              counts: { skills: 5, commands: 16, agentDefinitions: 4, agentFiles: 47, scripts: 642, hooks: 2 },
              provenance: null,
              missing: [],
            },
            python: {
              mode: 'venv',
              executable: '/v/bin/python',
              venvPath: '/v',
              ready: true,
              missing: [],
              uv: false,
              pythonVersion: '3.12.13',
            },
            guard: {
              enabled: true,
              infraProtected: true,
              manifestLoaded: true,
              manifestAgents: 23,
              phaseFence: false,
              workspaceRoot: null,
            },
            registrations: { available: true, skills: [], agentSkills: [], commands: [] },
            lint: { warnings: [] },
          })
    assert.ok(Array.isArray(rendered) && rendered.length > 0)
    for (const block of rendered) {
      assert.equal(block.type, 'text')
      assert.equal(typeof block.text, 'string')
    }
  }

  assert.deepEqual(state.tools.get('ars_script').parameters.required, ['script'])
  assert.equal(state.tools.get('ars_env_setup').parameters.required, undefined)
  assert.ok(state.tools.get('ars_env_setup').parameters.properties.force)
})

test('tool schemas pass the real installed DSH JSON-Schema validator', async (t) => {
  const dshTools = await loadDshTools()
  if (dshTools === null || typeof dshTools.assertSupportedJsonSchema !== 'function') {
    t.skip('@deepseek-ai/dsh-tools is not reachable from this host')
    return
  }
  const { state } = mount(undefined)
  for (const [name, tool] of state.tools) {
    assert.doesNotThrow(() => dshTools.assertSupportedJsonSchema(tool.parameters), `${name}: parameters`)
    assert.doesNotThrow(() => dshTools.assertSupportedJsonSchema(tool.output.schema), `${name}: output.schema`)
  }
})

/* -------------------------------------------------------------------------- */
/* Announce section                                                           */
/* -------------------------------------------------------------------------- */

test('the announce section names the complete ARS inventory and the routing rule', () => {
  const { state } = mount(undefined)
  const section = state.sections[0]

  assert.equal(section.name, 'academic-research-skills')
  assert.equal(section.order, 40)
  assert.equal(section.interpolate, false)
  assert.equal(typeof section.text, 'string')

  for (const skill of SKILL_NAMES) assert.ok(section.text.includes(`\`${skill}\``), `announce names ${skill}`)
  for (const skill of AGENT_SKILL_NAMES) assert.ok(section.text.includes(`\`${skill}\``), `announce names ${skill}`)
  for (const command of EXPECTED_COMMANDS) assert.ok(section.text.includes(`/${command}`), `announce names /${command}`)
  assert.ok(section.text.includes('Commands (16)'))
  assert.ok(section.text.includes(paths.payloadRoot))
  assert.ok(section.text.includes('academic research requests'))
  assert.ok(section.text.includes('Route unrelated coding, office, or general requests outside ARS.'))
  assert.ok(!section.text.includes('{{'), 'interpolate:false with no template markers')
  assert.deepEqual(adapter.lint(section.text), [])
})

/* -------------------------------------------------------------------------- */
/* Write-scope guard                                                          */
/* -------------------------------------------------------------------------- */

test('the registered guard protects plugin infrastructure for the unconstrained main session', () => {
  const { state } = mount(undefined)
  const guard = state.guards[0]
  const workspace = tempWorkspace()
  const agent = fakeAgent(workspace)

  const deny = (execution, pattern) => {
    const reason = guard(execution)
    assert.equal(typeof reason, 'string', 'expected a deny reason')
    assert.match(reason, pattern)
  }
  const allow = (execution) => assert.equal(guard(execution), undefined, 'expected pass-through')

  deny(
    { name: 'write', arguments: { file_path: join(PLUGIN_ROOT, 'lib', 'guard.js') }, agent },
    /enforcement infrastructure/u,
  )
  deny(
    { name: 'edit', arguments: { file_path: join(PLUGIN_ROOT, 'payload', 'scripts', 'ars_write_scope_guard.py') }, agent },
    /enforcement infrastructure/u,
  )
  deny(
    { name: 'write', arguments: { file_path: join(PLUGIN_ROOT, 'payload', 'agents', 'synthesis_agent.md') }, agent },
    /enforcement infrastructure/u,
  )
  deny(
    { name: 'write', arguments: { file_path: join(PLUGIN_ROOT, 'package.json') }, agent },
    /enforcement infrastructure/u,
  )
  deny({ name: 'write', arguments: {}, agent }, /no top-level file_path/u)
  deny({ name: 'write', arguments: null, agent }, /no top-level file_path/u)

  allow({ name: 'write', arguments: { file_path: join(workspace, 'notes.md') }, agent })
  allow({ name: 'edit', arguments: { file_path: join(workspace, 'draft.md') }, agent })
  allow({ name: 'bash', arguments: { command: 'ls' }, agent })
  allow({ name: 'read', arguments: { file_path: join(PLUGIN_ROOT, 'package.json') }, agent })
})

test('the phase fence stays inactive because no ARS role is registered by default', async () => {
  const { state } = mount(undefined)
  const guard = state.guards[0]
  const workspace = tempWorkspace()
  const agent = fakeAgent(workspace)

  // Upstream phase fencing would deny this for `synthesis_agent`; DSH tool
  // executions carry no `agent_type`, so an unknown child is unconstrained —
  // the documented limitation, not a silent failure.
  assert.equal(
    guard({ name: 'write', arguments: { file_path: join(workspace, 'phase2_data', 'x.md') }, agent }),
    undefined,
  )
  assert.equal(guard({ name: 'bash', arguments: { command: 'ls' }, agent }), undefined)

  const tool = state.tools.get('ars_status')
  const status = await tool.execute({}, { agent, signal: new AbortController().signal })
  assert.equal(status.guard.phaseFence, 'unavailable')
  assert.match(status.guard.phaseFenceReason, /agent type/)
  assert.equal(status.model.id, 'deepseek-flash')
  assert.equal(status.webSearch.tool, 'web_search')
  assert.equal(status.guard.enabled, true)
  assert.equal(status.guard.infraProtected, true)
  assert.equal(status.guard.manifestAgents, 23)
  assert.equal(status.guard.workspaceRoot, workspace)
})

test('config.guardInfra=false disables only infrastructure protection', () => {
  const { state } = mount({ guardInfra: false })
  const guard = state.guards[0]
  const agent = fakeAgent(tempWorkspace())
  assert.equal(guard({ name: 'write', arguments: { file_path: join(PLUGIN_ROOT, 'index.js') }, agent }), undefined)
})

/* -------------------------------------------------------------------------- */
/* ars_status over the live registries                                        */
/* -------------------------------------------------------------------------- */

test('ars_status reports the live registration state, payload counts, and Python readiness', async () => {
  const { state } = mount(undefined)
  const tool = state.tools.get('ars_status')
  const workspace = tempWorkspace()
  const agent = fakeAgent(workspace)
  const status = await tool.execute({}, { agent, signal: new AbortController().signal })

  assert.equal(status.plugin.name, 'academic-research-skills-dsh')
  assert.equal(status.plugin.version, '1.0.5')
  assert.equal(status.plugin.pluginRoot, PLUGIN_ROOT)
  assert.equal(status.plugin.payloadRoot, paths.payloadRoot)

  assert.equal(status.payload.present, true)
  assert.deepEqual(status.payload.counts, {
    skills: 5,
    commands: 16,
    agentDefinitions: 4,
    agentFiles: 47,
    scripts: 642,
    hooks: 2,
  })
  assert.deepEqual(status.payload.missing, [])
  assert.equal(status.payload.provenance.upstream.commit, '1ec249df98728682dfbbdfb940a658338bfd6f80')
  assert.equal(status.payload.provenance.upstream.pluginVersion, '3.23.2')

  assert.equal(status.registrations.available, true)
  assert.deepEqual(
    status.registrations.skills.map((entry) => entry.name),
    SKILL_NAMES,
  )
  assert.deepEqual(
    status.registrations.agentSkills.map((entry) => entry.name),
    AGENT_SKILL_NAMES,
  )
  assert.deepEqual(
    status.registrations.commands.map((entry) => entry.name).sort(),
    [...EXPECTED_COMMANDS].sort(),
  )
  for (const entry of [...status.registrations.skills, ...status.registrations.agentSkills, ...status.registrations.commands]) {
    assert.equal(entry.registered, true, `${entry.name}: live registration`)
  }

  assert.deepEqual(status.lint.warnings, [])

  const managedPython = venvPythonPath(join(homedir(), '.cache', 'ars-dsh', 'venv'))
  if (existsSync(managedPython)) {
    assert.equal(status.python.mode, 'venv')
    assert.equal(status.python.executable, managedPython)
  } else {
    assert.notEqual(status.python.mode, 'venv')
  }
  assert.equal(typeof status.python.ready, 'boolean')
  assert.ok(Array.isArray(status.python.missing))
  for (const missing of status.python.missing) assert.ok(DEPENDENCY_MODULES.includes(missing))
})

test('ars_status output validates against the real DSH schema validator', async (t) => {
  const dshTools = await loadDshTools()
  if (dshTools === null || typeof dshTools.validateJsonSchemaValue !== 'function') {
    t.skip('@deepseek-ai/dsh-tools is not reachable from this host')
    return
  }
  const { state } = mount(undefined)
  const tool = state.tools.get('ars_status')
  const status = await tool.execute({}, { agent: fakeAgent(tempWorkspace()), signal: new AbortController().signal })
  const violations = dshTools.validateJsonSchemaValue(tool.output.schema, status)
  assert.deepEqual(violations, [], `ars_status output violated its schema: ${JSON.stringify(violations)}`)
})

/* -------------------------------------------------------------------------- */
/* ars_script guard rails                                                     */
/* -------------------------------------------------------------------------- */

test('ars_script rejects escapes and unsupported targets before spawning', async () => {
  const { state } = mount(undefined)
  const tool = state.tools.get('ars_script')

  await assert.rejects(tool.execute({ script: '../README.md' }, {}), /escapes the payload root/u)
  await assert.rejects(tool.execute({ script: join(PLUGIN_ROOT, 'README.md') }, {}), /escapes the payload root/u)
  await assert.rejects(tool.execute({ script: 'LICENSE' }, {}), /unsupported script type/u)
  await assert.rejects(tool.execute({ script: 'scripts' }, {}), /not a regular file/u)
  await assert.rejects(tool.execute({}, {}), /non-empty string/u)
  const realScript = 'scripts/check_skill_description_length.py'
  await assert.rejects(tool.execute({ script: realScript, args: 'nope' }, {}), /array of strings/u)
  await assert.rejects(
    tool.execute({ script: realScript, cwd: 'no-such-directory' }, {}),
    /cwd (does not exist|not found under the payload root)/u,
  )
  await assert.rejects(tool.execute({ script: realScript, timeoutMs: 0 }, {}), /positive integer/u)
})

test('ars_script resolves a real shipped payload script without executing it', () => {
  assert.ok(existsSync(realPayloadScript) && statSync(realPayloadScript).isFile())
})

test('the runtime environment suppresses Python bytecode writes into the payload', () => {
  const env = createPythonEnv({ paths, config: DEFAULT_CONFIG })
  const scriptEnv = env.scriptEnv()
  assert.equal(scriptEnv.ARS_PAYLOAD_ROOT, paths.payloadRoot)
  assert.ok(String(scriptEnv.PYTHONPATH).startsWith(paths.payloadRoot), 'payload root importable first')
  assert.equal(scriptEnv.PYTHONDONTWRITEBYTECODE, '1', 'ars_script must not write __pycache__ into the payload')

  const wrapper = readFileSync(join(PLUGIN_ROOT, 'bin', 'ars-python'), 'utf8')
  assert.match(wrapper, /PYTHONDONTWRITEBYTECODE=1/u)
  assert.match(wrapper, /export PYTHONDONTWRITEBYTECODE/u)
  assert.match(wrapper, /ARS_PAYLOAD_ROOT/u)
  assert.match(wrapper, /exec /u)
  assert.ok((statSync(join(PLUGIN_ROOT, 'bin', 'ars-python')).mode & 0o111) !== 0, 'wrapper executable')
})

/* -------------------------------------------------------------------------- */
/* Dependency and import hygiene                                              */
/* -------------------------------------------------------------------------- */

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|\n)[ \t]*\/\/[^\n]*/gu, '$1')
}

function importSpecifiers(source) {
  const specifiers = []
  const patterns = [
    /(?:^|[\n;])\s*(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/gu,
    /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1])
  }
  return specifiers
}

test('no runtime module imports @deepseek-ai packages or bare npm specifiers', () => {
  const runtimeFiles = [
    join(PLUGIN_ROOT, 'index.js'),
    ...readdirSync(join(PLUGIN_ROOT, 'lib'))
      .filter((file) => file.endsWith('.js'))
      .sort()
      .map((file) => join(PLUGIN_ROOT, 'lib', file)),
  ]

  for (const file of runtimeFiles) {
    // JSDoc type references (`@param {import('@deepseek-ai/cordis').Context}`)
    // are documentation, not runtime imports.
    const source = stripComments(readFileSync(file, 'utf8'))
    for (const specifier of importSpecifiers(source)) {
      assert.ok(
        specifier.startsWith('node:') || specifier.startsWith('.'),
        `${file}: non-relative import "${specifier}"`,
      )
      assert.ok(!specifier.startsWith('@deepseek-ai/'), `${file}: @deepseek-ai import "${specifier}"`)
    }
    assert.ok(!/\brequire\s*\(/u.test(source), `${file}: CommonJS require in an ESM module`)
  }

  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const value = manifest[field]
    assert.ok(value === undefined || Object.keys(value).length === 0, `package.json ${field} must be empty`)
  }
  assert.equal(manifest.type, 'module')
  assert.deepEqual(manifest.exports['.'], './index.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.engines.dsh, '>=0.2.1-rc.3')
})

test('cordis.patch.yml inserts exactly one enabled Host row for this plugin', () => {
  const patch = readFileSync(join(PLUGIN_ROOT, 'cordis.patch.yml'), 'utf8')
  assert.equal((patch.match(/academic-research-skills-dsh/gu) ?? []).length, 1)
  assert.equal((patch.match(/id:\s*academic-research-skills\b/gu) ?? []).length, 1)
  assert.match(patch, /^\s*-\s*insert:/mu)
  for (const flag of ['announce', 'commands', 'tools', 'guard', 'guardInfra']) {
    assert.match(patch, new RegExp(`\\b${flag}:\\s*true`, 'u'), `${flag}: enabled by default`)
  }
  assert.ok(!/^\s*disabled:\s*true/mu.test(patch), 'the row is enabled by default')
})

/* -------------------------------------------------------------------------- */
/* Teardown                                                                   */
/* -------------------------------------------------------------------------- */

test('disposing every effect removes the complete registered surface', () => {
  const { state } = mount(undefined)
  assert.equal(state.disposers.length, EFFECT_COUNT.default)

  for (const dispose of state.disposers) dispose()
  assert.equal(state.skills.size, 0)
  assert.equal(state.commands.size, 0)
  assert.equal(state.tools.size, 0)
  assert.equal(state.guards.length, 0)
  assert.equal(state.sections.length, 0)
})
