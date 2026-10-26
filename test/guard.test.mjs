import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPaths } from '../lib/paths.js'
import { createHost } from './support/host.mjs'
import { normalizeConfig } from '../lib/config.js'
import {
  DEFAULT_TOOL_MAP,
  PHASE_FENCE_STATUS,
  evaluateDecision,
  fnmatch,
  manifestKey,
  matchesAny,
  normalizeTarget,
  realpath,
  registerGuard,
} from '../lib/guard.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..')
const PAYLOAD_ROOT = join(PLUGIN_ROOT, 'payload')
const REPO = resolve(HERE, '..', '..', 'repo')
// Prefer the sibling upstream checkout for parity, but fall back to the
// shipped payload (byte-identical to that commit) and a committed fixture so a
// fresh clone can still exercise the guard.
const GUARD_REFERENCE = existsSync(join(REPO, 'scripts', 'ars_write_scope_guard.py'))
  ? join(REPO, 'scripts', 'ars_write_scope_guard.py')
  : join(PAYLOAD_ROOT, 'scripts', 'ars_write_scope_guard.py')
const MANIFEST_REFERENCE = existsSync(join(REPO, 'scripts', 'ars_phase_scope_manifest.json'))
  ? join(REPO, 'scripts', 'ars_phase_scope_manifest.json')
  : join(PAYLOAD_ROOT, 'scripts', 'ars_phase_scope_manifest.json')
const FIXTURES_REFERENCE = existsSync(
  join(REPO, 'scripts', 'fixtures', 'write_scope_guard', 'captured_payloads.json'),
)
  ? join(REPO, 'scripts', 'fixtures', 'write_scope_guard', 'captured_payloads.json')
  : join(HERE, 'fixtures', 'captured_payloads.json')
const REFERENCE_AVAILABLE = existsSync(GUARD_REFERENCE) && existsSync(MANIFEST_REFERENCE)

const MANIFEST = REFERENCE_AVAILABLE
  ? JSON.parse(readFileSync(MANIFEST_REFERENCE, 'utf8'))
  : {
      version: 1,
      agents: {
        synthesis_agent: { bucket: 'A', allowed_write_globs: ['phase3_*/**'] },
        research_question_agent: { bucket: 'A', allowed_write_globs: ['phase1_*/**'] },
        bibliography_agent: { bucket: 'A', allowed_write_globs: ['phase2_*/**'] },
        draft_writer_agent: { bucket: 'A', allowed_write_globs: ['phase4_*/**', 'phase6_*/**'] },
      },
    }

/** Temp workspace + upstream-shaped plugin root shared by the decision cases. */
function makeRoots(prefix = 'ars-guard-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const ws = join(root, 'ws')
  const plugin = join(root, 'plugin')
  const outside = join(root, 'outside')
  for (const dir of [
    join(ws, 'phase3_analysis'),
    join(ws, 'phase2_data'),
    join(ws, 'phase4_draft'),
    join(plugin, 'hooks'),
    join(plugin, 'scripts'),
    join(plugin, 'agents'),
    join(plugin, 'deep-research', 'agents'),
    outside,
  ]) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(join(plugin, 'hooks', 'hooks.json'), '{}')
  writeFileSync(join(plugin, 'hooks', 'run_guard.sh'), '#!/bin/sh\n')
  writeFileSync(join(plugin, 'scripts', 'ars_write_scope_guard.py'), '')
  writeFileSync(join(plugin, 'scripts', 'ars_phase_scope_manifest.json'), JSON.stringify(MANIFEST))
  writeFileSync(join(plugin, 'agents', 'synthesis_agent.md'), '')
  writeFileSync(join(plugin, 'deep-research', 'agents', 'synthesis_agent.md'), '')
  try {
    symlinkSync(outside, join(ws, 'escape_link'))
  } catch {
    /* platforms without symlink permission skip the symlink cases below */
  }
  return { root, ws, plugin, outside }
}

const ROOTS = makeRoots()

function substitute(value) {
  return JSON.parse(
    JSON.stringify(value)
      .split('{WORKSPACE}')
      .join(ROOTS.ws)
      .split('{HOME}')
      .join(ROOTS.root)
      .split('{PROJECT}')
      .join('project'),
  )
}

function decide(entry) {
  const workspaceRoot = entry.workspaceRoot || ROOTS.ws
  const pluginRoot = entry.pluginRoot || ROOTS.plugin
  const decision = evaluateDecision({
    toolName: entry.tool,
    toolInput: entry.input,
    agentType: entry.agent,
    cwd: entry.cwd || workspaceRoot,
    workspaceRoot,
    pluginRoot,
    manifest: entry.manifest || MANIFEST,
    toolMap: entry.toolMap || DEFAULT_TOOL_MAP,
    guardInfra: entry.guardInfra !== false,
  })
  return {
    decision: decision.decision,
    flags: Object.keys(decision)
      .filter((key) => key !== 'decision' && key !== 'reason')
      .sort(),
    reason: decision.reason,
  }
}

/**
 * Cases compared bit-for-bit against the upstream Python reference.
 * `expected` is the pre-computed upstream decision so the test still runs on a
 * host without the upstream checkout or Python.
 */
const PARITY_CASES = [
  // Captured Claude Code payloads are appended from the fixture below.
  {
    label: 'infra_hooks_write_by_bucket_a',
    tool: 'Write',
    input: { file_path: join(ROOTS.plugin, 'hooks', 'hooks.json') },
    agent: 'academic-research-skills:synthesis_agent',
    expected: 'deny',
    expectedFlags: [],
  },
  {
    label: 'infra_guard_script_main_session',
    tool: 'Write',
    input: { file_path: join(ROOTS.plugin, 'scripts', 'ars_write_scope_guard.py') },
    expected: 'deny',
    expectedFlags: [],
  },
  {
    label: 'infra_manifest_edit_main_session',
    tool: 'Edit',
    input: { file_path: join(ROOTS.plugin, 'scripts', 'ars_phase_scope_manifest.json') },
    expected: 'deny',
    expectedFlags: [],
  },
  {
    label: 'infra_agent_definition',
    tool: 'Write',
    input: { file_path: join(ROOTS.plugin, 'deep-research', 'agents', 'synthesis_agent.md') },
    expected: 'deny',
    expectedFlags: [],
  },
  {
    label: 'schema_drift_bucket_a',
    tool: 'Write',
    input: { content: 'no file path' },
    agent: 'academic-research-skills:synthesis_agent',
    expected: 'deny',
    expectedFlags: ['schema_drift_advisory'],
  },
  {
    label: 'schema_drift_null_tool_input',
    tool: 'Write',
    input: null,
    agent: 'academic-research-skills:synthesis_agent',
    expected: 'deny',
    expectedFlags: ['schema_drift_advisory'],
  },
  {
    label: 'bash_bucket_a_denied_wholesale',
    tool: 'Bash',
    input: { command: 'ls' },
    agent: 'academic-research-skills:synthesis_agent',
    expected: 'deny',
    expectedFlags: ['bash_denied'],
  },
  {
    label: 'bash_main_session_allowed',
    tool: 'Bash',
    input: { command: 'ls' },
    expected: 'allow',
    expectedFlags: [],
  },
  {
    label: 'escape_bucket_a_denied',
    tool: 'Write',
    input: { file_path: join(ROOTS.outside, 'x.md') },
    agent: 'academic-research-skills:synthesis_agent',
    expected: 'deny',
    expectedFlags: [],
  },
  {
    label: 'escape_main_session_allowed',
    tool: 'Write',
    input: { file_path: join(ROOTS.outside, 'x.md') },
    expected: 'allow',
    expectedFlags: ['absent_agent_type_advisory'],
  },
  {
    label: 'symlink_escape_bucket_a_denied',
    tool: 'Write',
    input: { file_path: join(ROOTS.ws, 'escape_link', 'x.md') },
    agent: 'academic-research-skills:synthesis_agent',
    expected: 'deny',
    expectedFlags: [],
  },
  {
    label: 'root_file_named_phase1_is_not_the_phase_dir',
    tool: 'Write',
    input: { file_path: join(ROOTS.ws, 'phase1_x.md') },
    agent: 'academic-research-skills:research_question_agent',
    expected: 'deny',
    expectedFlags: [],
  },
  {
    label: 'traversal_from_workspace_into_plugin_infra',
    tool: 'Write',
    input: { file_path: join(ROOTS.ws, '..', 'plugin', 'hooks', 'hooks.json') },
    expected: 'deny',
    expectedFlags: [],
  },
  {
    label: 'dotdot_within_workspace_out_of_phase',
    tool: 'Write',
    input: { file_path: join(ROOTS.ws, 'phase3_analysis', '..', 'phase2_data', 'x.md') },
    agent: 'academic-research-skills:synthesis_agent',
    expected: 'deny',
    expectedFlags: [],
  },
  {
    label: 'phase3_write_allowed',
    tool: 'Write',
    input: { file_path: join(ROOTS.ws, 'phase3_analysis', 'x.md') },
    agent: 'academic-research-skills:synthesis_agent',
    expected: 'allow',
    expectedFlags: [],
  },
  {
    label: 'bare_agent_name_allowed',
    tool: 'Write',
    input: { file_path: join(ROOTS.ws, 'phase3_analysis', 'bare.md') },
    agent: 'synthesis_agent',
    expected: 'allow',
    expectedFlags: [],
  },
  {
    label: 'agent_name_case_is_exact',
    tool: 'Write',
    input: { file_path: join(ROOTS.ws, 'x.md') },
    agent: 'Synthesis_Agent',
    expected: 'allow',
    expectedFlags: [],
  },
  {
    label: 'uninspected_tool_allowed',
    tool: 'Read',
    input: { file_path: '/etc/passwd' },
    expected: 'allow',
    expectedFlags: [],
  },
  {
    label: 'draft_writer_phase6_union_allowed',
    tool: 'Write',
    input: { file_path: join(ROOTS.ws, 'phase6_revision', 'x.md') },
    agent: 'academic-research-skills:draft_writer_agent',
    expected: 'allow',
    expectedFlags: [],
  },
]

function fixtureCases() {
  if (!existsSync(FIXTURES_REFERENCE)) return []
  const fixture = JSON.parse(readFileSync(FIXTURES_REFERENCE, 'utf8'))
  return fixture.cases.map((entry) => ({
    label: `captured:${entry.label}`,
    tool: entry.payload.tool_name,
    input: substitute(entry.payload).tool_input,
    agent: entry.payload.agent_type,
    cwd: substitute(entry.payload).cwd,
    expected: entry.expected_decision,
    expectedFlags:
      entry.expected_decision === 'allow' && !entry.payload.agent_type
        ? ['absent_agent_type_advisory']
        : [],
  }))
}

const ALL_PARITY_CASES = [...fixtureCases(), ...PARITY_CASES]

test('captured upstream fixtures match the recorded decisions', () => {
  const fixtures = fixtureCases()
  assert.equal(fixtures.length, 3, 'captured_payloads.json must expose 3 cases')
  for (const entry of fixtures) {
    const result = decide(entry)
    assert.equal(result.decision, entry.expected, entry.label)
  }
})

test('guard decisions match the upstream Python reference', { skip: !REFERENCE_AVAILABLE && 'upstream repo not available' }, () => {
  const python = spawnSync('python3', ['--version'], { encoding: 'utf8' })
  if (python.error || python.status !== 0) {
    test.skip('python3 not available on this host')
    return
  }
  const inputPath = join(ROOTS.root, 'parity-input.json')
  const outputPath = join(ROOTS.root, 'parity-output.json')
  writeFileSync(
    inputPath,
    JSON.stringify(
      ALL_PARITY_CASES.map((entry) => ({
        payload: {
          tool_name: entry.tool,
          tool_input: entry.input,
          ...(entry.agent ? { agent_type: entry.agent } : {}),
          cwd: entry.cwd || ROOTS.ws,
        },
        workspaceRoot: ROOTS.ws,
        pluginRoot: entry.pluginRoot || ROOTS.plugin,
      })),
    ),
  )
  const script = [
    'import importlib.util, json, sys',
    "spec = importlib.util.spec_from_file_location('guard', sys.argv[1])",
    'guard = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(guard)',
    'manifest = json.load(open(sys.argv[2], encoding="utf-8"))',
    'cases = json.load(open(sys.argv[3], encoding="utf-8"))',
    'out = []',
    'for case in cases:',
    '    decision = guard.evaluate_decision(case["payload"], manifest, case["workspaceRoot"], case["pluginRoot"])',
    '    out.append({"decision": decision["decision"], "flags": sorted(k for k in decision if k not in ("decision", "reason"))})',
    'json.dump(out, open(sys.argv[4], "w", encoding="utf-8"))',
  ].join('\n')
  const run = spawnSync(
    'python3',
    ['-B', '-c', script, GUARD_REFERENCE, MANIFEST_REFERENCE, inputPath, outputPath],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
  )
  assert.equal(run.status, 0, run.stderr)
  const expected = JSON.parse(readFileSync(outputPath, 'utf8'))
  assert.equal(expected.length, ALL_PARITY_CASES.length)
  for (let index = 0; index < ALL_PARITY_CASES.length; index += 1) {
    const entry = ALL_PARITY_CASES[index]
    const actual = decide(entry)
    assert.deepEqual(
      { decision: actual.decision, flags: actual.flags },
      expected[index],
      `parity mismatch: ${entry.label}`,
    )
    assert.equal(actual.decision, entry.expected, entry.label)
    assert.deepEqual(actual.flags, entry.expectedFlags, `${entry.label} advisory flags`)
  }
  assert.ok(ALL_PARITY_CASES.length >= 20, `only ${ALL_PARITY_CASES.length} parity cases`)
})

test('plugin-specific infra protection denies writes to plugin and payload enforcement files', () => {
  const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
  const cases = [
    join(pluginRoot, 'index.js'),
    join(pluginRoot, 'package.json'),
    join(pluginRoot, 'cordis.patch.yml'),
    join(pluginRoot, 'bin', 'ars-python'),
    join(pluginRoot, 'lib', 'guard.js'),
    join(pluginRoot, 'payload', 'hooks', 'hooks.json'),
    join(pluginRoot, 'payload', 'scripts', 'ars_write_scope_guard.py'),
    join(pluginRoot, 'payload', 'scripts', 'ars_phase_scope_manifest.json'),
    join(pluginRoot, 'payload', 'agents', 'synthesis_agent.md'),
    join(pluginRoot, 'payload', 'deep-research', 'agents', 'research_question_agent.md'),
  ]
  for (const target of cases) {
    const decision = evaluateDecision({
      toolName: 'write',
      toolInput: { file_path: target },
      workspaceRoot: ROOTS.ws,
      pluginRoot,
      manifest: MANIFEST,
    })
    assert.equal(decision.decision, 'deny', `${target} must be infra-protected`)
    assert.match(decision.reason, /enforcement infrastructure/)
  }
})

test('infra protection canonicalizes mixed-case paths on case-insensitive filesystems', (t) => {
  const mixedTargets = [
    join(PLUGIN_ROOT, 'LIB', 'guard.js'),
    join(PLUGIN_ROOT, 'Index.js'),
    join(PLUGIN_ROOT, 'payload', 'scripts', 'ARS_WRITE_SCOPE_GUARD.PY'),
  ]
  if (!existsSync(mixedTargets[0])) {
    t.skip('filesystem is case-sensitive; mixed-case aliases do not exist')
    return
  }
  for (const target of mixedTargets) {
    const decision = evaluateDecision({
      toolName: 'write',
      toolInput: { file_path: target },
      workspaceRoot: ROOTS.ws,
      pluginRoot: PLUGIN_ROOT,
      manifest: MANIFEST,
    })
    assert.equal(decision.decision, 'deny', `${target} must be infra-protected after case canonicalization`)
  }
})

test('DSH tool mapping inspects write/edit/bash and ignores other tools', () => {
  const workspace = ROOTS.ws
  const mapped = evaluateDecision({
    toolName: 'write',
    toolInput: { file_path: join(workspace, 'phase2_data', 'x.md') },
    agentType: 'synthesis_agent',
    workspaceRoot: workspace,
    pluginRoot: ROOTS.plugin,
    manifest: MANIFEST,
  })
  assert.equal(mapped.decision, 'deny')

  const edit = evaluateDecision({
    toolName: 'edit',
    toolInput: { file_path: join(workspace, 'phase3_analysis', 'x.md') },
    agentType: 'synthesis_agent',
    workspaceRoot: workspace,
    pluginRoot: ROOTS.plugin,
    manifest: MANIFEST,
  })
  assert.equal(edit.decision, 'allow')

  const ignored = evaluateDecision({
    toolName: 'str_replace',
    toolInput: { file_path: join(ROOTS.outside, 'x.md') },
    agentType: 'synthesis_agent',
    workspaceRoot: workspace,
    pluginRoot: ROOTS.plugin,
    manifest: MANIFEST,
  })
  assert.equal(ignored.decision, 'allow')
  assert.equal(ignored.reason, '')
})

test('guardInfra=false disables only infrastructure protection', () => {
  const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
  const disabled = evaluateDecision({
    toolName: 'write',
    toolInput: { file_path: join(pluginRoot, 'index.js') },
    workspaceRoot: ROOTS.ws,
    pluginRoot,
    manifest: MANIFEST,
    guardInfra: false,
  })
  assert.equal(disabled.decision, 'allow')
  assert.equal(disabled.absent_agent_type_advisory, true)
})

test('workspace-relative glob matcher is segment-aware', () => {
  assert.equal(matchesAny('phase2_data/x.md', ['phase2_*/**']), true)
  assert.equal(matchesAny('phase2_data/nested/x.md', ['phase2_*/**']), true)
  assert.equal(matchesAny('phase2_x.md', ['phase2_*/**']), false)
  assert.equal(matchesAny('phase2_data', ['phase2_*/**']), false)
  assert.equal(matchesAny('a/b/name.md', ['**/name.md']), true)
  assert.equal(matchesAny('name.md', ['**/name.md']), false)
  assert.equal(matchesAny('name.md', ['name.md']), true)
  assert.equal(matchesAny('phase12/notes', ['phase[12]*/**']), true)
  assert.equal(matchesAny('phase3/notes', ['phase[!12]*/**']), true)
  assert.equal(matchesAny('a/b', ['a/**']), true)
  assert.equal(matchesAny('a', ['a/**']), false)
})

test('single-segment fnmatch supports *, ?, and character classes', () => {
  assert.equal(fnmatch('phase3_analysis', 'phase3_*'), true)
  assert.equal(fnmatch('phase3_analysis', 'phase?_analysis'), true)
  assert.equal(fnmatch('phase3_analysis', 'phase[45]_*'), false)
  assert.equal(fnmatch('phase4_analysis', 'phase[45]_*'), true)
  // Bare fnmatch has no separator awareness (same as Python fnmatch);
  // matchesAny() is the path-aware layer that splits segments first.
  assert.equal(fnmatch('a/b', 'a*'), true)
  assert.equal(fnmatch('phase3', 'phase[!12]*'), true)
})

test('deep paths do not overflow the iterative matcher', () => {
  const segments = new Array(2000).fill('d')
  appendDeep(segments)
  assert.equal(matchesAny(segments.join('/'), ['**/leaf']), true)
  assert.equal(matchesAny(segments.slice(0, -1).join('/'), ['**/leaf']), false)
})

function appendDeep(segments) {
  segments.push('leaf')
}

test('realpath resolves symlinks and .. in filesystem order', () => {
  const root = mkdtempSync(join(tmpdir(), 'ars-realpath-'))
  mkdirSync(join(root, 'real', 'sub'), { recursive: true })
  symlinkSync(join(root, 'real'), join(root, 'link'))
  const realRoot = realpathSync(root)
  const raw = join(root, 'link', 'sub', '..', 'not-yet-created', 'x.md')
  assert.equal(realpath(raw), join(realRoot, 'real', 'not-yet-created', 'x.md'))
  // Lexical collapsing would have produced root/not-yet-created/x.md.
  assert.notEqual(realpath(raw), join(realRoot, 'not-yet-created', 'x.md'))
})

test('normalizeTarget canonicalizes before containment checks', () => {
  const root = mkdtempSync(join(tmpdir(), 'ars-normalize-'))
  const ws = join(root, 'ws')
  const outside = join(root, 'outside')
  mkdirSync(join(ws, 'phase1'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  symlinkSync(outside, join(ws, 'link'))
  const inside = normalizeTarget(join(ws, 'phase1', 'x.md'), ws, ws)
  assert.equal(inside.escaped, false)
  assert.equal(inside.relPath, join('phase1', 'x.md'))
  const escaped = normalizeTarget(join(ws, 'link', 'x.md'), ws, ws)
  assert.equal(escaped.escaped, true)
  assert.equal(normalizeTarget(ws, ws, ws).escaped, true, 'workspace root itself is not writable')
})

test('manifestKey strips only this plugin namespace', () => {
  assert.equal(manifestKey('academic-research-skills:synthesis_agent'), 'synthesis_agent')
  assert.equal(manifestKey('synthesis_agent'), 'synthesis_agent')
  assert.equal(manifestKey('other-plugin:synthesis_agent'), 'other-plugin:synthesis_agent')
  assert.equal(manifestKey(undefined), undefined)
})

function makeGuardContext() {
  const host = createHost()
  return {
    ctx: host.ctx,
    guards: host.state.guards,
    effects: host.state.effects,
    warnings: host.state.warnings,
  }
}

function makeGuardPaths(root = ROOTS.root) {
  const pluginRoot = join(root, 'guard-plugin')
  mkdirSync(join(pluginRoot, 'hooks'), { recursive: true })
  mkdirSync(join(pluginRoot, 'payload', 'scripts'), { recursive: true })
  writeFileSync(join(pluginRoot, 'hooks', 'hooks.json'), '{}')
  writeFileSync(join(pluginRoot, 'index.js'), '')
  writeFileSync(join(pluginRoot, 'package.json'), '{}')
  writeFileSync(join(pluginRoot, 'payload', 'scripts', 'ars_write_scope_guard.py'), '')
  return createPaths(pluginRoot)
}

function guardOptions(paths, overrides = {}) {
  return {
    paths,
    config: normalizeConfig({ envDir: join(paths.pluginRoot, 'venv') }, { home: paths.pluginRoot }),
    manifest: MANIFEST,
    ...overrides,
  }
}

test('registerGuard registers one effect-scoped synchronous guard', () => {
  const { ctx, guards, effects } = makeGuardContext()
  const paths = makeGuardPaths()
  assert.equal(registerGuard(ctx, guardOptions(paths)), true)
  assert.equal(guards.length, 1)
  assert.equal(effects.length, 1)
  assert.equal(typeof effects[0], 'function')

  const allow = guards[0]({
    name: 'write',
    arguments: { file_path: join(ROOTS.ws, 'phase3_analysis', 'x.md') },
    agent: { id: 'main', session: { header: { cwd: ROOTS.ws } } },
  })
  assert.equal(allow, undefined)
})

test('registerGuard honors config.guard=false', () => {
  const { ctx, guards } = makeGuardContext()
  const paths = makeGuardPaths()
  const config = normalizeConfig({ guard: false }, { home: paths.pluginRoot })
  assert.equal(registerGuard(ctx, { paths, config, manifest: MANIFEST }), false)
  assert.equal(guards.length, 0)
})

test('registered guard denies infra writes for the main session', () => {
  const { ctx, guards } = makeGuardContext()
  const paths = makeGuardPaths()
  registerGuard(ctx, guardOptions(paths))
  const reason = guards[0]({
    name: 'write',
    arguments: { file_path: join(paths.pluginRoot, 'hooks', 'hooks.json') },
    agent: { id: 'main', session: { header: { cwd: ROOTS.ws } } },
  })
  assert.equal(typeof reason, 'string')
  assert.match(reason, /enforcement infrastructure/)
})

test('registered guard denies schema-drift write payloads', () => {
  const { ctx, guards } = makeGuardContext()
  const paths = makeGuardPaths()
  registerGuard(ctx, guardOptions(paths))
  const reason = guards[0]({
    name: 'write',
    arguments: {},
    agent: { id: 'main', session: { header: { cwd: ROOTS.ws } } },
  })
  assert.equal(typeof reason, 'string')
  assert.match(reason, /no top-level file_path/)
})

test('evaluateDecision applies the phase fence for an explicit agentType only', () => {
  const scopedAgent = 'academic-research-skills:synthesis_agent'
  const base = {
    toolName: 'write',
    workspaceRoot: ROOTS.ws,
    pluginRoot: ROOTS.plugin,
    manifest: MANIFEST,
  }

  const allowed = evaluateDecision({
    ...base,
    toolInput: { file_path: join(ROOTS.ws, 'phase3_analysis', 'ok.md') },
    agentType: scopedAgent,
  })
  assert.equal(allowed.decision, 'allow')

  const denied = evaluateDecision({
    ...base,
    toolInput: { file_path: join(ROOTS.ws, 'phase2_data', 'no.md') },
    agentType: scopedAgent,
  })
  assert.equal(denied.decision, 'deny')
  assert.match(denied.reason, /may not write/)

  const bareName = evaluateDecision({
    ...base,
    toolInput: { file_path: join(ROOTS.ws, 'phase3_analysis', 'bare.md') },
    agentType: 'synthesis_agent',
  })
  assert.equal(bareName.decision, 'allow')

  const bashDenied = evaluateDecision({
    ...base,
    toolName: 'bash',
    toolInput: { command: 'ls' },
    agentType: scopedAgent,
  })
  assert.equal(bashDenied.decision, 'deny')
  assert.equal(bashDenied.bash_denied, true)
  assert.match(bashDenied.reason, /may not use Bash/)

  // The same write without an explicit agent type is unconstrained, which is
  // exactly what the registered guard relies on (see PHASE_FENCE_STATUS).
  const noAgentType = evaluateDecision({
    ...base,
    toolInput: { file_path: join(ROOTS.ws, 'phase2_data', 'no.md') },
  })
  assert.equal(noAgentType.decision, 'allow')
  assert.equal(noAgentType.absent_agent_type_advisory, true)
})

test('PHASE_FENCE_STATUS honestly reports the phase fence as unavailable', () => {
  assert.equal(PHASE_FENCE_STATUS.mode, 'unavailable')
  assert.equal(typeof PHASE_FENCE_STATUS.reason, 'string')
  assert.match(PHASE_FENCE_STATUS.reason, /no agent type/)
  assert.match(PHASE_FENCE_STATUS.reason, /explicit role source/)
  assert.ok(Object.isFrozen(PHASE_FENCE_STATUS))
})

test('registerGuard never supplies an agent type, so the phase fence stays unavailable', () => {
  const { ctx, guards } = makeGuardContext()
  const paths = makeGuardPaths()
  registerGuard(ctx, guardOptions(paths))
  // A random child and an agent whose id merely looks like a manifest role are
  // both unconstrained: no role registry exists (PHASE_FENCE_STATUS).
  for (const id of ['random-child', 'synthesis_agent']) {
    const reason = guards[0]({
      name: 'write',
      arguments: { file_path: join(ROOTS.ws, 'phase2_data', 'any.md') },
      agent: { id, session: { header: { cwd: ROOTS.ws } } },
    })
    assert.equal(reason, undefined, `${id} must not be treated as a known ARS role`)
  }
})

test('registerGuard keeps infra protection when the manifest is unreadable', () => {
  const { ctx, guards, warnings } = makeGuardContext()
  const paths = createPaths(join(ROOTS.root, 'no-manifest-plugin'))
  mkdirSync(paths.payloadRoot, { recursive: true })
  mkdirSync(paths.pluginRoot, { recursive: true })
  writeFileSync(join(paths.pluginRoot, 'index.js'), '')
  const config = normalizeConfig({}, { home: paths.pluginRoot })
  assert.equal(registerGuard(ctx, { paths, config }), true)
  assert.ok(warnings.some((message) => message.includes('manifest unreadable')))
  const reason = guards[0]({
    name: 'write',
    arguments: { file_path: join(paths.pluginRoot, 'index.js') },
    agent: { id: 'main', session: { header: { cwd: paths.pluginRoot } } },
  })
  assert.equal(typeof reason, 'string')
  assert.match(reason, /enforcement infrastructure/)
})

test('registerGuard fails closed when the guard itself throws', () => {
  const { ctx, guards } = makeGuardContext()
  const paths = makeGuardPaths()
  registerGuard(ctx, guardOptions(paths))
  const exploding = new Proxy(
    {},
    {
      get() {
        throw new Error('hostile execution')
      },
    },
  )
  const reason = guards[0](exploding)
  assert.equal(typeof reason, 'string')
  assert.match(reason, /internal error/)
})

test('registerGuard with guardInfra=false leaves plugin files writable', () => {
  const { ctx, guards } = makeGuardContext()
  const paths = makeGuardPaths()
  const config = normalizeConfig({ guardInfra: false }, { home: paths.pluginRoot })
  registerGuard(ctx, { paths, config, manifest: MANIFEST })
  const reason = guards[0]({
    name: 'write',
    arguments: { file_path: join(paths.pluginRoot, 'index.js') },
    agent: { id: 'main', session: { header: { cwd: ROOTS.ws } } },
  })
  assert.equal(reason, undefined)
})
