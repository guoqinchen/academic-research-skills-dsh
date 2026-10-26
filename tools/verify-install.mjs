#!/usr/bin/env node
/**
 * Read-only install verification for `academic-research-skills-dsh`.
 *
 * What it does (nothing is installed, downloaded, or written outside a temp dir):
 *   1. checks the plugin package manifest, shipped files, locale, icon, patch;
 *   2. mounts `index.js#apply` with the REAL payload and a fake DSH context and
 *      verifies the registered surface, schemas, announce text, guard, and
 *      command-dispatch message shape;
 *   3. compares the JS write-scope guard against the upstream Python reference
 *      (`payload/scripts/ars_write_scope_guard.py`) on the captured Claude Code
 *      payload fixtures shipped in the payload plus a generated decision matrix;
 *   4. recomputes the payload inventory, digests, and REFERENCE-INDEX consistency;
 *   5. optionally cross-checks the registered tool schemas with the installed
 *      `@deepseek-ai/dsh-tools` validator, the profile install, and the upstream
 *      clone.
 *
 * Read-only guarantee: every temporary file lives under the OS temp directory
 * and is removed before exit. Python is always invoked with `-B` /
 * `PYTHONDONTWRITEBYTECODE=1` so the verification itself cannot write
 * `__pycache__` into the payload.
 *
 * Usage:
 *   node tools/verify-install.mjs           human-readable PASS/FAIL table
 *   node tools/verify-install.mjs --json    machine-readable result
 *   node tools/verify-install.mjs --help
 *
 * Exit code: 0 when no check FAILed, 1 otherwise (WARN/SKIP do not fail).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { apply } from '../index.js'
import { createPaths } from '../lib/paths.js'
import { normalizeConfig } from '../lib/config.js'
import { createAdapter } from '../lib/adapt.js'
import { createPythonEnv, DEPENDENCY_MODULES } from '../lib/env.js'
import { DEFAULT_TOOL_MAP, evaluateDecision } from '../lib/guard.js'
import {
  FORBIDDEN_RUNTIME_DEPENDENCIES,
  RUNTIME_REQUIREMENTS,
  SKILL_NAMES,
  UPSTREAM,
  formatBytes,
  parseRequirementLines,
} from '../lib/payload-contract.js'
import { payloadInventory, verifyPayload as verifyPayloadChecks } from './check-payload.mjs'
import { mountHost } from '../test/support/host.mjs'

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..')
const paths = createPaths()
const PAYLOAD_ROOT = paths.payloadRoot
const UPSTREAM_ROOT = process.env.ARS_UPSTREAM_ROOT
  ? resolve(process.env.ARS_UPSTREAM_ROOT)
  : resolve(PLUGIN_ROOT, '..', 'repo')
const adapter = createAdapter({ paths })
const DEFAULT_CONFIG = normalizeConfig(undefined)

const AGENT_SKILL_NAMES = [
  'ars-agent-synthesis',
  'ars-agent-research-architect',
  'ars-agent-report-compiler',
  'ars-agent-screening-reviewer',
]
const COMMAND_NAMES = [
  'ars-3w',
  'ars-abstract',
  'ars-cache-invalidate',
  'ars-citation-check',
  'ars-disclosure',
  'ars-format-convert',
  'ars-full',
  'ars-lit-review',
  'ars-mark-read',
  'ars-outline',
  'ars-plan',
  'ars-rebuttal-audit',
  'ars-reviewer',
  'ars-revision',
  'ars-revision-coach',
  'ars-unmark-read',
]
const TOOL_NAMES = ['ars_status', 'ars_script', 'ars_env_setup']

/** Number of shipped `lib/*.js` runtime modules on the current tree. */
const EXPECTED_LIB_MODULE_COUNT = 20

/** Shipped lib modules that must always be present, even as the set grows. */
const CORE_LIB_MODULES = Object.freeze([
  'adapt.js',
  'agents.js',
  'announce.js',
  'commands.js',
  'config.js',
  'env.js',
  'frontmatter.js',
  'guard.js',
  'paths.js',
  'payload-contract.js',
  'skills.js',
  'status.js',
  'tools.js',
])

const AGENT_FILES = Object.freeze([
  'research_architect_agent.md',
  'report_compiler_agent.md',
  'screening_reviewer_agent.md',
  'synthesis_agent.md',
])
const RESIDUAL_TOKENS = [
  '${CLAUDE_PLUGIN_ROOT}',
  'academic-research-skills:',
  'Skill tool',
  'subagent_type',
  'python3 scripts/',
  'python scripts/',
]

/* -------------------------------------------------------------------------- */
/* Result collection                                                          */
/* -------------------------------------------------------------------------- */

const results = []

function record(section, name, status, detail = '') {
  results.push({ section, name, status, detail })
}

function ensure(condition, message) {
  if (!condition) throw new Error(message)
}

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`)
}

function deepEqual(actual, expected, label) {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) throw new Error(`${label}: expected ${right}, found ${left}`)
}

function check(section, name, fn) {
  try {
    const detail = fn()
    record(section, name, 'PASS', typeof detail === 'string' ? detail : '')
    return true
  } catch (error) {
    record(section, name, 'FAIL', error instanceof Error ? error.message : String(error))
    return false
  }
}

async function checkAsync(section, name, fn) {
  try {
    const detail = await fn()
    record(section, name, 'PASS', typeof detail === 'string' ? detail : '')
    return true
  } catch (error) {
    record(section, name, 'FAIL', error instanceof Error ? error.message : String(error))
    return false
  }
}

function warn(section, name, detail) {
  record(section, name, 'WARN', detail)
}

function skip(section, name, detail) {
  record(section, name, 'SKIP', detail)
}

/* -------------------------------------------------------------------------- */
/* Independent payload inventory                                              */
/* -------------------------------------------------------------------------- */

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function modeString(mode) {
  return (mode & 0o777).toString(8).padStart(3, '0')
}

function readJson(path, label) {
  ensure(existsSync(path), `${label} is missing: ${path}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/* -------------------------------------------------------------------------- */
/* Fake DSH host (same contract as the test suites)                           */
/* -------------------------------------------------------------------------- */

// One shared fake Host contract for every suite and this verifier.
// (Imported below; payload fixtures stay local because they encode different claims.)


function mount(rawConfig) {
  return mountHost(apply, rawConfig)
}

/** One fresh temp directory for a probe; removed by the caller when relevant. */
function osTempDir() {
  return mkdtempSync(join(tmpdir(), 'ars-verify-probe-'))
}

/* -------------------------------------------------------------------------- */
/* Real DSH validator (optional)                                              */
/* -------------------------------------------------------------------------- */

async function loadDshTools() {
  const candidates = [
    process.env.ARS_DSH_TOOLS_MODULE,
    join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const module = await import(pathToFileURL(candidate).href)
      if (typeof module.assertSupportedJsonSchema === 'function') {
        return { module, path: candidate }
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Schema mirror (used for the local schema check)                            */
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
  ensure(node !== null && typeof node === 'object' && !Array.isArray(node), `${path}: not an object`)
  for (const key of Object.keys(node)) ensure(ALLOWED_SCHEMA_KEYS.has(key), `${path}: unsupported keyword ${key}`)
  if (node.type !== undefined) ensure(SCALAR_TYPES.has(node.type), `${path}: unsupported type ${node.type}`)
  if (node.oneOf !== undefined) {
    ensure(Array.isArray(node.oneOf) && node.oneOf.length >= 2, `${path}: oneOf needs 2+ branches`)
    node.oneOf.forEach((branch, index) => assertRawSchema(branch, `${path}.oneOf[${index}]`))
  }
  if (node.properties !== undefined) {
    equal(node.type, 'object', `${path}.properties type`)
    for (const [name, child] of Object.entries(node.properties)) {
      assertRawSchema(child, `${path}.properties.${name}`)
      ensure(child.required !== true, `${path}.properties.${name}: per-property required is rejected`)
    }
  }
  if (node.required !== undefined) {
    ensure(Array.isArray(node.required), `${path}: required must be an array`)
    equal(node.type, 'object', `${path}: required only on objects`)
    for (const name of node.required) {
      ensure(node.properties && Object.hasOwn(node.properties, name), `${path}: required ${name} has no property`)
    }
  }
  if (node.additionalProperties !== undefined) {
    equal(typeof node.additionalProperties, 'boolean', `${path}: additionalProperties boolean`)
  }
  if (node.items !== undefined) {
    equal(node.type, 'array', `${path}: items require type array`)
    assertRawSchema(node.items, `${path}.items`)
  }
}

/* -------------------------------------------------------------------------- */
/* Environment rows                                                           */
/* -------------------------------------------------------------------------- */

async function verifyEnvironment() {
  record('environment', 'node runtime', 'PASS', process.version)
  record('environment', 'platform', 'PASS', `${process.platform} ${process.arch}`)

  const dshCli = spawnSync('dsh', ['--version'], { encoding: 'utf8', timeout: 15000 })
  if (!dshCli.error && dshCli.status === 0) {
    record('environment', 'dsh CLI', 'PASS', dshCli.stdout.trim())
  } else {
    warn('environment', 'dsh CLI', 'dsh is not on PATH; bundle installation cannot be re-verified here')
  }

  const python = spawnSync('python3', ['-B', '--version'], { encoding: 'utf8', timeout: 15000 })
  if (!python.error && python.status === 0) {
    record('environment', 'python3', 'PASS', python.stdout.trim() || python.stderr.trim())
  } else {
    warn('environment', 'python3', 'python3 is not available; Python gates and guard parity cannot run')
  }

  const env = createPythonEnv({ paths, config: DEFAULT_CONFIG })
  const status = await env.status()
  if (status.ready) {
    record('environment', 'managed Python environment', 'PASS',
      `${status.mode} ${status.pythonVersion ?? '?'} (${status.venvPath}); ${DEPENDENCY_MODULES.length}/${DEPENDENCY_MODULES.length} runtime deps present`)
  } else {
    warn('environment', 'managed Python environment',
      `${status.mode} interpreter=${status.executable} missing=[${status.missing.join(', ')}] — run ars_env_setup`)
  }

  const installedRoot = join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'academic-research-skills-dsh')
  if (existsSync(installedRoot)) {
    let real = null
    try {
      real = realpathSync(installedRoot)
    } catch {
      real = null
    }
    const linked = real !== null && real === realpathSync(PLUGIN_ROOT)
    record('environment', 'installed in desktop profile', 'PASS',
      linked ? `linked to this checkout (${real})` : `installed copy at ${installedRoot}`)
  } else {
    warn('environment', 'installed in desktop profile', 'not installed in ~/.dsh/profiles/desktop (the Lead owns installation)')
  }

  const dshTools = await loadDshTools()
  if (dshTools !== null) {
    let version = 'unknown'
    try {
      version = readJson(join(dirname(dirname(dshTools.path)), 'package.json'), 'dsh-tools package.json').version
    } catch {
      /* keep unknown */
    }
    record('environment', 'real DSH schema validator', 'PASS', `@deepseek-ai/dsh-tools ${version}`)
  } else {
    warn('environment', 'real DSH schema validator', 'installed @deepseek-ai/dsh-tools not reachable; used the local schema mirror')
  }
  return { dshTools, pythonReady: status.ready }
}

/* -------------------------------------------------------------------------- */
/* Package rows                                                               */
/* -------------------------------------------------------------------------- */

function verifyPackage() {
  const manifest = readJson(join(PLUGIN_ROOT, 'package.json'), 'package.json')
  equal(manifest.name, 'academic-research-skills-dsh', 'package name')
  equal(manifest.version, '1.0.1', 'package version')
  equal(manifest.private, true, 'package private')
  equal(manifest.type, 'module', 'package type')
  equal(manifest.engines?.dsh, '>=0.2.1-rc.3', 'engines.dsh')
  equal(JSON.stringify(manifest.os), JSON.stringify(['darwin', 'linux']), 'package os support')
  equal(manifest.license, 'CC-BY-NC-4.0', 'package license')
  record('package', 'manifest identity', 'PASS', `${manifest.name}@${manifest.version}, engines.dsh ${manifest.engines.dsh}`)

  equal(manifest.exports?.['.'], './index.js', 'exports["."]')
  equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch')
  record('package', 'bundle entry points', 'PASS', 'exports["."]=./index.js, dsh.bundle.patch=./cordis.patch.yml')

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const value = manifest[field]
    ensure(value === undefined || Object.keys(value).length === 0, `package.json ${field} must be empty`)
  }
  ensure(!existsSync(join(PLUGIN_ROOT, 'node_modules')), 'the plugin package must not carry node_modules')
  record('package', 'no npm dependencies', 'PASS', 'no dependency fields, no node_modules')

  const requiredFiles = [
    'index.js',
    'cordis.patch.yml',
    'bin/ars-python',
    'icon.svg',
    'locale/en.json',
    'locale/zh.json',
    'requirements-runtime.txt',
    'README.md',
    'NOTICE.md',
    'LICENSE',
    'tools/build-payload.mjs',
    'tools/build-python-wrapper.mjs',
    'tools/check-payload.mjs',
    'payload/PROVENANCE.json',
    'payload/REFERENCE-INDEX.json',
  ]
  for (const file of requiredFiles) ensure(existsSync(join(PLUGIN_ROOT, file)), `missing shipped file: ${file}`)
  const libFiles = readdirSync(join(PLUGIN_ROOT, 'lib')).filter((file) => file.endsWith('.js')).sort()
  equal(libFiles.length, EXPECTED_LIB_MODULE_COUNT, 'lib/*.js count')
  for (const module of CORE_LIB_MODULES) ensure(libFiles.includes(module), `missing core lib module: lib/${module}`)
  for (const file of libFiles) {
    const stats = statSync(join(PLUGIN_ROOT, 'lib', file))
    ensure(stats.isFile() && stats.size > 0, `lib/${file} is missing or empty`)
  }
  record('package', 'shipped files', 'PASS',
    `${requiredFiles.length} required files present, lib/*.js=${libFiles.length} (${EXPECTED_LIB_MODULE_COUNT} expected, ${CORE_LIB_MODULES.length} core modules present)`)

  const wrapperStat = statSync(join(PLUGIN_ROOT, 'bin', 'ars-python'))
  ensure(wrapperStat.isFile(), 'bin/ars-python is not a file')
  ensure((wrapperStat.mode & 0o111) !== 0, 'bin/ars-python is not executable')
  record('package', 'interpreter wrapper', 'PASS', `bin/ars-python mode ${modeString(wrapperStat.mode & 0o777)}`)

  for (const locale of ['en', 'zh']) {
    const data = readJson(join(PLUGIN_ROOT, 'locale', `${locale}.json`), `locale/${locale}.json`)
    ensure(typeof data.meta?.title === 'string' && data.meta.title.length > 0, `locale/${locale}.json meta.title`)
    ensure(typeof data.meta?.description === 'string' && data.meta.description.length > 0, `locale/${locale}.json meta.description`)
  }
  record('package', 'locales', 'PASS', 'en.json + zh.json carry meta.title/description')

  const icon = readFileSync(join(PLUGIN_ROOT, 'icon.svg'), 'utf8')
  ensure(/<svg[\s>]/u.test(icon), 'icon.svg must contain an <svg> root')
  record('package', 'icon', 'PASS', `${icon.length} byte SVG`)

  const requirements = parseRequirementLines(readFileSync(join(PLUGIN_ROOT, 'requirements-runtime.txt'), 'utf8'))
  deepEqual(requirements, [...RUNTIME_REQUIREMENTS], 'requirements-runtime.txt entries')
  for (const forbidden of FORBIDDEN_RUNTIME_DEPENDENCIES) {
    ensure(!requirements.some((entry) => entry.startsWith(forbidden)), `test-only dependency ${forbidden}`)
  }
  record('package', 'runtime requirements', 'PASS', `${requirements.length} entries, no test-only packages`)

  const patch = readFileSync(join(PLUGIN_ROOT, 'cordis.patch.yml'), 'utf8')
  equal((patch.match(/academic-research-skills-dsh/gu) ?? []).length, 1, 'one plugin row name')
  equal((patch.match(/id:\s*academic-research-skills\b/gu) ?? []).length, 1, 'one row id')
  ensure(/^\s*-\s*insert:/mu.test(patch), 'patch must insert a row')
  for (const flag of ['announce', 'commands', 'tools', 'guard', 'guardInfra']) {
    ensure(new RegExp(`\\b${flag}:\\s*true`, 'u').test(patch), `${flag} enabled by default`)
  }
  ensure(!/^\s*disabled:\s*true/mu.test(patch), 'row must be enabled by default')
  record('package', 'cordis.patch.yml', 'PASS', 'one enabled academic-research-skills row, all five flags true')
}

/* -------------------------------------------------------------------------- */
/* Registration rows                                                          */
/* -------------------------------------------------------------------------- */

function importSpecifiers(source) {
  const specifiers = []
  const patterns = [
    /(?:^|[\n;])\s*(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/gu,
    /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ]
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) specifiers.push(match[1])
  return specifiers
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\n)[ \t]*\/\/[^\n]*/gu, '$1')
}

async function verifyRegistration({ dshTools }) {
  const { state } = mount(undefined)

  equal(state.skills.size, 9, 'registered skills')
  equal(state.commands.size, 16, 'registered commands')
  equal(state.tools.size, 3, 'registered tools')
  equal(state.guards.length, 1, 'registered guards')
  equal(state.sections.length, 1, 'registered prompt sections')
  equal(state.disposers.length, 28, 'effect disposers')
  deepEqual(state.warnings, [], 'registration warnings')
  record('registration', 'surface counts', 'PASS',
    `skills=9 (5 research + 4 agent roles), commands=16, tools=3, guards=1, announce=1, effects=28`)

  deepEqual(
    [...state.skills.keys()],
    [...SKILL_NAMES, ...AGENT_SKILL_NAMES],
    'registered skill names',
  )
  deepEqual([...state.commands.keys()].sort(), [...COMMAND_NAMES].sort(), 'registered command names')
  deepEqual([...state.tools.keys()], TOOL_NAMES, 'registered tool names')
  record('registration', 'registered names', 'PASS', '5 research skills, 4 agent-role skills, 16 /ars-* commands')

  // Every adapted surface must be free of upstream-only tokens.
  const lintFindings = []
  for (const definition of state.skills.values()) {
    for (const finding of adapter.lint(definition.content)) lintFindings.push(`${definition.name}: ${finding}`)
  }
  equal(lintFindings.length, 0, `residual adaptation tokens: ${lintFindings.join('; ')}`)
  record('registration', 'adaptation lint', 'PASS', '9/9 registered skill bodies are lint-clean')

  const dispatchFailures = []
  const messageIds = new Set()
  let dispatched = 0
  for (const [name, definition] of state.commands) {
    const messages = []
    const invocation = {
      commandId: `verify-${name}`,
      rawInput: 'probe input',
      attachments: [],
      signal: new AbortController().signal,
      agent: {
        followup(message) {
          messages.push(message)
        },
      },
    }
    const result = await definition.handler(invocation)
    dispatched += 1
    if (result.kind !== 'success') dispatchFailures.push(`${name}: kind=${result.kind}`)
    if (messages.length !== 1) {
      dispatchFailures.push(`${name}: followup count ${messages.length}`)
      continue
    }
    const message = messages[0]
    if (message.role !== 'user') dispatchFailures.push(`${name}: role`)
    if (typeof message.id !== 'string' || message.id.length < 32) dispatchFailures.push(`${name}: id`)
    if (messageIds.has(message.id)) dispatchFailures.push(`${name}: duplicate message id`)
    messageIds.add(message.id)
    deepEqual(message.source, { kind: 'user' }, `${name} message source`)
    if (!Array.isArray(message.content) || message.content.length !== 1) dispatchFailures.push(`${name}: content`)
    const text = message.content?.[0]?.text
    if (typeof text !== 'string') {
      dispatchFailures.push(`${name}: text block`)
      continue
    }
    if (!text.includes('probe input')) dispatchFailures.push(`${name}: raw input dropped`)
    if (!text.includes(paths.payloadRoot)) dispatchFailures.push(`${name}: payload root missing`)
    for (const finding of adapter.lint(text)) dispatchFailures.push(`${name}: ${finding}`)
  }
  equal(dispatchFailures.length, 0, `command dispatch failures: ${dispatchFailures.join('; ')}`)
  record('registration', 'command dispatch', 'PASS',
    `${dispatched}/16 handlers returned success and one {id,role:'user',content:[text],source:{kind:'user'}} followup`)

  const section = state.sections[0]
  equal(section.name, 'academic-research-skills', 'section name')
  equal(section.order, 40, 'section order')
  equal(section.interpolate, false, 'section interpolate')
  for (const skill of [...SKILL_NAMES, ...AGENT_SKILL_NAMES]) {
    ensure(section.text.includes(`\`${skill}\``), `announce missing ${skill}`)
  }
  for (const command of COMMAND_NAMES) ensure(section.text.includes(`/${command}`), `announce missing /${command}`)
  ensure(section.text.includes('Commands (16)'), 'announce command count')
  ensure(section.text.includes(paths.payloadRoot), 'announce payload root')
  ensure(section.text.includes('Route unrelated coding, office, or general requests outside ARS.'), 'announce routing rule')
  equal(adapter.lint(section.text).length, 0, 'announce lint')
  record('registration', 'announce section', 'PASS', 'one order-40 static section names 5+4 skills, 16 commands, payload root, routing rule')

  for (const [name, tool] of state.tools) {
    assertRawSchema(tool.parameters, `${name}.parameters`)
    equal(tool.parameters.type, 'object', `${name}.parameters type`)
    equal(tool.parameters.additionalProperties, false, `${name}.parameters additionalProperties`)
    assertRawSchema(tool.output.schema, `${name}.output.schema`)
    equal(tool.output.schema.type, 'object', `${name}.output.schema type`)
    ensure(Array.isArray(tool.output.schema.required), `${name}: output schema required array`)
    ensure(typeof tool.output.render === 'function', `${name}: output.render`)
    ensure(typeof tool.execute === 'function', `${name}: execute`)
  }
  deepEqual(state.tools.get('ars_script').parameters.required, ['script'], 'ars_script required arguments')
  record('registration', 'tool schemas', 'PASS', '3 object-rooted raw JSON Schemas, top-level required arrays, no per-property required')

  if (dshTools !== null) {
    for (const [name, tool] of state.tools) {
      dshTools.module.assertSupportedJsonSchema(tool.parameters)
      dshTools.module.assertSupportedJsonSchema(tool.output.schema)
    }
    record('registration', 'real DSH schema validation', 'PASS', '6/6 schemas accepted by @deepseek-ai/dsh-tools')
  } else {
    skip('registration', 'real DSH schema validation', 'installed @deepseek-ai/dsh-tools not reachable')
  }

  const statusTool = state.tools.get('ars_status')
  const workspace = mkdtempSync(join(tmpdir(), 'ars-verify-ws-'))
  const agent = { id: 'verify-agent', session: { header: { cwd: workspace } } }
  const status = await statusTool.execute({}, { agent, signal: new AbortController().signal })
  equal(status.registrations.available, true, 'status registrations.available')
  for (const entry of [...status.registrations.skills, ...status.registrations.agentSkills, ...status.registrations.commands]) {
    equal(entry.registered, true, `status reports ${entry.name} registered`)
  }
  deepEqual(status.payload.missing, [], 'status payload.missing')
  deepEqual(status.payload.counts, { skills: 5, commands: 16, agentDefinitions: 4, agentFiles: 47, scripts: 642, hooks: 2 }, 'status payload counts')
  deepEqual(status.lint.warnings, [], 'status lint warnings')
  ensure(status.model !== null && typeof status.model === 'object', 'status.model object')
  ensure(status.webSearch !== null && typeof status.webSearch === 'object', 'status.webSearch object')
  equal(status.guard.phaseFence, 'unavailable', 'phase fence documented as unavailable')
  ensure(
    typeof status.guard.phaseFenceReason === 'string' && status.guard.phaseFenceReason.length > 0,
    'phase fence reason is documented',
  )
  equal(status.guard.infraProtected, true, 'infra protection enabled')
  if (dshTools !== null && typeof dshTools.module.validateJsonSchemaValue === 'function') {
    const violations = dshTools.module.validateJsonSchemaValue(statusTool.output.schema, status)
    deepEqual(violations, [], `ars_status output schema violations: ${JSON.stringify(violations)}`)
  }
  record('registration', 'ars_status live check', 'PASS',
    '9 skills + 16 commands registered, payload complete, commit 1ec249df, lint clean, Python ' +
      `${status.python.ready ? 'ready' : `not ready (${status.python.missing.join(',')})`}`)

  const guard = state.guards[0]
  const deny = (execution, pattern) => {
    const reason = guard(execution)
    ensure(typeof reason === 'string', 'expected a deny reason')
    ensure(pattern.test(reason), `deny reason did not match ${pattern}: ${reason}`)
  }
  deny({ name: 'write', arguments: { file_path: join(PLUGIN_ROOT, 'index.js') }, agent }, /enforcement infrastructure/u)
  deny({ name: 'write', arguments: { file_path: join(PLUGIN_ROOT, 'lib', 'guard.js') }, agent }, /enforcement infrastructure/u)
  deny({ name: 'edit', arguments: { file_path: join(PLUGIN_ROOT, 'payload', 'scripts', 'ars_write_scope_guard.py') }, agent }, /enforcement infrastructure/u)
  deny({ name: 'write', arguments: {}, agent }, /no top-level file_path/u)
  ensure(guard({ name: 'write', arguments: { file_path: join(workspace, 'x.md') }, agent }) === undefined, 'workspace write must pass')
  ensure(guard({ name: 'bash', arguments: { command: 'ls' }, agent }) === undefined, 'main-session Bash must pass')
  record('registration', 'write-scope guard', 'PASS',
    'infra deny for index.js/lib/guard.js/payload guard script; schema-drift deny; workspace write and Bash pass')

  const flagCases = [
    ['announce', { announce: false }, (host) => host.sections.length === 0],
    ['commands', { commands: false }, (host) => host.commands.size === 0],
    ['tools', { tools: false }, (host) => host.tools.size === 0],
    ['guard', { guard: false }, (host) => host.guards.length === 0],
  ]
  for (const [flag, rawConfig, assertion] of flagCases) {
    const host = mount(rawConfig)
    ensure(assertion(host.state), `${flag}: surface was not suppressed`)
    equal(host.state.skills.size, 9, `${flag}: skills stay registered`)
  }
  record('registration', 'config flags', 'PASS', 'announce/commands/tools/guard each suppress only their own surface')

  const runtimeFiles = [join(PLUGIN_ROOT, 'index.js'), ...readdirSync(join(PLUGIN_ROOT, 'lib'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => join(PLUGIN_ROOT, 'lib', file))]
  for (const file of runtimeFiles) {
    const source = stripComments(readFileSync(file, 'utf8'))
    for (const specifier of importSpecifiers(source)) {
      ensure(specifier.startsWith('node:') || specifier.startsWith('.'), `${file}: non-relative import "${specifier}"`)
      ensure(!specifier.startsWith('@deepseek-ai/'), `${file}: @deepseek-ai import "${specifier}"`)
    }
    ensure(!/\brequire\s*\(/u.test(source), `${file}: CommonJS require in ESM`)
  }
  record('registration', 'import hygiene', 'PASS', `${runtimeFiles.length} runtime modules import only node: built-ins and local files`)

  const wrapper = readFileSync(join(PLUGIN_ROOT, 'bin', 'ars-python'), 'utf8')
  const scriptEnv = createPythonEnv({ paths, config: DEFAULT_CONFIG }).scriptEnv()
  equal(scriptEnv.PYTHONDONTWRITEBYTECODE, '1', 'scriptEnv PYTHONDONTWRITEBYTECODE')
  equal(scriptEnv.ARS_PAYLOAD_ROOT, paths.payloadRoot, 'scriptEnv ARS_PAYLOAD_ROOT')
  ensure(String(scriptEnv.PYTHONPATH).startsWith(paths.payloadRoot), 'scriptEnv PYTHONPATH')
  ensure(wrapper.includes('PYTHONDONTWRITEBYTECODE=1'), 'wrapper bytecode suppression')
  ensure(wrapper.includes('export PYTHONDONTWRITEBYTECODE'), 'wrapper exports bytecode suppression')
  record('registration', 'payload bytecode safety', 'PASS',
    'ars_script env and bin/ars-python export PYTHONDONTWRITEBYTECODE=1 (no __pycache__ in the payload)')

  const scriptTool = state.tools.get('ars_script')
  const descriptionGate = await scriptTool.execute(
    { script: 'scripts/check_skill_description_length.py', timeoutMs: 60000 },
    {},
  )
  equal(descriptionGate.exitCode, 0, 'check_skill_description_length exit code')
  ensure(/deep-research: \d+\/1024/u.test(descriptionGate.stdout), 'description gate output missing')
  ensure(/sr-screener: \d+\/1024/u.test(descriptionGate.stdout), 'sr-screener description line missing')
  const commandGate = await scriptTool.execute(
    { script: 'scripts/check_command_frontmatter_name.py', timeoutMs: 60000 },
    {},
  )
  equal(commandGate.exitCode, 0, 'check_command_frontmatter_name exit code')
  ensure(commandGate.stdout.includes('OK (16 command files'), 'command-frontmatter gate output missing')
  // ars_script now executes Python through the generated POSIX wrapper, which
  // owns the venv/state-file resolution (see bin/ars-python behavior below).
  const wrapperInterpreter = createPythonEnv({ paths, config: DEFAULT_CONFIG }).wrapperPath()
  equal(descriptionGate.python, wrapperInterpreter, 'ars_script interpreter wrapper')
  record('registration', 'shipped Python gates execute', 'PASS',
    'check_skill_description_length.py exit 0 (5 descriptions <=1024); check_command_frontmatter_name.py exit 0 (16 command files); via ' +
      `${descriptionGate.python}`)

  const probeDirectory = osTempDir()
  // A fresh HOME means the wrapper cannot see this host's ~/.cache/ars-dsh
  // runtime-state file, and an empty ARS_DSH_VENV disables the explicit
  // override: the probe exercises the documented fallback (python3 on PATH)
  // instead of assuming the default venv or a real-host custom envDir.
  const probeHome = mkdtempSync(join(tmpdir(), 'ars-verify-home-'))
  const wrapperProbe = spawnSync(
    join(PLUGIN_ROOT, 'bin', 'ars-python'),
    ['-B', '-c', 'import json,os,sys; print(json.dumps({"payload":os.environ.get("ARS_PAYLOAD_ROOT"),"bytecode":os.environ.get("PYTHONDONTWRITEBYTECODE"),"python":sys.executable,"path0":(os.environ.get("PYTHONPATH") or "").split(os.pathsep)[0]}))'],
    { encoding: 'utf8', timeout: 30000, cwd: probeDirectory, env: { ...process.env, HOME: probeHome, ARS_DSH_VENV: '' } },
  )
  ensure(!wrapperProbe.error && wrapperProbe.status === 0, `bin/ars-python probe failed: ${wrapperProbe.stderr ?? wrapperProbe.error?.message}`)
  const probeValue = JSON.parse(wrapperProbe.stdout.trim().split('\n').pop())
  equal(probeValue.payload, paths.payloadRoot, 'wrapper ARS_PAYLOAD_ROOT')
  equal(probeValue.bytecode, '1', 'wrapper PYTHONDONTWRITEBYTECODE')
  equal(probeValue.path0, paths.payloadRoot, 'wrapper PYTHONPATH first entry')
  const python3Probe = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, HOME: probeHome },
  })
  ensure(!python3Probe.error && python3Probe.status === 0, 'python3 fallback probe failed')
  equal(probeValue.python, python3Probe.stdout.trim(), 'wrapper fallback interpreter (controlled HOME)')
  rmSync(probeHome, { recursive: true, force: true })
  record('registration', 'bin/ars-python behavior', 'PASS',
    `exports ARS_PAYLOAD_ROOT + PYTHONDONTWRITEBYTECODE=1 and executes ${probeValue.python}`)
  rmSync(probeDirectory, { recursive: true, force: true })

  for (const dispose of state.disposers) dispose()
  equal(state.skills.size, 0, 'teardown skills')
  equal(state.commands.size, 0, 'teardown commands')
  equal(state.tools.size, 0, 'teardown tools')
  equal(state.guards.length, 0, 'teardown guards')
  equal(state.sections.length, 0, 'teardown sections')
  record('registration', 'effect teardown', 'PASS', '28 disposers remove every registered surface')
  rmSync(workspace, { recursive: true, force: true })
}

/* -------------------------------------------------------------------------- */
/* Guard parity vs the upstream Python reference                              */
/* -------------------------------------------------------------------------- */

function pythonVersion() {
  const probe = spawnSync('python3', ['-B', '--version'], { encoding: 'utf8', timeout: 15000 })
  return !probe.error && probe.status === 0
}

function substitutePlaceholders(value, ctx) {
  return JSON.parse(
    JSON.stringify(value)
      .split('{WORKSPACE}').join(ctx.workspaceRoot)
      .split('{HOME}').join(ctx.home)
      .split('{PROJECT}').join('project'),
  )
}

function flagList(decision) {
  return Object.keys(decision)
    .filter((key) => key !== 'decision' && key !== 'reason')
    .sort()
}

function jsDecision(payload, roots, manifest) {
  return evaluateDecision({
    toolName: payload.tool_name,
    toolInput: payload.tool_input,
    agentType: payload.agent_type,
    cwd: payload.cwd ?? roots.workspaceRoot,
    workspaceRoot: roots.workspaceRoot,
    pluginRoot: roots.pluginRoot,
    manifest,
    toolMap: DEFAULT_TOOL_MAP,
    guardInfra: true,
  })
}

function buildParityCases(roots) {
  const ws = roots.workspaceRoot
  const plugin = roots.pluginRoot
  const cases = [
    ['main_session_write', { tool_name: 'Write', tool_input: { file_path: join(ws, 'notes.md') } }],
    ['main_session_write_escape', { tool_name: 'Write', tool_input: { file_path: join(roots.outside, 'x.md') } }],
    ['main_session_bash', { tool_name: 'Bash', tool_input: { command: 'ls' } }],
    ['bucket_a_in_scope', { tool_name: 'Write', tool_input: { file_path: join(ws, 'phase3_analysis', 'x.md') }, agent_type: 'synthesis_agent' }],
    ['bucket_a_out_of_scope', { tool_name: 'Write', tool_input: { file_path: join(ws, 'phase2_data', 'x.md') }, agent_type: 'synthesis_agent' }],
    ['bucket_a_bash', { tool_name: 'Bash', tool_input: { command: 'ls' }, agent_type: 'synthesis_agent' }],
    ['bucket_a_escape', { tool_name: 'Write', tool_input: { file_path: join(roots.outside, 'x.md') }, agent_type: 'synthesis_agent' }],
    [
      'bucket_a_traversal',
      {
        tool_name: 'Write',
        tool_input: { file_path: join(ws, 'phase3_analysis', '..', 'phase2_data', 'x.md') },
        agent_type: 'synthesis_agent',
      },
    ],
    ['bucket_a_phase_lookalike', { tool_name: 'Write', tool_input: { file_path: join(ws, 'phase3_x.md') }, agent_type: 'synthesis_agent' }],
    ['research_question_in_phase1', { tool_name: 'Write', tool_input: { file_path: join(ws, 'phase1_planning', 'x.md') }, agent_type: 'research_question_agent' }],
    ['research_question_out_of_phase', { tool_name: 'Write', tool_input: { file_path: join(ws, 'phase3_analysis', 'x.md') }, agent_type: 'research_question_agent' }],
    ['bibliography_in_phase2', { tool_name: 'Write', tool_input: { file_path: join(ws, 'phase2_data', 'x.md'), }, agent_type: 'bibliography_agent' }],
    ['draft_writer_phase6', { tool_name: 'Write', tool_input: { file_path: join(ws, 'phase6_revision', 'x.md') }, agent_type: 'draft_writer_agent' }],
    ['formatter_phase7', { tool_name: 'Write', tool_input: { file_path: join(ws, 'phase7_format', 'x.md') }, agent_type: 'formatter_agent' }],
    ['schema_drift', { tool_name: 'Write', tool_input: { content: 'no path' }, agent_type: 'synthesis_agent' }],
    ['schema_drift_null', { tool_name: 'Write', tool_input: null, agent_type: 'synthesis_agent' }],
    ['uninspected_tool', { tool_name: 'Read', tool_input: { file_path: join(plugin, 'hooks', 'hooks.json') } }],
    ['infra_hooks', { tool_name: 'Write', tool_input: { file_path: join(plugin, 'hooks', 'hooks.json') } }],
    ['infra_plugin_manifest', { tool_name: 'Write', tool_input: { file_path: join(plugin, '.claude-plugin', 'plugin.json') } }],
    ['infra_guard_script', { tool_name: 'Write', tool_input: { file_path: join(plugin, 'scripts', 'ars_write_scope_guard.py') } }],
    ['infra_phase_manifest', { tool_name: 'Write', tool_input: { file_path: join(plugin, 'scripts', 'ars_phase_scope_manifest.json') } }],
    ['infra_agent_definition', { tool_name: 'Write', tool_input: { file_path: join(plugin, 'deep-research', 'agents', 'synthesis_agent.md') } }],
    ['scoped_agent_namespace', { tool_name: 'Write', tool_input: { file_path: join(ws, 'phase3_analysis', 'x.md') }, agent_type: 'academic-research-skills:synthesis_agent' }],
    ['case_sensitive_agent', { tool_name: 'Write', tool_input: { file_path: join(ws, 'x.md') }, agent_type: 'Synthesis_Agent' }],
    ['schema_drift_main_session', { tool_name: 'Write', tool_input: {} }],
  ]
  if (roots.symlinkCreated) {
    cases.push([
      'bucket_a_symlink_escape',
      { tool_name: 'Write', tool_input: { file_path: join(ws, 'escape_link', 'x.md') }, agent_type: 'synthesis_agent' },
    ])
  }
  return cases.map(([label, payload]) => ({ label, payload: { ...payload, cwd: ws }, workspaceRoot: ws, pluginRoot: plugin }))
}

function makeParityRoots(tempRoot) {
  const workspaceRoot = join(tempRoot, 'ws')
  const pluginRoot = join(tempRoot, 'upstream-plugin')
  const outside = join(tempRoot, 'outside')
  const directories = [
    join(workspaceRoot, 'phase1_planning'),
    join(workspaceRoot, 'phase2_data'),
    join(workspaceRoot, 'phase3_analysis'),
    join(workspaceRoot, 'phase4_draft'),
    join(workspaceRoot, 'phase6_revision'),
    join(workspaceRoot, 'phase7_format'),
    join(pluginRoot, 'hooks'),
    join(pluginRoot, 'scripts'),
    join(pluginRoot, 'agents'),
    join(pluginRoot, 'deep-research', 'agents'),
    join(pluginRoot, '.claude-plugin'),
    outside,
  ]
  for (const directory of directories) mkdirSync(directory, { recursive: true })
  writeFileSync(join(pluginRoot, 'hooks', 'hooks.json'), '{}')
  writeFileSync(join(pluginRoot, 'hooks', 'run_guard.sh'), '#!/bin/sh\n')
  writeFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), '{}')
  writeFileSync(join(pluginRoot, 'scripts', 'ars_write_scope_guard.py'), '# fixture\n')
  writeFileSync(join(pluginRoot, 'scripts', 'ars_phase_scope_manifest.json'), '{}')
  writeFileSync(join(pluginRoot, 'agents', 'synthesis_agent.md'), '# mirror\n')
  writeFileSync(join(pluginRoot, 'deep-research', 'agents', 'synthesis_agent.md'), '# role\n')
  let symlinkCreated = false
  try {
    symlinkSync(outside, join(workspaceRoot, 'escape_link'))
    symlinkCreated = true
  } catch {
    symlinkCreated = false
  }
  return { workspaceRoot, pluginRoot, outside, symlinkCreated }
}

const PYTHON_PARITY_RUNNER = [
  'import importlib.util, json, sys',
  "spec = importlib.util.spec_from_file_location('ars_guard_reference', sys.argv[1])",
  'guard = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(guard)',
  'with open(sys.argv[2], encoding="utf-8") as handle: manifest = json.load(handle)',
  'with open(sys.argv[3], encoding="utf-8") as handle: cases = json.load(handle)',
  'out = []',
  'for case in cases:',
  '    decision = guard.evaluate_decision(case["payload"], manifest, case["workspaceRoot"], case["pluginRoot"])',
  '    out.append({',
  '        "decision": decision["decision"],',
  '        "reason": decision.get("reason", ""),',
  '        "flags": sorted(key for key in decision if key not in ("decision", "reason")),',
  '    })',
  'with open(sys.argv[4], "w", encoding="utf-8") as handle:',
  '    json.dump(out, handle)',
].join('\n')

function runPythonReference(guardPath, manifestPath, cases, tempRoot, label) {
  const casesPath = join(tempRoot, `parity-cases-${label}.json`)
  const outputPath = join(tempRoot, `parity-output-${label}.json`)
  const runnerPath = join(tempRoot, `parity-runner-${label}.py`)
  writeFileSync(casesPath, JSON.stringify(cases.map(({ payload, workspaceRoot, pluginRoot }) => ({ payload, workspaceRoot, pluginRoot }))))
  writeFileSync(runnerPath, PYTHON_PARITY_RUNNER)
  const run = spawnSync('python3', ['-B', runnerPath, guardPath, manifestPath, casesPath, outputPath], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: tempRoot,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  if (run.error) throw new Error(`python3 failed to start: ${run.error.message}`)
  if (run.status !== 0) throw new Error(`python3 reference exited ${run.status}: ${run.stderr.trim()}`)
  return JSON.parse(readFileSync(outputPath, 'utf8'))
}

let paritySummary = null

async function verifyGuardParity() {
  const guardPath = join(paths.scriptsRoot, 'ars_write_scope_guard.py')
  const manifestPath = join(paths.scriptsRoot, 'ars_phase_scope_manifest.json')
  const fixturePath = join(paths.scriptsRoot, 'fixtures', 'write_scope_guard', 'captured_payloads.json')

  const assetsOk = check('guard-parity', 'reference assets', () => {
    for (const [label, file] of [['guard script', guardPath], ['manifest', manifestPath], ['fixtures', fixturePath]]) {
      ensure(existsSync(file), `${label} missing: ${file}`)
    }
    const manifest = readJson(manifestPath, 'phase-scope manifest')
    equal(Object.keys(manifest.agents).length, 23, 'manifest agents')
    return `payload guard script + manifest (23 agents) + captured fixtures present`
  })
  if (!assetsOk) return

  const pythonReady = pythonVersion()
  if (!pythonReady) {
    warn('guard-parity', 'python3 reference', 'python3 not available; parity could not be established')
    return
  }

  const fixture = readJson(fixturePath, 'write-scope fixtures')
  const tempRoot = mkdtempSync(join(tmpdir(), 'ars-verify-guard-'))
  try {
    const roots = makeParityRoots(tempRoot)
    const manifest = readJson(manifestPath, 'phase-scope manifest')
    const recordedCases = fixture.cases.map((entry) => ({
      label: `captured:${entry.label}`,
      payload: substitutePlaceholders(entry.payload, roots),
      workspaceRoot: roots.workspaceRoot,
      pluginRoot: roots.pluginRoot,
      recorded: entry.expected_decision,
    }))
    const generatedCases = buildParityCases(roots)
    const allCases = [...recordedCases, ...generatedCases]

    const recordedOk = check('guard-parity', 'captured fixtures', () => {
      equal(recordedCases.length, 3, 'captured fixture count')
      for (const entry of recordedCases) {
        const decision = jsDecision(entry.payload, roots, manifest)
        equal(decision.decision, entry.recorded, `captured fixture ${entry.label}`)
      }
      return '3/3 captured Claude Code payloads produce the recorded decisions'
    })
    if (!recordedOk) return

    const reference = runPythonReference(guardPath, manifestPath, allCases, tempRoot, 'all')
    equal(reference.length, allCases.length, 'python reference result count')

    const mismatches = []
    for (let index = 0; index < allCases.length; index += 1) {
      const entry = allCases[index]
      const js = jsDecision(entry.payload, roots, manifest)
      const expected = reference[index]
      const jsDecisionValue = js.decision
      if (jsDecisionValue !== expected.decision) {
        mismatches.push(`${entry.label}: JS=${jsDecisionValue} PY=${expected.decision}`)
        continue
      }
      const jsFlags = flagList(js)
      if (JSON.stringify(jsFlags) !== JSON.stringify(expected.flags)) {
        mismatches.push(`${entry.label}: flags JS=${JSON.stringify(jsFlags)} PY=${JSON.stringify(expected.flags)}`)
      }
    }
    equal(mismatches.length, 0, `guard parity mismatches: ${mismatches.join('; ')}`)
    record('guard-parity', 'upstream decision parity', 'PASS',
      `${allCases.length}/${allCases.length} decisions + advisory flags match payload/scripts/ars_write_scope_guard.py ` +
        `(captured fixtures ${recordedCases.length}, generated ${generatedCases.length})`)
    paritySummary = { matched: allCases.length, total: allCases.length }

    const mappingCases = [
      ['write', 'write', { tool_name: 'Write', tool_input: { file_path: join(roots.workspaceRoot, 'phase3_analysis', 'x.md') }, agent_type: 'synthesis_agent' }],
      ['edit', 'edit', { tool_name: 'Edit', tool_input: { file_path: join(roots.pluginRoot, 'hooks', 'hooks.json') } }],
      ['bash', 'bash', { tool_name: 'Bash', tool_input: { command: 'ls' }, agent_type: 'synthesis_agent' }],
    ]
    check('guard-parity', 'DSH tool-name mapping', () => {
      for (const [name, jsName, payload] of mappingCases) {
        const canonical = jsDecision(payload, roots, manifest)
        const mapped = evaluateDecision({
          toolName: jsName,
          toolInput: payload.tool_input,
          agentType: payload.agent_type,
          cwd: roots.workspaceRoot,
          workspaceRoot: roots.workspaceRoot,
          pluginRoot: roots.pluginRoot,
          manifest,
          toolMap: DEFAULT_TOOL_MAP,
          guardInfra: true,
        })
        equal(mapped.decision, canonical.decision, `${name} mapping decision`)
        deepEqual(flagList(mapped), flagList(canonical), `${name} mapping flags`)
      }
      return 'write→Write, edit→Edit, bash→Bash preserve the canonical decision and flags'
    })

    check('guard-parity', 'plugin infrastructure extension', () => {
      const pluginTargets = [
        join(PLUGIN_ROOT, 'index.js'),
        join(PLUGIN_ROOT, 'lib', 'guard.js'),
        join(PLUGIN_ROOT, 'bin', 'ars-python'),
        join(PLUGIN_ROOT, 'cordis.patch.yml'),
        join(PLUGIN_ROOT, 'package.json'),
      ]
      for (const target of pluginTargets) {
        const decision = evaluateDecision({
          toolName: 'write',
          toolInput: { file_path: target },
          workspaceRoot: roots.workspaceRoot,
          pluginRoot: PLUGIN_ROOT,
          manifest,
        })
        equal(decision.decision, 'deny', `plugin wiring target must be denied: ${target}`)
      }
      return 'index.js/lib/**.js/bin/**/cordis.patch.yml/package.json denied (intentional superset of upstream enforcement globs)'
    })
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

/* -------------------------------------------------------------------------- */
/* Payload rows                                                               */
/* -------------------------------------------------------------------------- */

function verifyPayload() {
  const deep = verifyPayloadChecks({
    payloadRoot: PAYLOAD_ROOT,
    corpus: { commands: COMMAND_NAMES, agents: AGENT_FILES },
  })
  for (const row of deep.checks) record('payload', row.name, row.ok ? 'PASS' : 'FAIL', row.detail)
  return deep.summary
}

/* -------------------------------------------------------------------------- */
/* Upstream clone parity (optional)                                           */
/* -------------------------------------------------------------------------- */

function verifyUpstreamParity() {
  if (!existsSync(join(UPSTREAM_ROOT, '.git'))) {
    skip('upstream', 'clone parity', `upstream clone not available at ${UPSTREAM_ROOT}`)
    return
  }
  check('upstream', 'pinned commit', () => {
    const head = spawnSync('git', ['-C', UPSTREAM_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 15000 })
    ensure(!head.error && head.status === 0, `git rev-parse failed: ${head.stderr ?? head.error?.message}`)
    equal(head.stdout.trim(), UPSTREAM.commit, 'upstream HEAD')
    return `git HEAD = ${UPSTREAM.commit.slice(0, 12)}`
  })
  check('upstream', 'upstream plugin manifest', () => {
    const upstreamManifest = readJson(join(UPSTREAM_ROOT, '.claude-plugin', 'plugin.json'), 'upstream plugin.json')
    equal(upstreamManifest.name, 'academic-research-skills', 'upstream plugin name')
    equal(upstreamManifest.version, UPSTREAM.pluginVersion, 'upstream plugin version')
    equal(upstreamManifest.license, UPSTREAM.license, 'upstream license')
    return `${upstreamManifest.name}@${upstreamManifest.version} (${upstreamManifest.license})`
  })
  check('upstream', 'registered documents are byte-identical', () => {
    const documents = [
      ...SKILL_NAMES.map((skill) => `${skill}/SKILL.md`),
      ...COMMAND_NAMES.map((name) => `commands/${name}.md`),
      ...AGENT_FILES.map((file) => `agents/${file}`),
    ]
    const differences = []
    for (const document of documents) {
      const payloadBytes = readFileSync(join(PAYLOAD_ROOT, document))
      const upstreamBytes = readFileSync(join(UPSTREAM_ROOT, document))
      if (!payloadBytes.equals(upstreamBytes)) differences.push(document)
    }
    equal(differences.length, 0, `byte differences: ${differences.join(', ')}`)
    return `${documents.length}/${documents.length} registered documents byte-identical to the clone`
  })
  check('upstream', 'entire payload is byte-identical to the clone', () => {
    const payload = payloadInventory()
    const differences = []
    for (const file of payload.files) {
      const upstream = join(UPSTREAM_ROOT, file.path)
      if (!existsSync(upstream)) {
        differences.push(`${file.path}: missing upstream`)
        continue
      }
      const bytes = readFileSync(upstream)
      if (bytes.length !== file.bytes || sha256Buffer(bytes) !== file.sha256) differences.push(`${file.path}: bytes`)
      if ((statSync(upstream).mode & 0o777) !== file.mode) differences.push(`${file.path}: mode`)
    }
    equal(differences.length, 0, `first differences: ${differences.slice(0, 10).join(', ')}`)
    return `${payload.files.length}/${payload.files.length} payload files byte- and mode-identical to the clone`
  })
  check('upstream', 'guard and fixtures are byte-identical', () => {
    const files = [
      'scripts/ars_write_scope_guard.py',
      'scripts/ars_phase_scope_manifest.json',
      'scripts/fixtures/write_scope_guard/captured_payloads.json',
    ]
    for (const file of files) {
      ensure(readFileSync(join(PAYLOAD_ROOT, file)).equals(readFileSync(join(UPSTREAM_ROOT, file))), `${file} differs from upstream`)
    }
    return 'guard script, manifest, and captured fixtures match upstream'
  })
}

/* -------------------------------------------------------------------------- */
/* Limitations (honest, non-blocking)                                         */
/* -------------------------------------------------------------------------- */

function verifyLimitations() {
  warn('limitations', 'guard phase fence needs a known ARS role',
    'DSH tool executions expose no agent_type; the role registry starts empty, so phase fencing is inactive by default (infra protection still applies)')

  const wrapper = join(PLUGIN_ROOT, 'bin', 'ars-python')
  const versionGate = spawnSync(wrapper, ['-B', join(paths.scriptsRoot, 'check_version_consistency.py')], {
    encoding: 'utf8',
    timeout: 60000,
    cwd: paths.payloadRoot,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  const firstLine = `${versionGate.stdout || versionGate.stderr || ''}`.trim().split('\n').find((line) => line.length > 0) ?? ''
  warn('limitations', 'upstream repo-only maintenance gates',
    `check_version_consistency.py exits ${versionGate.status} from the payload because it expects .claude/CLAUDE.md, which the payload intentionally excludes (${firstLine})`)

  warn('limitations', 'sr-screener generated workflow script format',
    'build_workflow.py emits Claude-Code-oriented scripts; the registration note routes DSH runs to --emit-prompts + one subagent call per prompt until the generator is validated on DSH')
}

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

function summarize() {
  const counts = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 }
  for (const result of results) counts[result.status] += 1
  return counts
}

function printReport(context) {
  const lines = []
  lines.push('ARS DSH install verification (read-only)')
  lines.push(`  plugin     : ${PLUGIN_ROOT}`)
  lines.push(`  payload    : ${PAYLOAD_ROOT}`)
  lines.push(`  upstream   : ${existsSync(UPSTREAM_ROOT) ? UPSTREAM_ROOT : '(not available)'}`)

  let currentSection = null
  for (const result of results) {
    if (result.section !== currentSection) {
      currentSection = result.section
      lines.push('')
      lines.push(`[${currentSection}]`)
    }
    const status = result.status.padEnd(4)
    lines.push(`  ${status} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
  }

  const counts = summarize()
  lines.push('')
  if (context.payload !== undefined) {
    lines.push(
      `payload statistics: ${context.payload.files} files, ${formatBytes(context.payload.bytes)}, ` +
        `${context.payload.directories} dirs; commit ${context.payload.commit.slice(0, 12)} ` +
        `(${context.payload.pluginVersion}); generated ${context.payload.generatedAt}`,
    )
    lines.push(
      `reference index   : ${context.payload.references} references, ${context.payload.resolved} resolved, ` +
        `${context.payload.missing} unresolved`,
    )
  }
  if (context.parity !== undefined) {
    lines.push(`guard parity      : ${context.parity.matched}/${context.parity.total} decisions + advisory flags match the Python reference`)
  }
  lines.push('')
  lines.push(`summary: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.WARN} WARN, ${counts.SKIP} SKIP`)
  lines.push(counts.FAIL === 0 ? 'RESULT: PASS' : 'RESULT: FAIL')
  process.stdout.write(`${lines.join('\n')}\n`)
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      'Usage: node tools/verify-install.mjs [--json]\n\n' +
        'Read-only verification of the Academic Research Skills DSH port:\n' +
        'package, registration, tool schemas, guard parity vs the upstream Python\n' +
        'reference, payload provenance/digests, and optional live-profile/upstream checks.\n',
    )
    return { ok: true, help: true }
  }

  const environment = await verifyEnvironment()
  verifyPackage()
  await verifyRegistration(environment)
  await verifyGuardParity()
  const payload = verifyPayload()
  verifyUpstreamParity()
  verifyLimitations()

  const counts = summarize()
  const ok = counts.FAIL === 0
  if (argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok,
          counts,
          results,
          payload,
          pythonReady: environment.pythonReady,
          pluginRoot: PLUGIN_ROOT,
          payloadRoot: PAYLOAD_ROOT,
        },
        null,
        2,
      )}\n`,
    )
  } else {
    printReport({ payload, parity: paritySummary })
  }
  if (!ok) process.exitCode = 1
  return { ok, counts, results }
}

function isEntrypoint() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntrypoint()) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`verify-install failed: ${error instanceof Error ? error.message : String(error)}\n`)
    if (process.env.ARS_DEBUG === '1' && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`)
    process.exitCode = 1
  })
}
