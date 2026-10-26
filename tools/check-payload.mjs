#!/usr/bin/env node
/**
 * Payload integrity checker for academic-research-skills-dsh.
 *
 * Verifies, without trusting the generated metadata:
 *   1. the critical runtime files exist (5 skills, 16 commands, 4 agents)
 *   2. the payload contains exactly the expected upstream files, bytes and modes
 *   3. payload/PROVENANCE.json matches a fresh inventory and the pinned upstream
 *   4. payload/REFERENCE-INDEX.json matches a fresh reference scan and is
 *      internally consistent
 *   5. references required for skill execution resolve; upstream documentation
 *      references that never shipped are reported as warnings, not failures
 *
 * The expected manifest is pinned to the upstream commit in
 * lib/payload-contract.js (the single owner of every payload pin). A legitimate
 * upstream bump updates the contract and regenerates the payload together.
 *
 * Usage:
 *   node tools/check-payload.mjs            report + warnings
 *   node tools/check-payload.mjs --strict   treat every missing reference as an error
 *   node tools/check-payload.mjs --json     machine-readable result
 *
 * Node 24 ESM, built-in modules only. Works from any current directory.
 */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BY_TOP_LEVEL,
  CRITICAL_EXPECTATIONS,
  FORBIDDEN_RUNTIME_DEPENDENCIES,
  GENERATED_FILES,
  INCLUDED_DIRECTORIES,
  INCLUDED_FILES,
  PAYLOAD_CONTRACT,
  PAYLOAD_SNAPSHOT,
  REFERENCE_INDEX,
  REQUIRED_EXCLUSIONS,
  REFUSED_SKILL_SYMLINKS,
  RUNTIME_REQUIREMENTS,
  SCHEMA_VERSION,
  SKILL_NAMES,
  TOOL_NAME,
  TOOL_VERSION,
  UPSTREAM,
  formatBytes,
  parseRequirementLines,
} from '../lib/payload-contract.js'
import { PAYLOAD_ROOT, PLUGIN_ROOT, buildInventory, buildReferenceIndex } from './build-payload.mjs'

/** Sibling upstream checkout used for the forbidden build-path scan. */
const UPSTREAM_ROOT = resolve(PLUGIN_ROOT, '..', 'repo')

/** Absolute build-machine markers that must never appear in payload content. */
const DEFAULT_FORBIDDEN_MARKERS = Object.freeze([PLUGIN_ROOT, UPSTREAM_ROOT, '/Users/max'])

const REQUIRED_REFERENCE_AREAS = Object.freeze([...SKILL_NAMES, 'commands', 'agents'])

function labelForTopLevel(key) {
  return key === '.' ? '(root)' : key
}

function readJson(path, errors) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    errors.push(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function compareNumber(label, actual, expected, errors) {
  if (actual !== expected) errors.push(`${label}: expected ${expected}, found ${actual}`)
}

function compareString(label, actual, expected, errors) {
  if (actual !== expected) errors.push(`${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`)
}

function compareStringArray(label, actual, expected, errors) {
  if (!Array.isArray(actual)) {
    errors.push(`${label}: expected an array`)
    return
  }
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) errors.push(`${label}: expected ${right}, found ${left}`)
}

function compareObjects(label, actual, expected, errors, keys = undefined) {
  if (actual === null || typeof actual !== 'object') {
    errors.push(`${label}: expected an object`)
    return
  }
  const names = keys ?? new Set([...Object.keys(expected), ...Object.keys(actual)])
  for (const key of names) {
    const left = JSON.stringify(actual[key])
    const right = JSON.stringify(expected[key])
    if (left !== right) errors.push(`${label}.${key}: expected ${right}, found ${left}`)
  }
}

/** Bytewise string comparison (locale-independent). */
function compareBytes(left, right) {
  return Buffer.compare(Buffer.from(String(left), 'utf8'), Buffer.from(String(right), 'utf8'))
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Walk the payload once and derive the deep inventory consumed by
 * `checkPayload`, `verifyPayload`, and `tools/verify-install.mjs`.
 *
 * Generated metadata files at the payload root are excluded. Symlinks and
 * special entries are recorded instead of followed, and file content is
 * scanned for build-machine absolute paths.
 *
 * @param {{payloadRoot?: string, forbiddenMarkers?: string[]}} [options]
 * @returns {{
 *   files: Array<{path: string, bytes: number, mode: number, sha256: string}>,
 *   symlinks: Array<{path: string, target: string}>,
 *   special: string[],
 *   unsupported: Array<{path: string, reason: string}>,
 *   forbiddenHits: Array<{path: string, marker: string}>,
 *   directories: number,
 *   totals: {files: number, bytes: number, directories: number, modes: Record<string, number>},
 *   pathListSha256: string,
 *   contentSha256: string,
 *   executableFiles: string[],
 *   byTopLevel: Record<string, object>,
 * }}
 */
export function payloadInventory({ payloadRoot = PAYLOAD_ROOT, forbiddenMarkers = DEFAULT_FORBIDDEN_MARKERS } = {}) {
  const files = []
  const symlinks = []
  const special = []
  const unsupported = []
  const forbiddenHits = []
  const markers = [...forbiddenMarkers]
  const excluded = new Set(GENERATED_FILES)

  const walk = (absolute, relativePath) => {
    const entries = readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
      compareBytes(left.name, right.name),
    )
    for (const entry of entries) {
      const childAbsolute = join(absolute, entry.name)
      const childRelative = relativePath === '' ? entry.name : `${relativePath}/${entry.name}`
      if (relativePath === '' && excluded.has(entry.name)) continue
      const stats = lstatSync(childAbsolute)
      if (stats.isSymbolicLink()) {
        symlinks.push({ path: childRelative, target: readlinkSync(childAbsolute) })
        continue
      }
      if (stats.isDirectory()) {
        walk(childAbsolute, childRelative)
        continue
      }
      if (!stats.isFile()) {
        special.push(childRelative)
        unsupported.push({ path: childRelative, reason: 'not a regular file' })
        continue
      }
      const buffer = readFileSync(childAbsolute)
      if (buffer.length <= 2 * 1024 * 1024 && !buffer.includes(0)) {
        const text = buffer.toString('utf8')
        for (const marker of markers) {
          if (text.includes(marker)) forbiddenHits.push({ path: childRelative, marker })
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
  if (existsSync(payloadRoot)) walk(payloadRoot, '')
  files.sort((left, right) => compareBytes(left.path, right.path))

  const inventory = buildInventory(files)
  return {
    files,
    symlinks,
    special,
    unsupported,
    forbiddenHits,
    directories: inventory.totals.directories,
    totals: inventory.totals,
    pathListSha256: inventory.pathListSha256,
    contentSha256: inventory.contentSha256,
    executableFiles: inventory.executableFiles,
    byTopLevel: inventory.byTopLevel,
  }
}

function listMarkdown(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(dir, name))
}

function generatedAtProblems(provenance, errors, warnings) {
  if (provenance.generatedAtSource === 'git-commit-date') {
    const expected = new Date(Date.parse(UPSTREAM.commitDate)).toISOString()
    compareString('PROVENANCE.generatedAt', provenance.generatedAt, expected, errors)
  } else if (provenance.generatedAtSource === 'SOURCE_DATE_EPOCH') {
    if (typeof provenance.generatedAt !== 'string' || Number.isNaN(Date.parse(provenance.generatedAt))) {
      errors.push('PROVENANCE.generatedAt is not a valid ISO timestamp')
    } else if (process.env.SOURCE_DATE_EPOCH !== undefined && process.env.SOURCE_DATE_EPOCH !== '') {
      const expected = new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
      compareString('PROVENANCE.generatedAt', provenance.generatedAt, expected, errors)
    } else {
      warnings.push(
        'payload was built with SOURCE_DATE_EPOCH but the check process has no SOURCE_DATE_EPOCH; exact timestamp not independently verifiable',
      )
    }
  } else {
    errors.push(`PROVENANCE.generatedAtSource is not supported: ${JSON.stringify(provenance.generatedAtSource)}`)
  }
}

function checkRequirements(errors, warnings) {
  const path = join(PLUGIN_ROOT, 'requirements-runtime.txt')
  if (!existsSync(path)) {
    errors.push('requirements-runtime.txt is missing')
    return
  }
  const entries = parseRequirementLines(readFileSync(path, 'utf8'))
  // The contract is the independent pin; the requirements file must match it.
  compareStringArray('requirements-runtime.txt entries', entries, RUNTIME_REQUIREMENTS, errors)
  for (const forbidden of FORBIDDEN_RUNTIME_DEPENDENCIES) {
    if (entries.some((entry) => entry.toLowerCase().startsWith(forbidden))) {
      errors.push(`requirements-runtime.txt includes test-only dependency ${forbidden}`)
    }
  }
  if (entries.length !== RUNTIME_REQUIREMENTS.length) {
    warnings.push(`requirements-runtime.txt has ${entries.length} entries, expected ${RUNTIME_REQUIREMENTS.length}`)
  }
  if (PAYLOAD_CONTRACT.runtimeRequirements.length !== RUNTIME_REQUIREMENTS.length) {
    errors.push('payload contract runtime requirements are internally inconsistent')
  }
}

/**
 * Run every payload check.
 *
 * @param {{payloadRoot?: string, strict?: boolean}} [options]
 * @returns {{ok: boolean, errors: string[], warnings: string[], data: object}}
 */
export function checkPayload({ payloadRoot = PAYLOAD_ROOT, strict = false } = {}) {
  const errors = []
  const warnings = []
  const data = { payloadRoot, critical: {}, provenance: {}, references: {}, warnings: [] }

  if (!existsSync(payloadRoot)) {
    return {
      ok: false,
      errors: [`payload directory is missing: ${payloadRoot}`],
      warnings,
      data,
    }
  }

  // 1. critical files ------------------------------------------------------
  data.critical.skills = SKILL_NAMES.map((skill) => {
    const file = join(payloadRoot, skill, 'SKILL.md')
    if (!existsSync(file)) {
      errors.push(`missing skill file: payload/${skill}/SKILL.md`)
      return null
    }
    if (statSync(file).size === 0) errors.push(`empty skill file: payload/${skill}/SKILL.md`)
    return file
  }).filter(Boolean).length
  compareNumber('critical skill count', data.critical.skills, CRITICAL_EXPECTATIONS.skills, errors)

  const commandFiles = listMarkdown(join(payloadRoot, 'commands'))
  data.critical.commands = commandFiles.length
  compareNumber('critical command count', data.critical.commands, CRITICAL_EXPECTATIONS.commands, errors)
  for (const file of commandFiles) {
    if (statSync(file).size === 0) errors.push(`empty command file: payload/commands/${file.split('/').pop()}`)
  }

  const agentFiles = listMarkdown(join(payloadRoot, 'agents'))
  data.critical.agents = agentFiles.length
  compareNumber('critical agent count', data.critical.agents, CRITICAL_EXPECTATIONS.agents, errors)

  // 2. include manifest and symlinks --------------------------------------
  for (const directory of INCLUDED_DIRECTORIES) {
    const path = join(payloadRoot, directory)
    if (!existsSync(path) || !statSync(path).isDirectory()) errors.push(`missing included directory: payload/${directory}`)
  }
  for (const file of INCLUDED_FILES) {
    const path = join(payloadRoot, file)
    if (!existsSync(path) || !statSync(path).isFile()) errors.push(`missing included file: payload/${file}`)
  }

  const inventory = payloadInventory({ payloadRoot })
  if (inventory.symlinks.length > 0) {
    errors.push(`payload contains symlinks: ${inventory.symlinks.map((item) => item.path).join(', ')}`)
  }
  if (inventory.unsupported.length > 0) {
    errors.push(`payload contains unsupported entries: ${inventory.unsupported.map((item) => item.path).join(', ')}`)
  }

  // 3. independent inventory ----------------------------------------------
  data.payload = {
    files: inventory.totals.files,
    bytes: inventory.totals.bytes,
    directories: inventory.totals.directories,
    modes: inventory.totals.modes,
    symlinks: inventory.symlinks.length,
  }
  compareNumber('payload file count', inventory.totals.files, PAYLOAD_SNAPSHOT.files, errors)
  compareNumber('payload byte count', inventory.totals.bytes, PAYLOAD_SNAPSHOT.bytes, errors)
  compareString('payload content digest', inventory.contentSha256, PAYLOAD_SNAPSHOT.contentSha256, errors)
  compareString('payload path-list digest', inventory.pathListSha256, PAYLOAD_SNAPSHOT.pathListSha256, errors)
  for (const [key, expected] of Object.entries(BY_TOP_LEVEL)) {
    const actual = inventory.byTopLevel[key]
    if (actual === undefined) {
      errors.push(`payload group missing: ${labelForTopLevel(key)}`)
      continue
    }
    compareNumber(`${labelForTopLevel(key)} file count`, actual.files, expected.files, errors)
    compareNumber(`${labelForTopLevel(key)} byte count`, actual.bytes, expected.bytes, errors)
  }
  for (const key of Object.keys(inventory.byTopLevel)) {
    if (BY_TOP_LEVEL[key] === undefined) errors.push(`unexpected payload group: ${labelForTopLevel(key)}`)
  }

  // 4. PROVENANCE ----------------------------------------------------------
  const provenancePath = join(payloadRoot, 'PROVENANCE.json')
  const provenance = existsSync(provenancePath) ? readJson(provenancePath, errors) : null
  if (provenance === null) {
    errors.push('payload/PROVENANCE.json is missing or unreadable')
  } else {
    data.provenance = {
      commit: provenance.upstream?.commit,
      pluginVersion: provenance.upstream?.pluginVersion,
      generatedAt: provenance.generatedAt,
      generatedAtSource: provenance.generatedAtSource,
    }
    compareNumber('PROVENANCE.schemaVersion', provenance.schemaVersion, SCHEMA_VERSION, errors)
    compareString('PROVENANCE.generatedBy', provenance.generatedBy, TOOL_NAME, errors)
    compareString('PROVENANCE.toolVersion', provenance.toolVersion, TOOL_VERSION, errors)
    compareString('PROVENANCE.upstream.repository', provenance.upstream?.repository, UPSTREAM.repository, errors)
    compareString('PROVENANCE.upstream.repositoryGit', provenance.upstream?.repositoryGit, UPSTREAM.repositoryGit, errors)
    compareString('PROVENANCE.upstream.commit', provenance.upstream?.commit, UPSTREAM.commit, errors)
    compareString('PROVENANCE.upstream.commitDate', provenance.upstream?.commitDate, UPSTREAM.commitDate, errors)
    compareString('PROVENANCE.upstream.pluginName', provenance.upstream?.pluginName, UPSTREAM.pluginName, errors)
    compareString('PROVENANCE.upstream.pluginVersion', provenance.upstream?.pluginVersion, UPSTREAM.pluginVersion, errors)
    compareString('PROVENANCE.upstream.license', provenance.upstream?.license, UPSTREAM.license, errors)
    generatedAtProblems(provenance, errors, warnings)

    compareNumber('PROVENANCE.totals.files', provenance.totals?.files, inventory.totals.files, errors)
    compareNumber('PROVENANCE.totals.bytes', provenance.totals?.bytes, inventory.totals.bytes, errors)
    compareNumber('PROVENANCE.totals.directories', provenance.totals?.directories, inventory.totals.directories, errors)
    compareObjects('PROVENANCE.totals.modes', provenance.totals?.modes, inventory.totals.modes, errors)
    compareString('PROVENANCE.pathListSha256', provenance.pathListSha256, inventory.pathListSha256, errors)
    compareString('PROVENANCE.contentSha256', provenance.contentSha256, inventory.contentSha256, errors)
    compareStringArray('PROVENANCE.executableFiles', provenance.executableFiles, inventory.executableFiles, errors)
    compareString('PROVENANCE.payload.pinned.contentSha256', provenance.payload?.pinned?.contentSha256, PAYLOAD_SNAPSHOT.contentSha256, errors)
    compareString('PROVENANCE.payload.pinned.pathListSha256', provenance.payload?.pinned?.pathListSha256, PAYLOAD_SNAPSHOT.pathListSha256, errors)

    if (provenance.byTopLevel === undefined) {
      errors.push('PROVENANCE.byTopLevel is missing')
    } else {
      for (const [key, actual] of Object.entries(inventory.byTopLevel)) {
        const recorded = provenance.byTopLevel[key]
        const label = labelForTopLevel(key)
        if (recorded === undefined) {
          errors.push(`PROVENANCE.byTopLevel is missing ${label}`)
          continue
        }
        for (const field of ['files', 'bytes', 'pathListSha256', 'contentSha256']) {
          const left = JSON.stringify(recorded[field])
          const right = JSON.stringify(actual[field])
          if (left !== right) errors.push(`PROVENANCE.byTopLevel.${label}.${field}: expected ${right}, found ${left}`)
        }
        compareObjects(`PROVENANCE.byTopLevel.${label}.modes`, recorded.modes, actual.modes, errors)
      }
      for (const key of Object.keys(provenance.byTopLevel)) {
        if (inventory.byTopLevel[key] === undefined) errors.push(`PROVENANCE.byTopLevel has unexpected group ${labelForTopLevel(key)}`)
      }
    }

    compareStringArray('PROVENANCE.payload.generated', provenance.payload?.generated, GENERATED_FILES, errors)
    compareStringArray(
      'PROVENANCE.payload.included.directories',
      provenance.payload?.included?.directories,
      INCLUDED_DIRECTORIES,
      errors,
    )
    compareStringArray('PROVENANCE.payload.included.files', provenance.payload?.included?.files, INCLUDED_FILES, errors)
    compareNumber('PROVENANCE.payload.included.fileCount', provenance.payload?.included?.fileCount, inventory.totals.files, errors)
    const refusedPaths = (provenance.payload?.symlinksRefused ?? []).map((item) => item.path).sort()
    compareStringArray('PROVENANCE.payload.symlinksRefused', refusedPaths, [...REFUSED_SKILL_SYMLINKS].sort(), errors)
    const excludedPaths = (provenance.payload?.excluded ?? []).map((item) => item.path).sort()
    for (const required of REQUIRED_EXCLUSIONS) {
      if (!excludedPaths.includes(required)) errors.push(`PROVENANCE exclusion manifest is missing ${required}`)
    }
    const includedSet = new Set([...INCLUDED_DIRECTORIES, ...INCLUDED_FILES])
    for (const path of excludedPaths) {
      if (includedSet.has(path)) errors.push(`PROVENANCE excludes an included path: ${path}`)
    }
  }

  // 5. REFERENCE-INDEX -----------------------------------------------------
  const indexPath = join(payloadRoot, 'REFERENCE-INDEX.json')
  const index = existsSync(indexPath) ? readJson(indexPath, errors) : null
  const generatedAt = provenance?.generatedAt
  let recomputed = null
  if (index === null) {
    errors.push('payload/REFERENCE-INDEX.json is missing or unreadable')
  } else if (typeof generatedAt !== 'string') {
    errors.push('cannot validate REFERENCE-INDEX.json without PROVENANCE.generatedAt')
  } else {
    recomputed = buildReferenceIndex({
      payloadRoot,
      generatedAt,
      upstream: { commit: UPSTREAM.commit, pluginVersion: UPSTREAM.pluginVersion },
    })
    compareNumber('REFERENCE-INDEX.schemaVersion', index.schemaVersion, SCHEMA_VERSION, errors)
    compareString('REFERENCE-INDEX.generatedAt', index.generatedAt, generatedAt, errors)
    compareString('REFERENCE-INDEX.upstream.commit', index.upstream?.commit, UPSTREAM.commit, errors)
    compareString('REFERENCE-INDEX.upstream.pluginVersion', index.upstream?.pluginVersion, UPSTREAM.pluginVersion, errors)
    for (const field of ['conventions', 'resolutionOrder', 'scan', 'summary', 'missing', 'entries']) {
      const left = JSON.stringify(index[field])
      const right = JSON.stringify(recomputed[field])
      if (left !== right) {
        if (field === 'entries' && Array.isArray(index.entries)) {
          const first = firstDifference(index.entries, recomputed.entries)
          errors.push(
            `REFERENCE-INDEX.${field} is stale or inconsistent (${index.entries.length} recorded vs ` +
              `${recomputed.entries.length} scanned; first difference: ${first})`,
          )
        } else if (field === 'missing' && Array.isArray(index.missing)) {
          errors.push(
            `REFERENCE-INDEX.${field} is stale or inconsistent (${index.missing.length} recorded vs ` +
              `${recomputed.missing.length} scanned)`,
          )
        } else {
          errors.push(`REFERENCE-INDEX.${field} does not match a fresh scan`)
        }
      }
    }
    data.references = {
      filesScanned: recomputed.summary.filesScanned,
      references: recomputed.summary.references,
      resolved: recomputed.summary.resolved,
      missing: recomputed.summary.missing,
      missingTargets: recomputed.summary.missingTargets,
      missingOccurrences: recomputed.summary.missingOccurrences,
      identifiers: recomputed.summary.identifiers,
      placeholders: recomputed.summary.placeholders,
      byConvention: recomputed.summary.byConvention,
      missingByArea: recomputed.summary.missingByArea,
      topMissing: recomputed.missing.slice(0, 10).map((item) => ({
        raw: item.raw,
        count: item.count,
        areas: item.areas,
      })),
    }
  }

  // 6. required references -------------------------------------------------
  if (recomputed !== null) {
    const requiredMissing = recomputed.entries.filter(
      (entry) =>
        !entry.exists &&
        entry.classification === 'file' &&
        !entry.inCode &&
        REQUIRED_REFERENCE_AREAS.includes(entry.area),
    )
    for (const entry of requiredMissing) {
      errors.push(`missing required reference: ${entry.file} -> ${entry.raw} (resolved ${entry.resolved})`)
    }
    if (strict) {
      for (const item of recomputed.missing) {
        if (item.inCode) continue
        if (requiredMissing.some((entry) => entry.raw === item.raw && entry.resolved === item.resolved)) continue
        errors.push(`missing reference (--strict): ${item.raw} -> ${item.resolved} [${item.areas.join(', ')}]`)
      }
    }
    // Warnings: upstream documentation/example references that never shipped.
    const warningGroups = new Map()
    for (const item of recomputed.missing) {
      if (requiredMissing.some((entry) => entry.raw === item.raw && entry.resolved === item.resolved)) continue
      for (const area of item.areas) {
        const bucket = warningGroups.get(area) ?? { area, unique: 0, occurrences: 0, inCodeOnly: true }
        bucket.inCodeOnly = bucket.inCodeOnly && item.inCode
        warningGroups.set(area, bucket)
      }
    }
    for (const item of recomputed.missing) {
      if (requiredMissing.some((entry) => entry.raw === item.raw && entry.resolved === item.resolved)) continue
      for (const area of item.areas) {
        const bucket = warningGroups.get(area)
        bucket.unique += 1
        bucket.occurrences += item.count
      }
    }
    for (const bucket of [...warningGroups.values()].sort((left, right) => right.occurrences - left.occurrences)) {
      warnings.push(
        `missing references in ${bucket.area}: ${bucket.unique} targets / ${bucket.occurrences} occurrences` +
          (bucket.inCodeOnly ? ' (all inside code examples)' : ''),
      )
    }
  }

  // 7. runtime requirements file ------------------------------------------
  checkRequirements(errors, warnings)

  data.warnings = warnings
  return { ok: errors.length === 0, errors, warnings, data }
}

function firstDifference(left, right) {
  const length = Math.max(left.length, right.length)
  for (let position = 0; position < length; position += 1) {
    const leftJson = JSON.stringify(left[position])
    const rightJson = JSON.stringify(right[position])
    if (leftJson !== rightJson) return `index ${position}`
  }
  return 'unknown'
}

function printReport(result, payloadRoot) {
  const { errors, warnings, data } = result
  const lines = []
  lines.push('ARS payload check')
  lines.push(`  payload    : ${payloadRoot}`)
  if (data.payload !== undefined) {
    lines.push(
      `               ${data.payload.files} files, ${formatBytes(data.payload.bytes)}, ` +
        `${data.payload.directories} dirs, ${data.payload.symlinks} symlinks`,
    )
  }
  lines.push(
    `  critical   : skills ${data.critical.skills ?? '?'}/${CRITICAL_EXPECTATIONS.skills}, ` +
      `commands ${data.critical.commands ?? '?'}/${CRITICAL_EXPECTATIONS.commands}, ` +
      `agents ${data.critical.agents ?? '?'}/${CRITICAL_EXPECTATIONS.agents}`,
  )
  if (data.provenance.commit !== undefined) {
    lines.push(
      `  provenance : ${String(data.provenance.commit).slice(0, 12)} (${data.provenance.pluginVersion}), ` +
        `${data.provenance.generatedAt} (${data.provenance.generatedAtSource})`,
    )
  }
  if (data.references.references !== undefined) {
    lines.push(
      `  references : ${data.references.filesScanned} Markdown files, ${data.references.references} refs, ` +
        `${data.references.resolved} resolved, ${data.references.missing} missing ` +
        `(${data.references.missingTargets} targets / ${data.references.missingOccurrences} occurrences), ` +
        `${data.references.identifiers} identifiers, ${data.references.placeholders} placeholders`,
    )
    if (data.references.byConvention !== undefined) {
      for (const [convention, counts] of Object.entries(data.references.byConvention)) {
        lines.push(
          `               ${convention.padEnd(22)} ${String(counts.references).padStart(5)} refs, ` +
            `${String(counts.resolved).padStart(5)} resolved, ${String(counts.missing).padStart(3)} missing`,
        )
      }
    }
  }
  lines.push('  per top level:')
  for (const [key, expected] of Object.entries(BY_TOP_LEVEL)) {
    lines.push(
      `    ${labelForTopLevel(key).padEnd(28)} ${String(expected.files).padStart(5)} files  ` +
        `${formatBytes(expected.bytes).padStart(9)}`,
    )
  }
  if (data.references.topMissing !== undefined && data.references.topMissing.length > 0) {
    lines.push('  top missing references:')
    for (const item of data.references.topMissing) {
      lines.push(`    ${String(item.count).padStart(4)}x  ${item.raw}  [${item.areas.join(', ')}]`)
    }
  }
  if (warnings.length > 0) {
    lines.push('  warnings:')
    for (const warning of warnings) lines.push(`    - ${warning}`)
  }
  if (errors.length > 0) {
    lines.push('  errors:')
    for (const error of errors) lines.push(`    - ${error}`)
    lines.push(`FAILED: ${errors.length} error(s), ${warnings.length} warning(s)`)
  } else {
    lines.push(`OK: 0 errors, ${warnings.length} warning(s)`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      'Usage: node tools/check-payload.mjs [--strict] [--json]\n\n' +
        'Verifies the bundled payload against the pinned upstream commit.\n' +
        '  --strict   treat every missing reference as an error\n' +
        '  --json     print one machine-readable JSON object\n',
    )
    return { ok: true, help: true }
  }
  const strict = argv.includes('--strict')
  const json = argv.includes('--json')
  const result = checkPayload({ payloadRoot: PAYLOAD_ROOT, strict })
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: result.ok,
          strict,
          errors: result.errors,
          warnings: result.warnings,
          data: result.data,
        },
        null,
        2,
      )}\n`,
    )
  } else {
    printReport(result, PAYLOAD_ROOT)
  }
  if (!result.ok) process.exitCode = 1
  return result
}

function isEntrypoint() {
  if (!process.argv[1]) return false
  try {
    const invoked = realpathSync(resolve(process.argv[1]))
    const self = realpathSync(fileURLToPath(import.meta.url))
    return invoked === self
  } catch {
    return false
  }
}

if (isEntrypoint()) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`payload check failed: ${error instanceof Error ? error.message : String(error)}\n`)
    if (process.env.ARS_DEBUG === '1' && error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`)
    }
    process.exitCode = 1
  }
}

/* ------------------------------------------------------------------------- *
 * Deep payload verification (shared with tools/verify-install.mjs)
 * ------------------------------------------------------------------------- */

function ensureStrict(condition, message) {
  if (!condition) throw new Error(message)
}

function equalStrict(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`)
  }
}

function deepEqualStrict(actual, expected, label) {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) throw new Error(`${label}: expected ${right}, found ${left}`)
}

function readJsonStrict(path, label) {
  ensureStrict(existsSync(path), `${label} is missing: ${path}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function includedSummary(byTopLevel) {
  const parts = []
  for (const [group, counts] of Object.entries(byTopLevel)) {
    if (group === '.') continue
    parts.push(`${group} ${counts.files}`)
  }
  return parts.join(', ')
}

function runDeepCheck(checks, name, fn) {
  try {
    const detail = fn()
    checks.push({ name, ok: true, detail: typeof detail === 'string' ? detail : '' })
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Deep payload verification returning the row-by-row checks used by
 * `tools/verify-install.mjs`, plus the recomputed inventory, the generated
 * metadata, and the report summary.
 *
 * `checkPayload` remains the aggregate CLI/error-reporting view; both share
 * `payloadInventory` and the contract pins, so the checker and the install
 * verifier can never disagree about what "the payload" means.
 *
 * @param {{payloadRoot?: string, corpus?: {commands: string[], agents: string[]}|null}} [options]
 * @returns {{checks: Array<{name: string, ok: boolean, detail: string}>, inventory: object, provenance: object, index: object, summary: object}}
 */
export function verifyPayload({ payloadRoot = PAYLOAD_ROOT, corpus = null } = {}) {
  const provenance = readJsonStrict(join(payloadRoot, 'PROVENANCE.json'), 'PROVENANCE.json')
  const index = readJsonStrict(join(payloadRoot, 'REFERENCE-INDEX.json'), 'REFERENCE-INDEX.json')
  const payload = payloadInventory({ payloadRoot })
  const checks = []
  const run = (name, fn) => runDeepCheck(checks, name, fn)

  run('provenance identity', () => {
    equalStrict(provenance.schemaVersion, SCHEMA_VERSION, 'schemaVersion')
    equalStrict(provenance.generatedBy, TOOL_NAME, 'generatedBy')
    equalStrict(provenance.toolVersion, TOOL_VERSION, 'toolVersion')
    equalStrict(provenance.upstream.repository, UPSTREAM.repository, 'repository')
    equalStrict(provenance.upstream.commit, UPSTREAM.commit, 'commit')
    equalStrict(provenance.upstream.pluginVersion, UPSTREAM.pluginVersion, 'pluginVersion')
    equalStrict(provenance.upstream.license, UPSTREAM.license, 'license')
    equalStrict(provenance.generatedAtSource, PAYLOAD_SNAPSHOT.generatedAtSource, 'generatedAtSource')
    equalStrict(provenance.generatedAt, PAYLOAD_SNAPSHOT.generatedAt, 'generatedAt')
    equalStrict(
      provenance.generatedAt,
      new Date(Date.parse(provenance.upstream.commitDate)).toISOString(),
      'generatedAt from commit date',
    )
    equalStrict(provenance.upstream.checkout, '../repo', 'relative checkout')
    return `${provenance.upstream.commit.slice(0, 12)} (${provenance.upstream.pluginVersion}), generated ${provenance.generatedAt}`
  })

  run('upstream inventory totals', () => {
    deepEqualStrict(payload.totals.modes, PAYLOAD_SNAPSHOT.modes, 'modes')
    equalStrict(payload.totals.files, PAYLOAD_SNAPSHOT.files, 'files')
    equalStrict(payload.totals.bytes, PAYLOAD_SNAPSHOT.bytes, 'bytes')
    equalStrict(payload.directories, PAYLOAD_SNAPSHOT.directories, 'directories')
    equalStrict(provenance.totals.files, PAYLOAD_SNAPSHOT.files, 'PROVENANCE files')
    equalStrict(provenance.totals.bytes, PAYLOAD_SNAPSHOT.bytes, 'PROVENANCE bytes')
    equalStrict(provenance.totals.directories, PAYLOAD_SNAPSHOT.directories, 'PROVENANCE directories')
    deepEqualStrict(provenance.totals.modes, PAYLOAD_SNAPSHOT.modes, 'PROVENANCE modes')
    return `${PAYLOAD_SNAPSHOT.files} files, ${formatBytes(PAYLOAD_SNAPSHOT.bytes)}, ${PAYLOAD_SNAPSHOT.directories} dirs, modes ${JSON.stringify(PAYLOAD_SNAPSHOT.modes)}`
  })

  run('content and path-list digests', () => {
    equalStrict(payload.contentSha256, PAYLOAD_SNAPSHOT.contentSha256, 'recomputed content digest')
    equalStrict(payload.pathListSha256, PAYLOAD_SNAPSHOT.pathListSha256, 'recomputed path-list digest')
    equalStrict(provenance.contentSha256, PAYLOAD_SNAPSHOT.contentSha256, 'PROVENANCE content digest')
    equalStrict(provenance.pathListSha256, PAYLOAD_SNAPSHOT.pathListSha256, 'PROVENANCE path-list digest')
    equalStrict(provenance.payload.pinned.contentSha256, PAYLOAD_SNAPSHOT.contentSha256, 'pinned content digest')
    equalStrict(provenance.payload.pinned.pathListSha256, PAYLOAD_SNAPSHOT.pathListSha256, 'pinned path-list digest')
    return `content ${PAYLOAD_SNAPSHOT.contentSha256.slice(0, 16)}…, paths ${PAYLOAD_SNAPSHOT.pathListSha256.slice(0, 16)}…`
  })

  run('per-top-level inventory', () => {
    const expectedGroups = [...INCLUDED_DIRECTORIES, '.']
    deepEqualStrict(Object.keys(provenance.byTopLevel).sort(), [...expectedGroups].sort(), 'group keys')
    let total = 0
    for (const group of expectedGroups) {
      deepEqualStrict(provenance.byTopLevel[group], payload.byTopLevel[group], `group ${group}`)
      total += provenance.byTopLevel[group].files
    }
    equalStrict(total, PAYLOAD_SNAPSHOT.files, 'group file total')
    return `${expectedGroups.length} groups match (${includedSummary(provenance.byTopLevel)})`
  })

  run('critical registration corpus', () => {
    for (const skill of SKILL_NAMES) {
      const file = join(payloadRoot, skill, 'SKILL.md')
      ensureStrict(existsSync(file) && statSync(file).size > 0, `${skill}/SKILL.md missing or empty`)
    }
    const commands = readdirSync(join(payloadRoot, 'commands'))
      .filter((file) => file.endsWith('.md'))
      .sort()
    const agents = readdirSync(join(payloadRoot, 'agents'))
      .filter((file) => file.endsWith('.md'))
      .sort()
    if (corpus !== null) {
      deepEqualStrict(
        commands,
        corpus.commands.map((name) => `${name}.md`).sort(),
        'command files',
      )
      deepEqualStrict(agents, [...corpus.agents].sort(), 'agent files')
    } else {
      equalStrict(commands.length, CRITICAL_EXPECTATIONS.commands, 'command files')
      equalStrict(agents.length, CRITICAL_EXPECTATIONS.agents, 'agent files')
    }
    return `${SKILL_NAMES.length} SKILL.md + ${CRITICAL_EXPECTATIONS.commands} commands + ${CRITICAL_EXPECTATIONS.agents} agent roles, no extras`
  })

  run('no symlinks or special entries', () => {
    deepEqualStrict(payload.symlinks, [], 'symlinks')
    deepEqualStrict(payload.special, [], 'special entries')
    return '0 symlinks, 0 special entries'
  })

  run('no generated bytecode', () => {
    const offenders = payload.files.filter(
      (file) =>
        file.path.includes('__pycache__/') || file.path.endsWith('.pyc') || file.path.endsWith('.pyo'),
    )
    deepEqualStrict(offenders, [], '__pycache__/.pyc offenders')
    return '0 __pycache__/.pyc files'
  })

  run('no build-machine absolute paths', () => {
    deepEqualStrict(payload.forbiddenHits, [], 'absolute build paths in payload content')
    return 'payload content is free of this checkout, the upstream clone, and /Users/max paths'
  })

  run('REFERENCE-INDEX consistency', () => {
    equalStrict(index.schemaVersion, SCHEMA_VERSION, 'schemaVersion')
    equalStrict(index.generatedAt, provenance.generatedAt, 'generatedAt')
    equalStrict(index.upstream.commit, UPSTREAM.commit, 'upstream commit')
    equalStrict(index.upstream.pluginVersion, UPSTREAM.pluginVersion, 'upstream version')
    equalStrict(index.scan.files, REFERENCE_INDEX.filesScanned, 'scan files')
    equalStrict(index.summary.filesScanned, REFERENCE_INDEX.filesScanned, 'summary files')
    equalStrict(index.summary.references, REFERENCE_INDEX.references, 'references')
    equalStrict(index.summary.resolved, REFERENCE_INDEX.resolved, 'resolved')
    equalStrict(index.summary.missing, REFERENCE_INDEX.missing, 'missing')
    equalStrict(index.summary.identifiers, REFERENCE_INDEX.identifiers, 'identifiers')
    equalStrict(index.summary.placeholders, REFERENCE_INDEX.placeholders, 'placeholders')
    equalStrict(index.entries.length, REFERENCE_INDEX.references, 'entry count')
    equalStrict(index.missing.length, REFERENCE_INDEX.missingTargets, 'missing target count')
    let resolvedFiles = 0
    let resolvedDirectories = 0
    for (const entry of index.entries) {
      if (entry.exists !== true) continue
      ensureStrict(
        !entry.resolved.startsWith('/') && !entry.resolved.split('/').includes('..'),
        `escaping resolved path ${entry.resolved}`,
      )
      const absolute = join(payloadRoot, entry.resolved)
      ensureStrict(existsSync(absolute), `${entry.file}:${entry.line} resolved reference missing: ${entry.resolved}`)
      if (entry.classification === 'directory') resolvedDirectories += 1
      else resolvedFiles += 1
    }
    equalStrict(resolvedFiles + resolvedDirectories, REFERENCE_INDEX.resolved, 'verified resolved references')
    ensureStrict(resolvedFiles > 2000, `only ${resolvedFiles} resolved file references`)
    const unresolved = index.entries.filter((entry) => entry.exists === false && entry.classification === 'file')
    equalStrict(unresolved.length, REFERENCE_INDEX.missing, 'unresolved file entries')
    for (const missing of index.missing) {
      ensureStrict(
        unresolved.some((entry) => entry.raw === missing.raw && entry.resolved === missing.resolved),
        `missing[] not backed by an entry: ${missing.raw}`,
      )
      ensureStrict(!existsSync(join(payloadRoot, missing.resolved)), `missing[] target exists: ${missing.resolved}`)
    }
    return `${REFERENCE_INDEX.references} refs, ${REFERENCE_INDEX.resolved} resolved (${resolvedFiles} files + ${resolvedDirectories} dirs verified on disk), ${REFERENCE_INDEX.missing} unresolved`
  })

  run('guard fixtures and phase manifest', () => {
    const manifest = readJsonStrict(
      join(payloadRoot, 'scripts', 'ars_phase_scope_manifest.json'),
      'manifest',
    )
    equalStrict(Object.keys(manifest.agents).length, 23, 'manifest agent count')
    const fixture = readJsonStrict(
      join(payloadRoot, 'scripts', 'fixtures', 'write_scope_guard', 'captured_payloads.json'),
      'fixtures',
    )
    equalStrict(fixture.cases.length, 3, 'fixture cases')
    return '23 bucket-A scopes; 3 captured payload fixtures'
  })

  return {
    checks,
    inventory: payload,
    provenance,
    index,
    summary: {
      files: provenance.totals.files,
      bytes: provenance.totals.bytes,
      directories: provenance.totals.directories,
      commit: provenance.upstream.commit,
      pluginVersion: provenance.upstream.pluginVersion,
      generatedAt: provenance.generatedAt,
      references: index.summary.references,
      resolved: index.summary.resolved,
      missing: index.summary.missing,
    },
  }
}

// Reserved for tests that import this module.
export const checkerInternals = Object.freeze({})
