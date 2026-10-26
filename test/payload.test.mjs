/**
 * Payload-integrity tests (independent verifier suite).
 *
 * The payload is the byte-preserving upstream snapshot that every skill,
 * command, agent role, and Python gate executes from. These tests recompute the
 * advertised inventory and digests from the filesystem instead of trusting
 * `payload/PROVENANCE.json`, then cross-check `REFERENCE-INDEX.json` against the
 * real tree.
 *
 * The digest formulas are the documented ones from
 * `tools/build-payload.mjs`:
 *   - `pathListSha256` = SHA-256 of `<path>\n` rows in bytewise path order;
 *   - `contentSha256`  = SHA-256 of `<path>\0<file sha256>\0<octal mode>\n` rows.
 *
 * The two generated metadata files (`PROVENANCE.json`, `REFERENCE-INDEX.json`)
 * are excluded from the upstream inventory, exactly like the checker.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  GENERATED_FILES,
  INCLUDED_DIRECTORIES,
  INCLUDED_FILES,
  PAYLOAD_SNAPSHOT,
  REFERENCE_INDEX as INDEX,
  SCHEMA_VERSION,
  SKILL_NAMES,
  TOOL_NAME,
  TOOL_VERSION,
  UPSTREAM,
} from '../lib/payload-contract.js'

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..')
const PAYLOAD_ROOT = join(PLUGIN_ROOT, 'payload')
const UPSTREAM_ROOT = resolve(PLUGIN_ROOT, '..', 'repo')

const COMMAND_NAMES = Object.freeze([
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
])

const AGENT_FILES = Object.freeze([
  'research_architect_agent.md',
  'report_compiler_agent.md',
  'screening_reviewer_agent.md',
  'synthesis_agent.md',
])

const AGENT_MIRRORS = Object.freeze([
  ['synthesis_agent.md', 'deep-research'],
  ['research_architect_agent.md', 'deep-research'],
  ['report_compiler_agent.md', 'deep-research'],
  ['screening_reviewer_agent.md', 'sr-screener'],
])

/* -------------------------------------------------------------------------- */
/* Independent inventory                                                      */
/* -------------------------------------------------------------------------- */

function compareBytes(left, right) {
  return Buffer.compare(Buffer.from(String(left), 'utf8'), Buffer.from(String(right), 'utf8'))
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function modeString(mode) {
  return (mode & 0o777).toString(8).padStart(3, '0')
}

/** The absolute path strings that must never appear inside the copied content. */
const FORBIDDEN_CONTENT = Object.freeze([
  PLUGIN_ROOT,
  UPSTREAM_ROOT,
  '/Users/max',
])

/**
 * Walk the payload once and derive every inventory property the tests use.
 * Generated metadata files at the payload root are excluded, mirroring the
 * checker's contract. The walk refuses to follow symlinks and records them.
 */
function readPayload() {
  const files = []
  const symlinks = []
  const special = []
  const directories = new Set()
  const absolutePathHits = []

  const walk = (absolute, relativePath) => {
    const entries = readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
      compareBytes(left.name, right.name),
    )
    for (const entry of entries) {
      const childAbsolute = join(absolute, entry.name)
      const childRelative = relativePath === '' ? entry.name : `${relativePath}/${entry.name}`
      if (relativePath === '' && GENERATED_FILES.includes(entry.name)) continue
      const stats = lstatSync(childAbsolute)
      if (stats.isSymbolicLink()) {
        symlinks.push({ path: childRelative, target: readlinkSync(childAbsolute) })
        continue
      }
      if (stats.isDirectory()) {
        directories.add(childRelative)
        walk(childAbsolute, childRelative)
        continue
      }
      if (!stats.isFile()) {
        special.push(childRelative)
        continue
      }
      const buffer = readFileSync(childAbsolute)
      if (buffer.length <= 2 * 1024 * 1024 && !buffer.includes(0)) {
        const text = buffer.toString('utf8')
        for (const forbidden of FORBIDDEN_CONTENT) {
          if (text.includes(forbidden)) absolutePathHits.push({ path: childRelative, forbidden })
        }
      }
      files.push({
        path: childRelative,
        bytes: buffer.length,
        mode: stats.mode & 0o777,
        sha256: sha256Buffer(buffer),
      })
    }
  }

  walk(PAYLOAD_ROOT, '')
  files.sort((left, right) => compareBytes(left.path, right.path))

  const directoryCount = new Set()
  for (const file of files) {
    let directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
    while (directory !== '') {
      directoryCount.add(directory)
      directory = directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : ''
    }
  }

  const summarize = (entries) => {
    const modes = {}
    for (const entry of entries) {
      const key = modeString(entry.mode)
      modes[key] = (modes[key] ?? 0) + 1
    }
    return {
      files: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
      pathListSha256: sha256Text(entries.map((entry) => `${entry.path}\n`).join('')),
      contentSha256: sha256Text(
        entries.map((entry) => `${entry.path}\u0000${entry.sha256}\u0000${modeString(entry.mode)}\n`).join(''),
      ),
      modes: Object.fromEntries(Object.entries(modes).sort(([left], [right]) => compareBytes(left, right))),
    }
  }

  const groups = new Map()
  for (const file of files) {
    const head = file.path.split('/')[0]
    const key = INCLUDED_DIRECTORIES.includes(head) ? head : '.'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(file)
  }
  const byTopLevel = {}
  for (const key of [...INCLUDED_DIRECTORIES, '.']) {
    if (groups.has(key)) byTopLevel[key] = summarize(groups.get(key))
  }

  return {
    files,
    symlinks,
    special,
    absolutePathHits,
    directories: directoryCount.size,
    totals: summarize(files),
    byTopLevel,
    executableFiles: files
      .filter((file) => (file.mode & 0o111) !== 0)
      .map((file) => file.path)
      .sort(compareBytes),
  }
}

let cachedInventory = null
function inventory() {
  if (cachedInventory === null) cachedInventory = readPayload()
  return cachedInventory
}

function readJson(path, label) {
  assert.ok(existsSync(path), `${label} is missing: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

/* -------------------------------------------------------------------------- */
/* Inventory and provenance                                                   */
/* -------------------------------------------------------------------------- */

test('payload contains only regular files: no symlinks, no special entries', () => {
  const payload = inventory()
  assert.deepEqual(payload.symlinks, [], 'payload must not contain symlinks')
  assert.deepEqual(payload.special, [], 'payload must not contain special files')
  assert.equal(payload.files.length, PAYLOAD_SNAPSHOT.files)
})

test('recomputed inventory matches PROVENANCE totals and the pinned commit', () => {
  const payload = inventory()
  const provenance = readJson(join(PAYLOAD_ROOT, 'PROVENANCE.json'), 'PROVENANCE.json')

  assert.equal(payload.totals.files, PAYLOAD_SNAPSHOT.files)
  assert.equal(payload.totals.bytes, PAYLOAD_SNAPSHOT.bytes)
  assert.equal(payload.directories, PAYLOAD_SNAPSHOT.directories)
  assert.deepEqual(payload.totals.modes, PAYLOAD_SNAPSHOT.modes)

  assert.equal(provenance.schemaVersion, SCHEMA_VERSION)
  assert.equal(provenance.generatedBy, TOOL_NAME)
  assert.equal(provenance.toolVersion, TOOL_VERSION)
  assert.equal(provenance.totals.files, payload.totals.files)
  assert.equal(provenance.totals.bytes, payload.totals.bytes)
  assert.equal(provenance.totals.directories, payload.directories)
  assert.deepEqual(provenance.totals.modes, payload.totals.modes)
  assert.deepEqual(provenance.executableFiles, payload.executableFiles)
  assert.ok(payload.executableFiles.length > 0, 'the payload ships executable scripts')

  // The inventory on disk is exactly the upstream files plus the two generated
  // metadata documents; nothing else may appear.
  const onDisk = []
  const collect = (absolute, relativePath) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const childAbsolute = join(absolute, entry.name)
      const childRelative = relativePath === '' ? entry.name : `${relativePath}/${entry.name}`
      const stats = lstatSync(childAbsolute)
      if (stats.isDirectory()) collect(childAbsolute, childRelative)
      else onDisk.push(childRelative)
    }
  }
  collect(PAYLOAD_ROOT, '')
  assert.equal(onDisk.length, PAYLOAD_SNAPSHOT.files + GENERATED_FILES.length)
})

test('payload digests match PROVENANCE and the pinned upstream pins', () => {
  const payload = inventory()
  const provenance = readJson(join(PAYLOAD_ROOT, 'PROVENANCE.json'), 'PROVENANCE.json')

  assert.equal(payload.totals.pathListSha256, PAYLOAD_SNAPSHOT.pathListSha256)
  assert.equal(payload.totals.contentSha256, PAYLOAD_SNAPSHOT.contentSha256)
  assert.equal(provenance.pathListSha256, payload.totals.pathListSha256)
  assert.equal(provenance.contentSha256, payload.totals.contentSha256)
  assert.equal(provenance.payload.pinned.pathListSha256, PAYLOAD_SNAPSHOT.pathListSha256)
  assert.equal(provenance.payload.pinned.contentSha256, PAYLOAD_SNAPSHOT.contentSha256)

  assert.equal(provenance.upstream.repository, UPSTREAM.repository)
  assert.equal(provenance.upstream.commit, UPSTREAM.commit)
  assert.equal(provenance.upstream.commitDate, UPSTREAM.commitDate)
  assert.equal(provenance.upstream.pluginVersion, UPSTREAM.pluginVersion)
  assert.equal(provenance.upstream.pluginName, UPSTREAM.pluginName)
  assert.equal(provenance.upstream.license, UPSTREAM.license)
  assert.equal(provenance.upstream.checkout, UPSTREAM.checkout, 'checkout stays a relative path')

  assert.equal(provenance.generatedAtSource, 'git-commit-date')
  assert.equal(provenance.generatedAt, PAYLOAD_SNAPSHOT.generatedAt)
  assert.equal(provenance.generatedAt, new Date(Date.parse(provenance.upstream.commitDate)).toISOString())
})

test('per-top-level inventory matches PROVENANCE.byTopLevel', () => {
  const payload = inventory()
  const provenance = readJson(join(PAYLOAD_ROOT, 'PROVENANCE.json'), 'PROVENANCE.json')
  const expectedGroups = [...INCLUDED_DIRECTORIES, '.']

  assert.deepEqual(Object.keys(provenance.byTopLevel).sort(), [...expectedGroups].sort())
  let fileTotal = 0
  for (const group of expectedGroups) {
    const actual = payload.byTopLevel[group]
    const recorded = provenance.byTopLevel[group]
    assert.ok(actual, `recomputed group missing: ${group}`)
    assert.ok(recorded, `PROVENANCE group missing: ${group}`)
    assert.deepEqual(recorded, actual, `group ${group} mismatch`)
    fileTotal += recorded.files
  }
  assert.equal(fileTotal, PAYLOAD_SNAPSHOT.files)
})

test('PROVENANCE exclusions, includes, and generated files are consistent', () => {
  const provenance = readJson(join(PAYLOAD_ROOT, 'PROVENANCE.json'), 'PROVENANCE.json')

  assert.deepEqual(provenance.payload.generated, [...GENERATED_FILES])
  assert.deepEqual(provenance.payload.included.directories, [...INCLUDED_DIRECTORIES])
  assert.deepEqual(provenance.payload.included.files, [...INCLUDED_FILES])
  assert.equal(provenance.payload.included.fileCount, PAYLOAD_SNAPSHOT.files)
  assert.deepEqual(
    provenance.payload.symlinksRefused.map((entry) => entry.path).sort(),
    SKILL_NAMES.map((skill) => `skills/${skill}`).sort(),
  )

  for (const directory of INCLUDED_DIRECTORIES) {
    const absolute = join(PAYLOAD_ROOT, directory)
    assert.ok(existsSync(absolute) && statSync(absolute).isDirectory(), `included directory missing: ${directory}`)
  }
  for (const file of INCLUDED_FILES) {
    const absolute = join(PAYLOAD_ROOT, file)
    assert.ok(existsSync(absolute) && statSync(absolute).isFile(), `included file missing: ${file}`)
  }

  assert.ok(Array.isArray(provenance.payload.excluded) && provenance.payload.excluded.length > 0)
  for (const entry of provenance.payload.excluded) {
    assert.ok(!existsSync(join(PAYLOAD_ROOT, entry.path)), `excluded path was copied: ${entry.path}`)
    assert.ok(!INCLUDED_DIRECTORIES.includes(entry.path), `an included directory is excluded: ${entry.path}`)
    assert.ok(!INCLUDED_FILES.includes(entry.path), `an included file is excluded: ${entry.path}`)
  }
})

/* -------------------------------------------------------------------------- */
/* Registration corpus                                                        */
/* -------------------------------------------------------------------------- */

test('the registration corpus is exactly 5 skills, 16 commands, and 4 agents', () => {
  for (const skill of SKILL_NAMES) {
    const file = join(PAYLOAD_ROOT, skill, 'SKILL.md')
    assert.ok(existsSync(file), `${skill}/SKILL.md is missing`)
    assert.ok(statSync(file).size > 0, `${skill}/SKILL.md is empty`)
  }

  const commandFiles = readdirSync(join(PAYLOAD_ROOT, 'commands'))
    .filter((file) => file.endsWith('.md'))
    .sort()
  assert.deepEqual(commandFiles, COMMAND_NAMES.map((name) => `${name}.md`).sort())
  for (const file of commandFiles) {
    assert.ok(statSync(join(PAYLOAD_ROOT, 'commands', file)).size > 0, `commands/${file} is empty`)
  }

  const agentFiles = readdirSync(join(PAYLOAD_ROOT, 'agents'))
    .filter((file) => file.endsWith('.md'))
    .sort()
  assert.deepEqual(agentFiles, [...AGENT_FILES].sort())
  for (const file of agentFiles) {
    assert.ok(statSync(join(PAYLOAD_ROOT, 'agents', file)).size > 0, `agents/${file} is empty`)
  }
})

test('agent role files are byte-identical mirrors of their skill-local copy', () => {
  for (const [file, mirrorSkill] of AGENT_MIRRORS) {
    const topLevel = readFileSync(join(PAYLOAD_ROOT, 'agents', file))
    const skillLocal = readFileSync(join(PAYLOAD_ROOT, mirrorSkill, 'agents', file))
    assert.deepEqual(
      createHash('sha256').update(topLevel).digest('hex'),
      createHash('sha256').update(skillLocal).digest('hex'),
      `agents/${file} must mirror ${mirrorSkill}/agents/${file}`,
    )
  }
})

/* -------------------------------------------------------------------------- */
/* Cleanliness                                                                */
/* -------------------------------------------------------------------------- */

test('payload contains no generated Python bytecode or editor artifacts', () => {
  const payload = inventory()
  const offenders = payload.files
    .filter(
      (file) =>
        file.path.includes('__pycache__/') ||
        file.path.endsWith('.pyc') ||
        file.path.endsWith('.pyo') ||
        file.path.split('/').includes('.DS_Store'),
    )
    .map((file) => file.path)
  assert.deepEqual(
    offenders,
    [],
    'running payload Python with the managed venv must not write __pycache__ into the read-only payload',
  )
})

test('payload content carries no build-machine absolute paths', () => {
  const payload = inventory()
  assert.deepEqual(
    payload.absolutePathHits,
    [],
    `build-machine paths leaked into: ${payload.absolutePathHits
      .slice(0, 5)
      .map((hit) => `${hit.path} (${hit.forbidden})`)
      .join(', ')}`,
  )
})

/* -------------------------------------------------------------------------- */
/* REFERENCE-INDEX                                                            */
/* -------------------------------------------------------------------------- */

test('REFERENCE-INDEX is consistent with the payload and every resolved reference exists', () => {
  const provenance = readJson(join(PAYLOAD_ROOT, 'PROVENANCE.json'), 'PROVENANCE.json')
  const index = readJson(join(PAYLOAD_ROOT, 'REFERENCE-INDEX.json'), 'REFERENCE-INDEX.json')

  assert.equal(index.schemaVersion, SCHEMA_VERSION)
  assert.equal(index.generatedAt, provenance.generatedAt)
  assert.equal(index.upstream.commit, UPSTREAM.commit)
  assert.equal(index.upstream.pluginVersion, UPSTREAM.pluginVersion)
  assert.deepEqual(index.scan.extensions, ['.md'])
  assert.equal(index.scan.files, INDEX.filesScanned)

  const summary = index.summary
  assert.equal(summary.filesScanned, INDEX.filesScanned)
  assert.equal(summary.references, INDEX.references)
  assert.equal(summary.resolved, INDEX.resolved)
  assert.equal(summary.missing, INDEX.missing)
  assert.equal(summary.identifiers, INDEX.identifiers)
  assert.equal(summary.placeholders, INDEX.placeholders)
  assert.equal(index.entries.length, INDEX.references)
  assert.equal(index.missing.length, INDEX.missingTargets)

  const classificationCounts = {}
  for (const entry of index.entries) {
    classificationCounts[entry.classification] = (classificationCounts[entry.classification] ?? 0) + 1
  }
  assert.equal(classificationCounts.identifier, INDEX.identifiers)
  assert.equal(classificationCounts.placeholder, INDEX.placeholders)

  const resolvedEntries = index.entries.filter((entry) => entry.exists === true)
  const unresolvedFileEntries = index.entries.filter(
    (entry) => entry.exists === false && entry.classification === 'file',
  )
  assert.equal(resolvedEntries.length, INDEX.resolved)
  assert.equal(unresolvedFileEntries.length, INDEX.missing)

  // Every resolved reference must exist on disk with the recorded kind.
  let verifiedFiles = 0
  let verifiedDirectories = 0
  for (const entry of resolvedEntries) {
    assert.equal(typeof entry.resolved, 'string')
    assert.ok(!entry.resolved.startsWith('/'), `absolute resolved path: ${entry.resolved}`)
    assert.ok(!entry.resolved.split('/').includes('..'), `escaping resolved path: ${entry.resolved}`)
    const absolute = join(PAYLOAD_ROOT, entry.resolved)
    assert.ok(existsSync(absolute), `${entry.file}:${entry.line} resolved reference missing on disk: ${entry.resolved}`)
    if (entry.classification === 'directory') {
      assert.ok(statSync(absolute).isDirectory(), `directory reference is not a directory: ${entry.resolved}`)
      verifiedDirectories += 1
    } else {
      assert.ok(statSync(absolute).isFile(), `file reference is not a file: ${entry.resolved}`)
      verifiedFiles += 1
    }
  }
  assert.ok(verifiedFiles > 2000, `only ${verifiedFiles} resolved file references verified`)
  assert.equal(verifiedFiles + verifiedDirectories, INDEX.resolved)

  // Every aggregated "missing" target must be a real unresolved reference, and
  // its occurrence count must equal the sum of the matching entry counts.
  const unresolvedByTarget = new Map()
  for (const entry of index.entries) {
    if (entry.exists !== false || entry.classification !== 'file') continue
    const key = `${entry.raw}\u0000${entry.resolved}`
    const bucket = unresolvedByTarget.get(key) ?? {
      raw: entry.raw,
      resolved: entry.resolved,
      classification: entry.classification,
      convention: entry.convention,
      inCode: entry.inCode,
      count: 0,
      areas: new Set(),
      files: new Set(),
    }
    bucket.count += entry.count
    bucket.areas.add(entry.area)
    bucket.files.add(entry.file)
    unresolvedByTarget.set(key, bucket)
  }
  assert.equal(unresolvedByTarget.size, INDEX.missingTargets)
  for (const missing of index.missing) {
    const bucket = unresolvedByTarget.get(`${missing.raw}\u0000${missing.resolved}`)
    assert.ok(bucket, `missing[] target is not backed by an unresolved entry: ${missing.raw}`)
    assert.equal(missing.count, bucket.count, `missing count mismatch: ${missing.raw}`)
    assert.equal(missing.classification, bucket.classification)
    assert.equal(missing.convention, bucket.convention)
    assert.equal(missing.inCode, bucket.inCode)
    assert.deepEqual([...missing.areas].sort(), [...bucket.areas].sort())
    assert.deepEqual([...missing.files].sort(), [...bucket.files].sort())
    assert.ok(!existsSync(join(PAYLOAD_ROOT, missing.resolved)), `missing[] target exists on disk: ${missing.resolved}`)
  }

  // Aggregate reference counts partition the entry list.
  const byAreaReferences = Object.values(summary.byArea).reduce((total, area) => total + area.references, 0)
  const byConventionReferences = Object.values(summary.byConvention).reduce(
    (total, convention) => total + convention.references,
    0,
  )
  assert.equal(byAreaReferences, INDEX.references)
  assert.equal(byConventionReferences, INDEX.references)
  assert.equal(summary.resolved + summary.missing + summary.identifiers + summary.placeholders, INDEX.references)
})

/* -------------------------------------------------------------------------- */
/* Shipped guard fixtures                                                     */
/* -------------------------------------------------------------------------- */

test('the payload ships usable write-scope guard fixtures and the phase manifest', () => {
  const fixture = readJson(
    join(PAYLOAD_ROOT, 'scripts', 'fixtures', 'write_scope_guard', 'captured_payloads.json'),
    'write-scope fixture',
  )
  assert.equal(fixture.cases.length, 3)
  assert.deepEqual(
    fixture.cases.map((entry) => entry.expected_decision),
    ['allow', 'allow', 'deny'],
  )
  assert.equal(typeof fixture.claude_code_version, 'string')
  for (const entry of fixture.cases) {
    assert.equal(typeof entry.payload.tool_name, 'string')
    assert.equal(typeof entry.payload.cwd, 'string')
    assert.equal(typeof entry.payload.tool_input, 'object')
  }

  const manifest = readJson(
    join(PAYLOAD_ROOT, 'scripts', 'ars_phase_scope_manifest.json'),
    'phase-scope manifest',
  )
  assert.equal(manifest.version, 1)
  assert.equal(Object.keys(manifest.agents).length, 23)
  for (const [agent, scope] of Object.entries(manifest.agents)) {
    assert.equal(scope.bucket, 'A', `${agent}: bucket A`)
    assert.ok(Array.isArray(scope.allowed_write_globs) && scope.allowed_write_globs.length > 0, `${agent}: globs`)
  }

  assert.ok(existsSync(join(PAYLOAD_ROOT, 'scripts', 'ars_write_scope_guard.py')))
  assert.ok(statSync(join(PAYLOAD_ROOT, 'scripts', 'ars_write_scope_guard.py')).size > 10000)
})
