/**
 * Registration-surface tests for the DeepSeek Harness Academic Research Skills
 * port (independent verifier suite).
 *
 * These tests exercise the REAL modules (`lib/skills.js`, `lib/agents.js`,
 * `lib/commands.js`) against the REAL bundled payload. Only the DeepSeek
 * Harness context is faked: the skill/command registries, the effect scope, and
 * the logger are tiny in-memory stand-ins with the documented DSH contracts
 * (`ctx.effect(factory)` returns the factory's disposer;
 * `ctx.skills.register(definition)` returns a disposer;
 * `ctx.commands.register(definition)` returns a disposer).
 *
 * Command dispatch is tested through the exact public handler shape DSH's
 * `CommandInvocation` exposes: `{ rawInput, agent: { followup(message) } }`.
 * The asserted `followup` message shape is the one DSH's `createUserMessage`
 * produces: `{ id, role: 'user', content: [{ type: 'text', text }],
 * source: { kind: 'user' } }`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPaths } from '../lib/paths.js'
import { normalizeConfig } from '../lib/config.js'
import { createAdapter } from '../lib/adapt.js'
import { createHost } from './support/host.mjs'
import { COMMAND_FALLBACK_NAMES } from '../lib/inventory.js'
import { SKILL_NAMES, registerSkills } from '../lib/skills.js'
import { AGENT_SKILLS, registerAgentSkills } from '../lib/agents.js'
import { listCommandFiles, readCommand, registerCommands } from '../lib/commands.js'

/* -------------------------------------------------------------------------- */
/* Real payload + adapter                                                     */
/* -------------------------------------------------------------------------- */

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..')
const paths = createPaths(PLUGIN_ROOT)
const adapter = createAdapter({ paths })
const config = normalizeConfig({ envDir: join(PLUGIN_ROOT, '.test-venv') }, { home: PLUGIN_ROOT })

const EXPECTED_SKILLS = SKILL_NAMES
const EXPECTED_AGENT_SKILLS = AGENT_SKILLS.map((entry) => entry.skill)
const EXPECTED_COMMANDS = COMMAND_FALLBACK_NAMES

/** Commands whose upstream body carries a `$ARGUMENTS` placeholder. */
const PLACEHOLDER_COMMANDS = ['ars-cache-invalidate', 'ars-mark-read', 'ars-unmark-read']

/** Tokens that must never survive adaptation (mirrors `lib/adapt.js` lint). */
const RESIDUAL_TOKENS = [
  '${CLAUDE_PLUGIN_ROOT}',
  'academic-research-skills:',
  'Skill tool',
  'subagent_type',
  'python3 scripts/',
  'python scripts/',
]

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/* -------------------------------------------------------------------------- */
/* Fake DSH context                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Minimal DSH host stand-in. Every registry returns a disposer, and every
 * `ctx.effect(factory)` runs the factory immediately and records its disposer,
 * matching Cordis effect-scope semantics closely enough to test ownership.
 */

/** Register every Markdown surface once and return the shared warning sink. */
function registerSurface(host) {
  const warnings = []
  const logger = host.ctx.logger
  registerSkills(host.ctx, { paths, adapter, logger, warnings })
  registerAgentSkills(host.ctx, { paths, adapter, logger, warnings })
  const commands = registerCommands(host.ctx, { paths, adapter, logger, warnings })
  return { commands, warnings }
}

function assertNoResiduals(text, label) {
  assert.deepEqual(adapter.lint(text), [], `${label} must be lint-clean`)
  for (const token of RESIDUAL_TOKENS) {
    assert.ok(!text.includes(token), `${label} must not contain ${token}`)
  }
}

function upstreamCommandRecords() {
  return new Map(
    listCommandFiles(paths).map((file) => {
      const record = readCommand({ paths, adapter }, file)
      return [record.name, record]
    }),
  )
}

/**
 * Call one registered command handler with the documented CommandInvocation
 * shape and collect every message passed to `agent.followup`.
 */
async function dispatch(handler, rawInput, agent) {
  const messages = []
  const invocation = {
    commandId: 'verify-command-1',
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
    agent: agent ?? {
      followup(message) {
        messages.push(message)
      },
    },
  }
  const result = await handler(invocation)
  return { result, messages }
}

/* -------------------------------------------------------------------------- */
/* Registration inventory                                                     */
/* -------------------------------------------------------------------------- */

test('registers exactly 5 skills, 4 agent-role skills, and 16 commands inside effect scopes', () => {
  const host = createHost()
  const { commands, warnings } = registerSurface(host)

  assert.deepEqual([...host.state.skills.keys()], [...EXPECTED_SKILLS, ...EXPECTED_AGENT_SKILLS])
  // Registration order is the upstream command-file order (localeCompare), which
  // differs from ASCII order for `ars-revision` / `ars-revision-coach`.
  const upstreamOrder = listCommandFiles(paths).map((file) => file.split('/').pop().slice(0, -3))
  assert.deepEqual([...host.state.commands.keys()], upstreamOrder)
  assert.deepEqual(commands.registered, upstreamOrder)
  assert.deepEqual([...EXPECTED_COMMANDS].sort(), [...host.state.commands.keys()].sort())
  assert.equal(host.state.effects.length, 5 + 4 + 16, 'one ctx.effect per registration')
  for (const disposer of host.state.effects) assert.equal(typeof disposer, 'function')
  assert.deepEqual(warnings, [], 'registration must not log compatibility warnings')
})

test('the payload root and every registered directory exist on disk', () => {
  assert.ok(existsSync(paths.payloadRoot), `payload root missing: ${paths.payloadRoot}`)
  assert.ok(statSync(paths.payloadRoot).isDirectory())
  for (const skill of EXPECTED_SKILLS) {
    assert.ok(existsSync(join(paths.payloadRoot, skill, 'SKILL.md')), `${skill}/SKILL.md missing`)
  }
  for (const agent of ['synthesis_agent', 'research_architect_agent', 'report_compiler_agent', 'screening_reviewer_agent']) {
    assert.ok(existsSync(join(paths.agentsRoot, `${agent}.md`)), `agents/${agent}.md missing`)
  }
})

/* -------------------------------------------------------------------------- */
/* Skill definitions                                                          */
/* -------------------------------------------------------------------------- */

test('all five research skills are complete, payload-rooted, and lint-clean', () => {
  const host = createHost()
  registerSurface(host)

  for (const skill of EXPECTED_SKILLS) {
    const definition = host.state.skills.get(skill)
    assert.ok(definition, `${skill} was not registered`)
    assert.equal(definition.name, skill)
    assert.equal(typeof definition.description, 'string')
    assert.ok(definition.description.trim().length > 0, `${skill}: description must not be empty`)
    assert.equal(definition.source, 'bundled')
    assert.equal(definition.path, join(paths.payloadRoot, skill, 'SKILL.md'))
    assert.ok(existsSync(definition.path), `${skill}: payload path must exist`)

    assert.equal(definition.resourceBase.kind, 'directory')
    assert.equal(definition.resourceBase.path, join(paths.payloadRoot, skill))
    assert.ok(statSync(definition.resourceBase.path).isDirectory(), `${skill}: resourceBase must be a directory`)

    assert.deepEqual(definition.invocation, { modelInvocable: true, userInvocable: true })

    assert.ok(definition.content.length > 5000, `${skill}: adapted body is unexpectedly short`)
    if (skill === 'sr-screener') {
      // sr-screener prepends the workflow-compatibility note before the prelude.
      assert.ok(definition.content.includes('## DeepSeek Harness compatibility layer'), `${skill}: prelude present`)
    } else {
      assert.ok(definition.content.startsWith('## DeepSeek Harness compatibility layer'), `${skill}: prelude first`)
    }
    assert.ok(definition.content.includes(paths.payloadRoot), `${skill}: payload root must appear`)
    assertNoResiduals(definition.content, `skill ${skill}`)

    assert.equal(typeof definition.metadata, 'object')
    assert.match(definition.metadata.version, /^\d+\.\d+\.\d+$/u, `${skill}: metadata.version`)
    assert.ok(Array.isArray(definition.metadata.related_skills), `${skill}: metadata.related_skills`)
    assert.ok(definition.metadata.related_skills.length > 0)
  }
})

test('sr-screener carries the registration-time workflow override note first', () => {
  const host = createHost()
  registerSurface(host)
  const definition = host.state.skills.get('sr-screener')
  const note = '> **DeepSeek Harness workflow compatibility note (sr-screener).**'

  assert.ok(definition.content.startsWith(note), 'the conflict note must precede the adapted upstream body')
  assert.ok(definition.content.includes('do **not** pass the generated script to `workflow`'))
  assert.ok(definition.content.includes('`subagent`'))
  assert.ok(definition.content.includes('--emit-prompts'))
  assert.ok(
    definition.content.indexOf(note) < definition.content.indexOf('## DeepSeek Harness compatibility layer'),
    'note precedes the compatibility prelude',
  )
  const nonScreener = host.state.skills.get('deep-research')
  assert.ok(!nonScreener.content.includes(note), 'other skills must not carry the sr-screener note')
})

test('the four agent-role skills resolve bare references against their mirror skill directory', () => {
  const host = createHost()
  registerSurface(host)

  const expected = [
    ['ars-agent-synthesis', 'synthesis_agent', 'deep-research'],
    ['ars-agent-research-architect', 'research_architect_agent', 'deep-research'],
    ['ars-agent-report-compiler', 'report_compiler_agent', 'deep-research'],
    ['ars-agent-screening-reviewer', 'screening_reviewer_agent', 'sr-screener'],
  ]

  for (const [name, agentType, mirror] of expected) {
    const definition = host.state.skills.get(name)
    assert.ok(definition, `${name} was not registered`)
    assert.equal(definition.name, name)
    assert.ok(definition.description.includes(agentType), `${name}: description names the agent type`)
    assert.ok(definition.description.includes('pass its instructions to the subagent tool'), `${name}: dispatch guidance`)

    assert.deepEqual(definition.invocation, { modelInvocable: true, userInvocable: false })
    assert.equal(definition.metadata.arsAgentType, agentType)
    assert.equal(definition.metadata.arsMirrorSkill, mirror)
    assert.equal(definition.metadata.arsUpstreamFile, `agents/${agentType}.md`)
    assert.equal(typeof definition.metadata.arsTools, 'string')
    assert.ok(definition.metadata.arsTools.length > 0, `${name}: upstream tools allowlist preserved`)

    const mirrorDirectory = join(paths.payloadRoot, mirror)
    assert.equal(definition.resourceBase.kind, 'directory')
    assert.equal(definition.resourceBase.path, mirrorDirectory)
    assert.ok(statSync(mirrorDirectory).isDirectory())
    assert.ok(definition.content.includes(`Skill directory: \`${mirrorDirectory}\`.`), `${name}: mirror directory stated`)
    assert.ok(definition.content.includes('Agent role:'), `${name}: agent prelude`)
    assertNoResiduals(definition.content, `agent skill ${name}`)
  }
})

/* -------------------------------------------------------------------------- */
/* Command definitions                                                        */
/* -------------------------------------------------------------------------- */

test('all sixteen commands preserve upstream metadata and hints', () => {
  const host = createHost()
  registerSurface(host)
  const records = upstreamCommandRecords()

  assert.equal(records.size, 16)
  assert.deepEqual([...records.keys()].sort(), [...EXPECTED_COMMANDS].sort())
  assert.deepEqual([...host.state.commands.keys()], listCommandFiles(paths).map((file) => file.split('/').pop().slice(0, -3)))

  for (const [name, definition] of host.state.commands) {
    const record = records.get(name)
    assert.ok(record, `${name}: upstream command record exists`)
    assert.equal(definition.name, name)
    assert.match(name, /^[a-z][a-z0-9_-]*$/u, 'DSH command-name grammar')
    assert.ok(definition.description.trim().length > 0, `${name}: description must not be empty`)
    assert.deepEqual(definition.input, { hint: record.hint })
    assert.ok(definition.input.hint.trim().length > 0, `${name}: input hint must not be empty`)
    assert.equal(typeof definition.handler, 'function')

    const hasPlaceholder = record.body.includes('$ARGUMENTS') || record.body.includes('${ARGUMENTS}')
    assert.equal(hasPlaceholder, PLACEHOLDER_COMMANDS.includes(name), `${name}: placeholder inventory`)
    assert.equal(record.disableModelInvocation, !PLACEHOLDER_COMMANDS.includes(name), `${name}: upstream invocation flag`)
  }

  assert.equal(host.state.commands.get('ars-3w').input.hint, '[request]')
  assert.equal(host.state.commands.get('ars-mark-read').input.hint, '[arguments]')
  assert.equal(host.state.commands.get('ars-3w').handler.length, 1)
})

/* -------------------------------------------------------------------------- */
/* Command dispatch                                                           */
/* -------------------------------------------------------------------------- */

test('every command handler dispatches one well-formed user message with the raw input', async () => {
  const host = createHost()
  registerSurface(host)
  const records = upstreamCommandRecords()
  const rawInput = 'probe input'

  for (const [name, definition] of host.state.commands) {
    const { result, messages } = await dispatch(definition.handler, rawInput)
    assert.equal(result.kind, 'success', `${name}: dispatch result kind`)
    assert.equal(typeof result.text, 'string')
    assert.ok(result.text.includes(`/${name}`), `${name}: result names the command`)

    assert.equal(messages.length, 1, `${name}: exactly one followup message`)
    const message = messages[0]
    assert.equal(typeof message.id, 'string')
    assert.match(message.id, UUID_V4, `${name}: fresh UUID identity`)
    assert.equal(message.role, 'user')
    assert.deepEqual(message.source, { kind: 'user' })
    assert.ok(Array.isArray(message.content))
    assert.equal(message.content.length, 1)
    assert.equal(message.content[0].type, 'text')
    assert.equal(typeof message.content[0].text, 'string')

    const text = message.content[0].text
    assert.ok(text.length > 100, `${name}: the adapted prompt is not empty`)
    assert.ok(text.includes(paths.payloadRoot), `${name}: absolute payload root`)
    assert.ok(text.includes(rawInput), `${name}: raw input must survive dispatch`)
    assertNoResiduals(text, `command ${name} dispatch`)

    const placeholder = PLACEHOLDER_COMMANDS.includes(name)
    const record = records.get(name)
    assert.equal(record.body.includes('$ARGUMENTS'), placeholder)
    if (placeholder) {
      assert.ok(!text.includes('$ARGUMENTS'), `${name}: placeholder must be substituted away`)
      assert.ok(!text.includes('## User request (raw input)'), `${name}: placeholder form adds no request section`)
    } else {
      assert.ok(text.includes('## User request (raw input)'), `${name}: raw input is appended`)
    }
  }
})

test('raw input is inserted literally and empty input degrades explicitly', async () => {
  const host = createHost()
  registerSurface(host)

  const tricky = 'a$&b $1 ${ARGUMENTS} c\\d'
  const markRead = await dispatch(host.state.commands.get('ars-mark-read').handler, tricky)
  assert.equal(markRead.result.kind, 'success')
  assert.ok(markRead.messages[0].content[0].text.includes(tricky), 'replacement text is literal')

  const threeW = await dispatch(host.state.commands.get('ars-3w').handler, '')
  assert.ok(
    threeW.messages[0].content[0].text.includes('_No additional input was provided._'),
    'no-placeholder command states that input was empty',
  )

  const cache = await dispatch(host.state.commands.get('ars-cache-invalidate').handler, '')
  assert.ok(!cache.messages[0].content[0].text.includes('$ARGUMENTS'), 'placeholder is still removed for empty input')
})

test('handler failures return kind:error without throwing into the host', async () => {
  const host = createHost()
  registerSurface(host)
  const handler = host.state.commands.get('ars-3w').handler

  const missingFollowup = await handler({
    rawInput: 'x',
    attachments: [],
    signal: new AbortController().signal,
    agent: {},
  })
  assert.equal(missingFollowup.kind, 'error')
  assert.match(missingFollowup.text, /could not be dispatched/u)

  const throwingFollowup = await handler({
    rawInput: 'x',
    attachments: [],
    signal: new AbortController().signal,
    agent: {
      followup() {
        throw new Error('host followup unavailable')
      },
    },
  })
  assert.equal(throwingFollowup.kind, 'error')
  assert.match(throwingFollowup.text, /host followup unavailable/u)
})

/* -------------------------------------------------------------------------- */
/* Effect ownership                                                           */
/* -------------------------------------------------------------------------- */

test('every registration is owned by a disposer that unregisters it', () => {
  const host = createHost()
  registerSurface(host)
  assert.equal(host.state.effects.length, 25)

  for (const dispose of host.state.effects) dispose()
  assert.equal(host.state.skills.size, 0, 'skills unregistered')
  assert.equal(host.state.commands.size, 0, 'commands unregistered')
})
