/**
 * Inventory + reference-policy tests.
 *
 * The inventory is the single owner of the ARS surface lists. These tests pin
 * the payload-derived counts and mirrors once, then verify that the runtime
 * modules re-export the same owners instead of carrying private copies.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPaths } from '../lib/paths.js'
import { loadInventory } from '../index.js'
import { createRegistrationReport } from '../lib/registration.js'
import {
  AGENT_ROLE_SPECS,
  SKILL_NAMES,
  createInventory,
  readCommandEntry,
} from '../lib/inventory.js'
import { createReferencePolicy } from '../lib/reference-policy.js'
import { classifyReference, resolveScriptPath } from '../lib/reference-rules.js'
import * as skills from '../lib/skills.js'
import * as agents from '../lib/agents.js'
import * as status from '../lib/status.js'
import * as adapt from '../lib/adapt.js'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(here, '..')
const paths = createPaths(pluginRoot)
const inventory = createInventory({ paths })

test('inventory derives exactly 5 skills, 16 commands, and 4 mirrored agent roles', () => {
  assert.equal(inventory.skills.length, 5)
  assert.equal(inventory.commands.length, 16)
  assert.equal(inventory.agentRoles.length, 4)
  assert.deepEqual(inventory.skillNames, [...SKILL_NAMES])
  assert.deepEqual(inventory.agentRoleNames, AGENT_ROLE_SPECS.map((entry) => entry.skill))
  assert.deepEqual(inventory.errors, [])

  for (const role of inventory.agentRoles) {
    assert.equal(typeof role.mirror, 'string')
    assert.ok(role.mirror.length > 0, `${role.agentType} has a derived mirror`)
    assert.ok(role.file.endsWith(`/${role.agentType}.md`))
  }
})

test('non-strict inventory degrades one malformed skill instead of throwing', () => {
  const root = mkdtempSync(join(tmpdir(), 'ars-inventory-degrade-'))
  const tempPaths = createPaths(root)
  for (const skill of SKILL_NAMES) {
    const frontmatter = skill === 'academic-paper'
      ? '---\nnot a pair\n---\nbody\n'
      : `---\nname: ${skill}\ndescription: ${skill}\n---\nbody\n`
    mkdirSync(join(tempPaths.payloadRoot, skill), { recursive: true })
    writeFileSync(join(tempPaths.payloadRoot, skill, 'SKILL.md'), frontmatter)
  }
  mkdirSync(tempPaths.commandsRoot, { recursive: true })
  mkdirSync(tempPaths.agentsRoot, { recursive: true })

  assert.throws(() => createInventory({ paths: tempPaths }), /frontmatter/u)
  const degraded = createInventory({ paths: tempPaths, strict: false })
  assert.deepEqual(
    degraded.skills.map((entry) => entry.name),
    SKILL_NAMES.filter((skill) => skill !== 'academic-paper'),
  )
  assert.ok(
    degraded.errors.some((issue) => issue.kind === 'skill' && issue.name === 'academic-paper'),
    'the malformed skill is reported, not silently dropped',
  )

  const report = createRegistrationReport()
  const warnings = []
  const mounted = loadInventory({
    paths: tempPaths,
    logger: { warn: (message) => warnings.push(message) },
    report,
  })
  assert.deepEqual(
    mounted.skills.map((entry) => entry.name),
    SKILL_NAMES.filter((skill) => skill !== 'academic-paper'),
  )
  assert.ok(report.warnings.some((message) => message.includes('inventory degraded')))
  assert.ok(warnings.some((message) => message.includes('academic-paper')))
})

test('the runtime modules re-export the one inventory list, not private copies', () => {
  assert.equal(skills.SKILL_NAMES, SKILL_NAMES)
  assert.equal(adapt.SKILL_NAMES, SKILL_NAMES)
  assert.equal(status.EXPECTED_SKILLS, SKILL_NAMES)
  assert.equal(agents.AGENT_SKILLS.length, 4)
  assert.equal(status.EXPECTED_COMMANDS.length, 16)
})

test('every discovered command validates through the shared command reader', () => {
  for (const command of inventory.commands) {
    const again = readCommandEntry(paths, command.file)
    assert.equal(again.name, command.name)
    assert.ok(again.description.length > 0)
  }
})

test('reference rules keep skill-local, payload-root, and sr-screener scripts distinct', () => {
  assert.equal(classifyReference('references/foo.md', { skill: 'deep-research' }).scope, 'skill')
  assert.equal(classifyReference('agents/foo.md', { skill: 'deep-research' }).scope, 'skill')
  assert.equal(classifyReference('shared/policy.md', { skill: 'deep-research' }).scope, 'payload')
  assert.equal(classifyReference('MODE_REGISTRY.md', { skill: 'deep-research' }).scope, 'payload')
  assert.equal(classifyReference('scripts/check.py', { skill: 'deep-research' }).scope, 'payload')
  assert.equal(classifyReference('scripts/check.py', { skill: 'sr-screener' }).scope, 'skill')
  assert.equal(classifyReference('sr-screener/scripts/check.py', { skill: 'sr-screener' }).scope, 'payload')

  assert.equal(
    resolveScriptPath('scripts/check.py', { skill: 'sr-screener', payloadRoot: paths.payloadRoot }),
    join(paths.payloadRoot, 'sr-screener', 'scripts', 'check.py'),
  )
  assert.equal(
    resolveScriptPath('scripts/check.py', { skill: 'deep-research', payloadRoot: paths.payloadRoot }),
    join(paths.payloadRoot, 'scripts', 'check.py'),
  )
})

test('reference policy binds the rules to one payload layout and inventory', () => {
  const policy = createReferencePolicy({ paths, inventory })
  assert.equal(policy.wrapperPath, join(pluginRoot, 'bin', 'ars-python'))
  assert.equal(policy.phaseManifest, join(paths.scriptsRoot, 'ars_phase_scope_manifest.json'))
  assert.equal(policy.skillFile('deep-research'), join(paths.payloadRoot, 'deep-research', 'SKILL.md'))
  assert.equal(policy.agentMirror('screening_reviewer_agent'), 'sr-screener')
  assert.equal(
    policy.resolveReference('references/foo.md', { skill: 'deep-research' }),
    join(paths.payloadRoot, 'deep-research', 'references', 'foo.md'),
  )
  const conventions = policy.conventionsText('sr-screener').join('\n')
  assert.match(conventions, /sr-screener/)
  assert.match(conventions, /scripts\//)
})


test('runtime reference policy agrees with the build-time REFERENCE-INDEX for skill documents', () => {
  const policy = createReferencePolicy({ paths, inventory })
  const index = JSON.parse(readFileSync(paths.referenceIndexPath, 'utf8'))
  let checked = 0
  for (const entry of index.entries) {
    const skill = SKILL_NAMES.find((name) => entry.file.startsWith(`${name}/`))
    if (skill === undefined) continue
    if (entry.convention !== 'own-skill-relative' && entry.convention !== 'payload-root-relative') continue
    const runtimePath = policy.resolveReference(entry.raw, { skill })
    if (runtimePath === null) continue
    const builtPath = join(paths.payloadRoot, ...entry.resolved.split('/'))
    assert.equal(
      normalize(runtimePath),
      normalize(builtPath),
      `${entry.file}:${entry.line} ${entry.raw} resolves to the same payload file in runtime and build`,
    )
    checked += 1
  }
  assert.ok(checked > 100, `checked enough references (${checked})`)
})
