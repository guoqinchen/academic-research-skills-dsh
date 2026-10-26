import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeConfig } from '../lib/config.js'
import { createPaths } from '../lib/paths.js'
import {
  EXPECTED_AGENT_SKILLS,
  EXPECTED_COMMANDS,
  EXPECTED_SKILLS,
  buildStatus,
} from '../lib/status.js'
import { registerTools } from '../lib/tools.js'
import { createHost } from './support/host.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const WRAPPER_SOURCE = join(HERE, '..', 'bin', 'ars-python')
const PYTHON = process.env.ARS_TEST_PYTHON || 'python3'
const PYTHON_AVAILABLE = (() => {
  const probe = spawnSync(PYTHON, ['--version'], { encoding: 'utf8' })
  return !probe.error && probe.status === 0
})()
const BASH_AVAILABLE = (() => {
  const probe = spawnSync('bash', ['--version'], { encoding: 'utf8' })
  return !probe.error && probe.status === 0
})()

function tempDir(prefix = 'ars-tools-test-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

const SCRIPT_FILES = [
  'hello.py',
  'args.py',
  'fail.py',
  'big.py',
  'slow.py',
  'noext.txt',
  'shell.sh',
]

function makeFixture() {
  const root = tempDir()
  const paths = createPaths(root)
  write(join(root, 'package.json'), JSON.stringify({ name: 'academic-research-skills-dsh', version: '9.9.9' }))
  write(paths.requirementsPath, 'pyyaml\n')
  write(join(root, 'bin', 'ars-python'), readFileSync(WRAPPER_SOURCE, 'utf8'))
  chmodSync(join(root, 'bin', 'ars-python'), 0o755)

  write(paths.provenancePath, JSON.stringify({ sourceRepository: 'https://example.test/repo', sourceCommit: 'abc123' }))
  write(paths.referenceIndexPath, JSON.stringify({ references: [] }))
  write(join(paths.hooksRoot, 'hooks.json'), '{}')

  for (const skill of EXPECTED_SKILLS) {
    write(join(paths.payloadRoot, skill, 'SKILL.md'), `---\nname: ${skill}\n---\nbody\n`)
    write(join(paths.payloadRoot, skill, 'agents', `${skill}_agent.md`), '# agent\n')
  }
  write(join(paths.payloadRoot, 'shared', 'agents', 'compliance_agent.md'), '# compliance\n')
  for (const command of EXPECTED_COMMANDS) {
    write(join(paths.commandsRoot, `${command}.md`), `---\nname: ${command}\n---\nbody\n`)
  }
  for (const agent of ['synthesis_agent', 'research_architect_agent', 'report_compiler_agent', 'screening_reviewer_agent']) {
    write(join(paths.agentsRoot, `${agent}.md`), '# top agent\n')
  }
  write(
    join(paths.scriptsRoot, 'ars_phase_scope_manifest.json'),
    JSON.stringify({ version: 1, agents: { synthesis_agent: { allowed_write_globs: ['phase3_*/**'] }, bibliography_agent: { allowed_write_globs: ['phase2_*/**'] } } }),
  )
  write(join(paths.scriptsRoot, 'ars_write_scope_guard.py'), '# guard\n')

  write(join(paths.scriptsRoot, 'hello.py'), 'print("hello")\n')
  write(
    join(paths.scriptsRoot, 'args.py'),
    [
      'import json, os, sys',
      'print(json.dumps({',
      '  "argv": sys.argv[1:],',
      '  "cwd": os.getcwd(),',
      '  "pythonpath": os.environ.get("PYTHONPATH"),',
      '  "payload": os.environ.get("ARS_PAYLOAD_ROOT"),',
      '}))',
    ].join('\n'),
  )
  write(join(paths.scriptsRoot, 'fail.py'), 'import sys\nprint("bad", file=sys.stderr)\nsys.exit(3)\n')
  write(join(paths.scriptsRoot, 'big.py'), 'import sys\nsys.stdout.write("x" * 5000)\n')
  write(join(paths.scriptsRoot, 'slow.py'), 'import time\nprint("start", flush=True)\ntime.sleep(10)\n')
  write(join(paths.scriptsRoot, 'noext.txt'), 'not a script\n')
  write(join(paths.scriptsRoot, 'shell.sh'), '#!/bin/sh\necho "shell:$1"\n')
  write(join(paths.payloadRoot, 'work', 'marker.txt'), 'work dir\n')

  write(join(root, 'outside.py'), 'print("outside")\n')

  // A symlink inside the payload that resolves outside it must be rejected.
  const outsideScript = join(root, 'outside-script.py')
  write(outsideScript, 'print("outside")\n')
  try {
    symlinkSync(outsideScript, join(paths.scriptsRoot, 'escape.py'))
  } catch {
    /* symlinks unavailable: the escape case asserts the lexical path instead */
  }

  const config = normalizeConfig(
    { envDir: join(root, 'venv'), scriptTimeoutMs: 5000, maxScriptOutputBytes: 4096 },
    { home: root },
  )
  return { root, paths, config, outsideScript }
}

function makeCtx({ skills = [], commands = [] } = {}) {
  const host = createHost({ skills, commands })
  return {
    ctx: host.ctx,
    registered: host.registeredTools,
    guards: host.state.guards,
    effects: host.state.effects,
    skillGets: host.state.skillGets,
    commandFinds: host.state.commandFinds,
    unregisterCalls: host.state.unregisterCalls,
  }
}

function makeFakeEnv(paths, { status, ensure } = {}) {
  const ensureCalls = []
  const defaultStatus = {
    mode: 'venv',
    executable: join(paths.pluginRoot, 'venv', 'bin', 'python'),
    venvPath: join(paths.pluginRoot, 'venv'),
    ready: true,
    missing: [],
    uv: true,
    pythonVersion: '3.12.0',
  }
  return {
    ensureCalls,
    async status() {
      return status || defaultStatus
    },
    async ensure(options) {
      ensureCalls.push(options)
      return (
        ensure || {
          ok: true,
          mode: 'venv',
          venvPath: join(paths.pluginRoot, 'venv'),
          python: join(paths.pluginRoot, 'venv', 'bin', 'python'),
          installed: ['pyyaml'],
          log: 'installed',
        }
      )
    },
    pythonExecutable() {
      return PYTHON
    },
    wrapperPath() {
      return join(paths.pluginRoot, 'bin', 'ars-python')
    },
    scriptEnv() {
      return {
        ...process.env,
        PYTHONPATH: paths.payloadRoot,
        ARS_PAYLOAD_ROOT: paths.payloadRoot,
      }
    },
  }
}

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

/** Structural check mirroring DSH's enforced raw JSON Schema subset. */
function assertSupportedRawSchema(node, path = 'schema') {
  assert.ok(node && typeof node === 'object' && !Array.isArray(node), `${path}: not an object`)
  for (const key of Object.keys(node)) {
    assert.ok(ALLOWED_SCHEMA_KEYS.has(key), `${path}: unsupported keyword ${key}`)
  }
  if (node.type !== undefined) {
    assert.ok(SCALAR_TYPES.has(node.type), `${path}: unsupported type ${node.type}`)
  }
  if (node.oneOf !== undefined) {
    assert.ok(Array.isArray(node.oneOf) && node.oneOf.length >= 2, `${path}: oneOf needs two branches`)
    node.oneOf.forEach((branch, index) => assertSupportedRawSchema(branch, `${path}.oneOf[${index}]`))
  }
  if (node.properties !== undefined) {
    assert.equal(node.type, 'object', `${path}: properties require type object`)
    for (const [name, child] of Object.entries(node.properties)) {
      assertSupportedRawSchema(child, `${path}.properties.${name}`)
      assert.notEqual(child.required, true, `${path}.properties.${name}: per-property required is rejected`)
    }
  }
  if (node.required !== undefined) {
    assert.ok(Array.isArray(node.required), `${path}: top-level required array`)
    assert.equal(node.type, 'object', `${path}: required only on objects`)
    for (const name of node.required) {
      assert.ok(node.properties && name in node.properties, `${path}: required ${name} missing from properties`)
    }
  }
  if (node.additionalProperties !== undefined) {
    assert.equal(typeof node.additionalProperties, 'boolean', `${path}: additionalProperties must be boolean`)
  }
  if (node.items !== undefined) {
    assert.equal(node.type, 'array', `${path}: items require type array`)
    assertSupportedRawSchema(node.items, `${path}.items`)
  }
}

test('registerTools registers three schema-valid tools inside one effect scope', () => {
  const fixture = makeFixture()
  const { ctx, registered, effects, unregisterCalls } = makeCtx()
  const env = makeFakeEnv(fixture.paths)
  registerTools(ctx, { paths: fixture.paths, config: fixture.config, env })

  assert.deepEqual(registered.map((tool) => tool.name), ['ars_status', 'ars_script', 'ars_env_setup'])
  for (const tool of registered) {
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 40, `${tool.name} needs a usable description`)
    assertSupportedRawSchema(tool.parameters, `${tool.name}.parameters`)
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.parameters.additionalProperties, false)
    assert.equal(typeof tool.output.schema, 'object')
    assertSupportedRawSchema(tool.output.schema, `${tool.name}.output.schema`)
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
    const rendered = tool.output.render({}, tool.name === 'ars_script'
      ? { exitCode: 0, stdout: '', stderr: '', truncated: false, script: '/x.py', python: 'python3' }
      : tool.name === 'ars_env_setup'
        ? { ok: true, mode: 'venv', venvPath: '/v', python: '/v/bin/python', installed: [], log: 'ok' }
        : null)
    if (tool.name !== 'ars_status') {
      assert.ok(Array.isArray(rendered) && rendered[0].type === 'text')
    }
  }
  assert.equal(effects.length, 1)
  assert.equal(unregisterCalls.count, 0)
  effects[0]()
  assert.equal(unregisterCalls.count, 3)
})

test('registerTools is disabled by config.tools=false', () => {
  const fixture = makeFixture()
  const config = normalizeConfig({ tools: false }, { home: fixture.root })
  const { ctx, registered, effects } = makeCtx()
  registerTools(ctx, { paths: fixture.paths, config, env: makeFakeEnv(fixture.paths) })
  assert.equal(registered.length, 0)
  assert.equal(effects.length, 0)
})

test('ars_status reports counts, provenance, python readiness, registrations, and lint warnings', async () => {
  const fixture = makeFixture()
  const skillNames = [...EXPECTED_SKILLS, ...EXPECTED_AGENT_SKILLS.map((entry) => entry.name)]
  const { ctx, registered } = makeCtx({ skills: skillNames, commands: [...EXPECTED_COMMANDS] })
  const env = makeFakeEnv(fixture.paths)
  const lintCalls = []
  const adapter = {
    lint(text) {
      lintCalls.push(text)
      return text.includes('legacy') ? ['legacy-token'] : []
    },
  }
  registerTools(ctx, {
    paths: fixture.paths,
    config: fixture.config,
    env,
    adapter,
    warnings: ['registration: leftover token'],
  })
  const statusTool = registered.find((tool) => tool.name === 'ars_status')
  const agent = { id: 'agent-1', session: { header: { cwd: join(fixture.root, 'ws') } } }
  const status = await statusTool.execute({}, { agent })

  assert.equal(status.plugin.name, 'academic-research-skills-dsh')
  assert.equal(status.plugin.version, '9.9.9')
  assert.equal(status.plugin.pluginRoot, fixture.paths.pluginRoot)
  assert.equal(status.plugin.payloadRoot, fixture.paths.payloadRoot)

  assert.equal(status.payload.present, true)
  assert.equal(status.payload.counts.skills, 5)
  assert.equal(status.payload.counts.commands, 16)
  assert.equal(status.payload.counts.agentDefinitions, 4)
  assert.equal(status.payload.counts.agentFiles, 10)
  assert.equal(status.payload.counts.scripts, SCRIPT_FILES.length + 2)
  assert.equal(status.payload.counts.hooks, 1)
  assert.deepEqual(status.payload.missing, [])
  assert.equal(status.payload.provenance.sourceCommit, 'abc123')

  assert.deepEqual(status.python, {
    mode: 'venv',
    executable: join(fixture.paths.pluginRoot, 'venv', 'bin', 'python'),
    venvPath: join(fixture.paths.pluginRoot, 'venv'),
    ready: true,
    missing: [],
    uv: true,
    pythonVersion: '3.12.0',
  })

  assert.equal(status.guard.enabled, true)
  assert.equal(status.guard.infraProtected, true)
  assert.equal(status.guard.manifestLoaded, true)
  assert.equal(status.guard.manifestAgents, 2)
  assert.equal(status.guard.phaseFence, 'unavailable')
  assert.match(status.guard.phaseFenceReason, /agent type/)
  assert.equal(status.model.noClaudeDependency, true)
  assert.equal(status.webSearch.provider, 'deepseek-official')
  assert.equal(status.guard.workspaceRoot, join(fixture.root, 'ws'))

  assert.equal(status.registrations.available, true)
  assert.ok(status.registrations.skills.every((entry) => entry.registered === true))
  assert.ok(status.registrations.agentSkills.every((entry) => entry.registered === true))
  assert.ok(status.registrations.commands.every((entry) => entry.registered === true))
  assert.equal(status.registrations.commands.length, 16)
  assert.equal(lintCalls.length, 0, 'status reads the registration collector; it must not re-lint every registered skill')
  assert.deepEqual(status.lint.warnings, ['registration: leftover token'])

  // Sanity: output conforms to the declared output schema at the top level.
  assertSupportedRawSchema(statusTool.output.schema, 'ars_status.output.schema')
})

test('ars_status degrades without a payload or registries', async () => {
  const root = tempDir('ars-status-empty-')
  const paths = createPaths(root)
  const config = normalizeConfig({}, { home: root })
  const env = makeFakeEnv(paths, {
    status: {
      mode: 'unavailable',
      executable: 'python3',
      venvPath: join(root, 'venv'),
      ready: false,
      missing: ['yaml'],
      uv: false,
      pythonVersion: null,
    },
  })
  const status = await buildStatus({ paths, config, env })
  assert.equal(status.payload.present, false)
  assert.equal(status.payload.counts.skills, 0)
  assert.ok(status.payload.missing.length > 0)
  assert.equal(status.registrations.available, false)
  assert.equal(status.python.ready, false)
  assert.equal(status.guard.manifestLoaded, false)
})

test('ars_script runs a payload Python script and captures stdout', { skip: !PYTHON_AVAILABLE && 'python3 not available' }, async () => {
  const fixture = makeFixture()
  const { ctx, registered } = makeCtx()
  const env = makeFakeEnv(fixture.paths)
  registerTools(ctx, { paths: fixture.paths, config: fixture.config, env })
  const scriptTool = registered.find((tool) => tool.name === 'ars_script')
  const result = await scriptTool.execute({ script: 'scripts/hello.py' }, {})
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, 'hello\n')
  assert.equal(result.stderr, '')
  assert.equal(result.truncated, false)
  assert.equal(result.script, realpathSync(join(fixture.paths.scriptsRoot, 'hello.py')))
  assert.equal(result.python, join(fixture.paths.pluginRoot, 'bin', 'ars-python'))
})

test('ars_script passes literal argv, cwd, and the payload environment', { skip: !PYTHON_AVAILABLE && 'python3 not available' }, async () => {
  const fixture = makeFixture()
  const { ctx, registered } = makeCtx()
  const env = makeFakeEnv(fixture.paths)
  registerTools(ctx, { paths: fixture.paths, config: fixture.config, env })
  const scriptTool = registered.find((tool) => tool.name === 'ars_script')

  const args = ['--flag', 'two words', '$(touch should-not-exist)']
  const result = await scriptTool.execute({ script: 'scripts/args.py', args, cwd: 'work' }, {})
  assert.equal(result.exitCode, 0)
  const parsed = JSON.parse(result.stdout)
  assert.deepEqual(parsed.argv, args)
  assert.equal(parsed.cwd, realpathSync(join(fixture.paths.payloadRoot, 'work')))
  assert.equal(parsed.payload, realpathSync(fixture.paths.payloadRoot))
  assert.equal(parsed.pythonpath.split(':')[0], realpathSync(fixture.paths.payloadRoot))
})

test('ars_script runs shell scripts through bash', { skip: !BASH_AVAILABLE && 'bash not available' }, async () => {
  const fixture = makeFixture()
  const { ctx, registered } = makeCtx()
  registerTools(ctx, { paths: fixture.paths, config: fixture.config, env: makeFakeEnv(fixture.paths) })
  const scriptTool = registered.find((tool) => tool.name === 'ars_script')
  const result = await scriptTool.execute({ script: 'scripts/shell.sh', args: ['value'] }, {})
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, 'shell:value\n')
  assert.equal(result.python, 'bash')
})

test('ars_script rejects traversal, absolute escapes, symlink escapes, and unsupported files', async () => {
  const fixture = makeFixture()
  const { ctx, registered } = makeCtx()
  registerTools(ctx, { paths: fixture.paths, config: fixture.config, env: makeFakeEnv(fixture.paths) })
  const scriptTool = registered.find((tool) => tool.name === 'ars_script')

  await assert.rejects(() => scriptTool.execute({ script: 'scripts/../../outside.py' }), /escapes the payload root/)
  await assert.rejects(
    () => scriptTool.execute({ script: fixture.outsideScript }),
    /escapes the payload root/,
  )
  await assert.rejects(() => scriptTool.execute({ script: 'scripts/noext.txt' }), /unsupported script type/)
  await assert.rejects(() => scriptTool.execute({ script: 'scripts/missing.py' }), /not found/)
  await assert.rejects(() => scriptTool.execute({ script: '../outside-script.py' }), /escapes the payload root/)

  const symlinkPath = join(fixture.paths.scriptsRoot, 'escape.py')
  if (existsSync(symlinkPath)) {
    await assert.rejects(
      () => scriptTool.execute({ script: 'scripts/escape.py' }),
      /escapes the payload root/,
    )
  }
})

test('ars_script reports non-zero exits and captures stderr', { skip: !PYTHON_AVAILABLE && 'python3 not available' }, async () => {
  const fixture = makeFixture()
  const { ctx, registered } = makeCtx()
  registerTools(ctx, { paths: fixture.paths, config: fixture.config, env: makeFakeEnv(fixture.paths) })
  const scriptTool = registered.find((tool) => tool.name === 'ars_script')
  const result = await scriptTool.execute({ script: 'scripts/fail.py' }, {})
  assert.equal(result.exitCode, 3)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /bad/)
})

test('ars_script truncates each stream at the configured byte cap', { skip: !PYTHON_AVAILABLE && 'python3 not available' }, async () => {
  const fixture = makeFixture()
  const config = normalizeConfig(
    { envDir: join(fixture.root, 'venv'), maxScriptOutputBytes: 4096 },
    { home: fixture.root },
  )
  const { ctx, registered } = makeCtx()
  registerTools(ctx, { paths: fixture.paths, config, env: makeFakeEnv(fixture.paths) })
  const scriptTool = registered.find((tool) => tool.name === 'ars_script')
  const result = await scriptTool.execute({ script: 'scripts/big.py' }, {})
  assert.equal(result.exitCode, 0)
  assert.equal(result.truncated, true)
  assert.equal(Buffer.byteLength(result.stdout, 'utf8'), 4096)
})

test('ars_script enforces the timeout', { skip: !PYTHON_AVAILABLE && 'python3 not available' }, async () => {
  const fixture = makeFixture()
  const { ctx, registered } = makeCtx()
  registerTools(ctx, { paths: fixture.paths, config: fixture.config, env: makeFakeEnv(fixture.paths) })
  const scriptTool = registered.find((tool) => tool.name === 'ars_script')
  const started = Date.now()
  const result = await scriptTool.execute({ script: 'scripts/slow.py', timeoutMs: 150 }, {})
  assert.equal(result.exitCode, null)
  assert.match(result.stderr, /timed out after 150ms/)
  assert.ok(Date.now() - started < 5000, 'timeout should kill the child promptly')
})

test('ars_env_setup delegates to env.ensure with force and signal', async () => {
  const fixture = makeFixture()
  const { ctx, registered } = makeCtx()
  const env = makeFakeEnv(fixture.paths)
  registerTools(ctx, { paths: fixture.paths, config: fixture.config, env })
  const tool = registered.find((entry) => entry.name === 'ars_env_setup')
  const signal = new AbortController().signal
  const result = await tool.execute({ force: true }, { signal })
  assert.equal(result.ok, true)
  assert.equal(env.ensureCalls.length, 1)
  assert.deepEqual(env.ensureCalls[0], { force: true, signal })
})
