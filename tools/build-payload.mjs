#!/usr/bin/env node
/**
 * Deterministic runtime-payload builder for academic-research-skills-dsh.
 *
 * Copies the pinned upstream checkout into `payload/` with the repository
 * layout preserved verbatim, then writes two generated metadata files:
 *
 *   payload/PROVENANCE.json       upstream identity, exclusion manifest,
 *                                 per-top-level counts and content digests
 *   payload/REFERENCE-INDEX.json  every Markdown path reference found in the
 *                                 payload, resolved against the two upstream
 *                                 conventions (plus the documented fallbacks)
 *
 * Guarantees:
 *   - byte-for-byte copies (verified with SHA-256 after every write)
 *   - file modes preserved (executable bits included)
 *   - no symlinks are followed or created; they are refused and reported
 *   - stale files from a previous build are pruned, so the tree is an exact
 *     mirror of the include manifest
 *   - `generatedAt` is derived from SOURCE_DATE_EPOCH when set, otherwise from
 *     the pinned upstream commit date. It is never wall-clock time.
 *   - idempotent: a second run with the same environment reuses every file and
 *     leaves the whole payload digest unchanged (reported at the end)
 *
 * Run from anywhere:
 *   node tools/build-payload.mjs
 *
 * Node 24 ESM, built-in modules only.
 */

import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BY_TOP_LEVEL,
  CRITICAL_EXPECTATIONS,
  GENERATED_ARTIFACT_DIRECTORIES,
  GENERATED_ARTIFACT_FILE_PATTERNS,
  GENERATED_FILES,
  INCLUDED_DIRECTORIES,
  INCLUDED_FILES,
  PAYLOAD_SNAPSHOT,
  SCHEMA_VERSION,
  SKILL_NAMES,
  TOOL_NAME,
  TOOL_VERSION,
  UPSTREAM,
  distributionFileExclusionReason,
  exclusionReason,
  localizedReadmeReason,
} from '../lib/payload-contract.js'

// Re-exported for compatibility; lib/payload-contract.js is the single owner of
// the upstream identity, the include/exclude declarations, and the pins.
export {
  BY_TOP_LEVEL,
  CRITICAL_EXPECTATIONS,
  GENERATED_FILES,
  INCLUDED_DIRECTORIES,
  INCLUDED_FILES,
  SCHEMA_VERSION,
  SKILL_NAMES,
  TOOL_NAME,
  TOOL_VERSION,
  UPSTREAM,
}

/** Plugin package root (this file is `<pluginRoot>/tools/build-payload.mjs`). */
export const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))
/** Generated payload root. */
export const PAYLOAD_ROOT = join(PLUGIN_ROOT, 'payload')
/** Sibling upstream checkout expected by the developer build. */
export const DEFAULT_UPSTREAM_ROOT = process.env.ARS_UPSTREAM_ROOT
  ? resolve(process.env.ARS_UPSTREAM_ROOT)
  : fileURLToPath(new URL('../../repo', import.meta.url))

/** Prefixes that may resolve against a skill directory (own-skill-relative). */
const SKILL_LOCAL_PREFIXES = Object.freeze(['references', 'agents', 'templates', 'examples'])

/** Every path prefix scanned in Markdown (see the task interface). */
const REFERENCE_PREFIXES = Object.freeze([
  'references',
  'templates',
  'examples',
  'agents',
  'shared',
  'scripts',
  'docs',
  'tools',
])

// Excluded top-level entries, localized README handling, and ignored
// working-tree artifacts are declared in lib/payload-contract.js.

const REFERENCE_CONVENTIONS = Object.freeze({
  'own-skill-relative':
    'Inside a skill directory, references/, agents/, templates/ and examples/ resolve against that skill directory. ' +
    'scripts/ also resolves there when the skill ships its own scripts/ directory (sr-screener).',
  'payload-root-relative':
    'shared/, scripts/, docs/, tools/, MODE_REGISTRY.md and <skill-name>/... resolve against the payload root.',
  'claude-plugin-root':
    '${CLAUDE_PLUGIN_ROOT}/... resolves against the payload root (the Claude Code variable is expanded away).',
  'skill-mirror':
    'A root-level agents/<name>.md that mirrors exactly one <skill>/agents/<name>.md resolves its skill-local ' +
    'references against that mirrored skill.',
  'file-relative-link':
    'A Markdown link target that fails the primary convention is also tried relative to the containing file; ' +
    'upstream shared/ documents link this way.',
})

const RESOLUTION_ORDER = Object.freeze([
  'claude-plugin-root',
  'own-skill-relative',
  'payload-root-relative',
  'skill-mirror (fallback)',
  'file-relative-link (fallback)',
])

/* ------------------------------------------------------------------------- *
 * Small deterministic helpers
 * ------------------------------------------------------------------------- */

/** POSIX-style relative path. */
export function toPosix(path) {
  return path.split(sep).join('/')
}

/** Bytewise string comparison (locale-independent). */
export function compareBytes(left, right) {
  return Buffer.compare(Buffer.from(String(left), 'utf8'), Buffer.from(String(right), 'utf8'))
}

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function modeString(mode) {
  return (mode & 0o777).toString(8).padStart(3, '0')
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Fail unless `target` is strictly inside `root`. */
export function assertInside(root, target) {
  const rel = relative(root, target)
  if (rel.length === 0 || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`refusing path outside ${root}: ${target}`)
  }
  return rel
}

function topLevelKey(relPath) {
  const head = relPath.split('/')[0]
  return INCLUDED_DIRECTORIES.includes(head) ? head : '.'
}

function areaOf(file) {
  const head = file.split('/')[0]
  return INCLUDED_DIRECTORIES.includes(head) ? head : '(root)'
}

function sortedObject(entries) {
  return Object.fromEntries([...entries].sort(([left], [right]) => compareBytes(left, right)))
}

/* ------------------------------------------------------------------------- *
 * Upstream verification and timestamp derivation
 * ------------------------------------------------------------------------- */

/** Read the commit hash from a (possibly packed) `.git` directory without git. */
export function readHeadCommit(repoRoot) {
  const gitDir = join(repoRoot, '.git')
  const headPath = join(gitDir, 'HEAD')
  if (!existsSync(headPath)) {
    throw new Error(`upstream checkout has no .git directory: ${repoRoot}`)
  }
  const head = readFileSync(headPath, 'utf8').trim()
  if (!head.startsWith('ref: ')) {
    if (!/^[a-f0-9]{40}$/u.test(head)) throw new Error(`unexpected .git/HEAD content: ${head}`)
    return head
  }
  const ref = head.slice('ref: '.length).trim()
  const refPath = join(gitDir, ...ref.split('/'))
  if (existsSync(refPath)) return readFileSync(refPath, 'utf8').trim()
  const packedPath = join(gitDir, 'packed-refs')
  if (existsSync(packedPath)) {
    for (const line of readFileSync(packedPath, 'utf8').split('\n')) {
      if (line.length === 0 || line.startsWith('#') || line.startsWith('^')) continue
      const [hash, name] = line.trim().split(/\s+/u)
      if (name === ref) return hash
    }
  }
  throw new Error(`cannot resolve ${ref} in ${gitDir}`)
}

/**
 * Derive the deterministic `generatedAt` value.
 *
 * SOURCE_DATE_EPOCH wins when present (standard reproducible-build override).
 * Otherwise the pinned upstream commit date is used. Wall-clock time is never
 * consulted.
 */
export function resolveGeneratedAt(env = process.env) {
  const raw = env.SOURCE_DATE_EPOCH
  if (raw !== undefined && raw !== '') {
    if (!/^\d+$/u.test(raw)) {
      throw new Error(`SOURCE_DATE_EPOCH must be a non-negative integer, got ${JSON.stringify(raw)}`)
    }
    const seconds = Number(raw)
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
      throw new Error(`SOURCE_DATE_EPOCH is out of range: ${raw}`)
    }
    const date = new Date(seconds * 1000)
    if (Number.isNaN(date.getTime())) throw new Error(`SOURCE_DATE_EPOCH is out of range: ${raw}`)
    return { generatedAt: date.toISOString(), generatedAtSource: 'SOURCE_DATE_EPOCH' }
  }
  const date = new Date(Date.parse(UPSTREAM.commitDate))
  if (Number.isNaN(date.getTime())) throw new Error(`invalid pinned commit date: ${UPSTREAM.commitDate}`)
  return { generatedAt: date.toISOString(), generatedAtSource: 'git-commit-date' }
}

/**
 * Verify that the checkout is the pinned commit and that the expected runtime
 * layout is present. Throws with an actionable message otherwise.
 */
export function verifyUpstream(repoRoot = DEFAULT_UPSTREAM_ROOT) {
  if (!existsSync(repoRoot)) {
    throw new Error(
      `upstream checkout not found at ${repoRoot}; clone ${UPSTREAM.repositoryGit} and check out ${UPSTREAM.commit}`,
    )
  }
  const commit = readHeadCommit(repoRoot)
  if (commit !== UPSTREAM.commit) {
    throw new Error(
      `upstream checkout is at ${commit}, expected ${UPSTREAM.commit}. ` +
        'Check out the pinned commit or update UPSTREAM.commit in lib/payload-contract.js.',
    )
  }
  const manifestPath = join(repoRoot, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifestPath)) throw new Error(`missing upstream plugin manifest: ${manifestPath}`)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`cannot parse ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (manifest.name !== UPSTREAM.pluginName) {
    throw new Error(`unexpected upstream plugin name: ${manifest.name}`)
  }
  if (manifest.version !== UPSTREAM.pluginVersion) {
    throw new Error(`upstream plugin version is ${manifest.version}, expected ${UPSTREAM.pluginVersion}`)
  }
  if (manifest.license !== UPSTREAM.license) {
    throw new Error(`upstream license is ${manifest.license}, expected ${UPSTREAM.license}`)
  }

  const failures = []
  for (const skill of SKILL_NAMES) {
    if (!existsSync(join(repoRoot, skill, 'SKILL.md'))) failures.push(`${skill}/SKILL.md`)
  }
  const commandFiles = readdirSync(join(repoRoot, 'commands')).filter((name) => name.endsWith('.md'))
  if (commandFiles.length !== CRITICAL_EXPECTATIONS.commands) {
    failures.push(`commands/*.md count ${commandFiles.length} != ${CRITICAL_EXPECTATIONS.commands}`)
  }
  const agentFiles = readdirSync(join(repoRoot, 'agents')).filter((name) => name.endsWith('.md'))
  if (agentFiles.length !== CRITICAL_EXPECTATIONS.agents) {
    failures.push(`agents/*.md count ${agentFiles.length} != ${CRITICAL_EXPECTATIONS.agents}`)
  }
  if (failures.length > 0) {
    throw new Error(`upstream layout check failed:\n - ${failures.join('\n - ')}`)
  }
  return {
    commit,
    commitDate: UPSTREAM.commitDate,
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    license: manifest.license,
    commandCount: commandFiles.length,
    agentCount: agentFiles.length,
  }
}

/* ------------------------------------------------------------------------- *
 * Source collection and copying
 * ------------------------------------------------------------------------- */

function walkSourceDirectory(repoRoot, relDir, files, symlinks, unsupported, skippedArtifacts) {
  const absDir = join(repoRoot, relDir)
  const entries = readdirSync(absDir, { withFileTypes: true }).sort((left, right) =>
    compareBytes(left.name, right.name),
  )
  for (const entry of entries) {
    const absolute = join(absDir, entry.name)
    const rel = `${relDir}/${entry.name}`
    let stat
    try {
      stat = lstatSync(absolute)
    } catch (error) {
      throw new Error(`cannot stat ${absolute}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (stat.isSymbolicLink()) {
      symlinks.push({ path: rel, target: readlinkSync(absolute), scope: 'included' })
      continue
    }
    if (stat.isDirectory()) {
      if (GENERATED_ARTIFACT_DIRECTORIES.includes(entry.name)) {
        skippedArtifacts.push({ path: rel, reason: 'generated working-tree artifact directory' })
        continue
      }
      walkSourceDirectory(repoRoot, rel, files, symlinks, unsupported, skippedArtifacts)
      continue
    }
    if (!stat.isFile()) {
      unsupported.push({ path: rel, reason: 'not a regular file' })
      continue
    }
    if (GENERATED_ARTIFACT_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) {
      skippedArtifacts.push({ path: rel, reason: 'generated working-tree artifact file' })
      continue
    }
    files.push({ path: rel, absolute, bytes: stat.size, mode: stat.mode & 0o777 })
  }
}

/** Collect every file from the include manifest, refusing symlinks. */
export function collectSourceEntries(repoRoot = DEFAULT_UPSTREAM_ROOT) {
  const files = []
  const symlinks = []
  const unsupported = []
  const skippedArtifacts = []
  for (const directory of INCLUDED_DIRECTORIES) {
    const absolute = join(repoRoot, directory)
    if (!existsSync(absolute)) throw new Error(`missing included upstream directory: ${directory}`)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) throw new Error(`included upstream directory is a symlink: ${directory}`)
    if (!stat.isDirectory()) throw new Error(`included upstream path is not a directory: ${directory}`)
    walkSourceDirectory(repoRoot, directory, files, symlinks, unsupported, skippedArtifacts)
  }
  for (const file of INCLUDED_FILES) {
    const absolute = join(repoRoot, file)
    if (!existsSync(absolute)) throw new Error(`missing included upstream file: ${file}`)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) {
      symlinks.push({ path: file, target: readlinkSync(absolute), scope: 'included' })
      continue
    }
    if (!stat.isFile()) throw new Error(`included upstream path is not a regular file: ${file}`)
    files.push({ path: file, absolute, bytes: stat.size, mode: stat.mode & 0o777 })
  }
  files.sort((left, right) => compareBytes(left.path, right.path))
  const excludedFiles = []
  const kept = []
  for (const file of files) {
    const reason = distributionFileExclusionReason(file.path)
    if (reason === undefined) kept.push(file)
    else excludedFiles.push({ path: file.path, kind: 'file', reason })
  }
  files.length = 0
  files.push(...kept)
  for (const file of files) file.sha256 = sha256File(file.absolute)
  return { files, symlinks, unsupported, skippedArtifacts, excludedFiles }
}

/** Every top-level entry that the include manifest leaves out, with a reason. */
export function describeExclusions(repoRoot = DEFAULT_UPSTREAM_ROOT, refusedSymlinks = []) {
  const included = new Set([...INCLUDED_DIRECTORIES, ...INCLUDED_FILES])
  const entries = readdirSync(repoRoot, { withFileTypes: true }).sort((left, right) =>
    compareBytes(left.name, right.name),
  )
  const excluded = []
  for (const entry of entries) {
    if (included.has(entry.name)) continue
    const absolute = join(repoRoot, entry.name)
    let stat
    try {
      stat = lstatSync(absolute)
    } catch {
      continue
    }
    const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file'
    let reason = exclusionReason(entry.name)
    if (reason === undefined) {
      const localized = localizedReadmeReason(entry.name)
      if (localized !== null) reason = localized
    }
    if (reason === undefined) reason = 'not in the runtime payload include manifest'
    const record = { path: entry.name, kind, reason }
    if (kind === 'symlink') {
      record.target = readlinkSync(absolute)
      const refused = refusedSymlinks.find((item) => item.path === entry.name)
      if (refused !== undefined) record.target = refused.target
    }
    excluded.push(record)
  }
  return excluded
}

/** Report symlinks anywhere in the upstream tree that the build refuses. */
export function describeRefusedSymlinks(repoRoot = DEFAULT_UPSTREAM_ROOT) {
  const refused = []
  const skillsDir = join(repoRoot, 'skills')
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true }).sort((left, right) =>
      compareBytes(left.name, right.name),
    )) {
      const absolute = join(skillsDir, entry.name)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) {
        refused.push({
          path: `skills/${entry.name}`,
          target: readlinkSync(absolute),
          reason: 'symlink refused; the target top-level skill directory is copied directly',
        })
      }
    }
  }
  return refused
}

function ensureDirectory(absolute) {
  mkdirSync(absolute, { recursive: true, mode: 0o755 })
  chmodSync(absolute, 0o755)
}

/** Copy the collected source files into the payload (idempotent). */
export function copyPayload(files, payloadRoot = PAYLOAD_ROOT) {
  if (existsSync(payloadRoot)) {
    const stat = lstatSync(payloadRoot)
    if (stat.isSymbolicLink()) throw new Error(`payload root is a symlink: ${payloadRoot}`)
    if (!stat.isDirectory()) throw new Error(`payload root is not a directory: ${payloadRoot}`)
  } else {
    ensureDirectory(payloadRoot)
  }
  const directories = new Set()
  for (const file of files) {
    const parent = posix.dirname(file.path)
    if (parent !== '.') directories.add(parent)
  }
  for (const directory of [...directories].sort((left, right) => {
    const depth = left.split('/').length - right.split('/').length
    return depth === 0 ? compareBytes(left, right) : depth
  })) {
    ensureDirectory(join(payloadRoot, ...directory.split('/')))
  }
  let copied = 0
  let reused = 0
  let modesFixed = 0
  for (const file of files) {
    const destination = join(payloadRoot, ...file.path.split('/'))
    assertInside(payloadRoot, destination)
    let reusedFile = false
    if (existsSync(destination)) {
      const stat = lstatSync(destination)
      if (stat.isFile() && stat.size === file.bytes && sha256File(destination) === file.sha256) {
        reusedFile = true
        reused += 1
        if ((stat.mode & 0o777) !== file.mode) {
          chmodSync(destination, file.mode)
          modesFixed += 1
        }
      }
    }
    if (!reusedFile) {
      copyFileSync(file.absolute, destination)
      chmodSync(destination, file.mode)
      copied += 1
    }
    if (sha256File(destination) !== file.sha256) {
      throw new Error(`byte-for-byte copy verification failed: ${file.path}`)
    }
    if ((lstatSync(destination).mode & 0o777) !== file.mode) {
      throw new Error(`mode preservation failed: ${file.path}`)
    }
  }
  return { copied, reused, modesFixed, directories: directories.size }
}

/**
 * Remove files from the payload that are not in the current include manifest or
 * generated-file set, then remove empty directories. Refuses to touch anything
 * outside `payloadRoot`.
 */
export function prunePayload(payloadRoot = PAYLOAD_ROOT, keepPaths = []) {
  const result = { removedFiles: [], removedDirectories: [], removedSymlinks: [] }
  if (!existsSync(payloadRoot)) return result
  const keep = new Set(keepPaths)
  const walk = (absolute, rel) => {
    const entries = readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
      compareBytes(left.name, right.name),
    )
    for (const entry of entries) {
      const child = join(absolute, entry.name)
      const childRel = rel === '.' ? entry.name : `${rel}/${entry.name}`
      const stat = lstatSync(child)
      if (stat.isSymbolicLink()) {
        assertInside(payloadRoot, child)
        unlinkSync(child)
        result.removedSymlinks.push(childRel)
        continue
      }
      if (stat.isDirectory()) {
        walk(child, childRel)
        if (readdirSync(child).length === 0) {
          assertInside(payloadRoot, child)
          rmdirSync(child)
          result.removedDirectories.push(childRel)
        }
        continue
      }
      if (!keep.has(childRel)) {
        assertInside(payloadRoot, child)
        unlinkSync(child)
        result.removedFiles.push(childRel)
      }
    }
  }
  walk(payloadRoot, '.')
  return result
}

/* ------------------------------------------------------------------------- *
 * Inventory, digests and PROVENANCE
 * ------------------------------------------------------------------------- */

/** Walk the payload and describe every regular file (excluding generated files). */
export function collectPayloadInventory(payloadRoot = PAYLOAD_ROOT, exclude = GENERATED_FILES) {
  const excluded = new Set(exclude)
  const files = []
  const symlinks = []
  const unsupported = []
  const walk = (absolute, rel) => {
    const entries = readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
      compareBytes(left.name, right.name),
    )
    for (const entry of entries) {
      const child = join(absolute, entry.name)
      const childRel = rel === '.' ? entry.name : `${rel}/${entry.name}`
      if (excluded.has(childRel)) continue
      const stat = lstatSync(child)
      if (stat.isSymbolicLink()) {
        symlinks.push({ path: childRel, target: readlinkSync(child) })
        continue
      }
      if (stat.isDirectory()) {
        walk(child, childRel)
        continue
      }
      if (!stat.isFile()) {
        unsupported.push({ path: childRel, reason: 'not a regular file' })
        continue
      }
      files.push({
        path: childRel,
        bytes: stat.size,
        mode: stat.mode & 0o777,
        sha256: sha256File(child),
      })
    }
  }
  if (existsSync(payloadRoot)) walk(payloadRoot, '.')
  files.sort((left, right) => compareBytes(left.path, right.path))
  return { files, symlinks, unsupported }
}

function pathListDigest(paths) {
  return sha256Text(paths.map((path) => `${path}\n`).join(''))
}

function contentDigest(files) {
  const lines = files.map((file) => `${file.path}\u0000${file.sha256}\u0000${modeString(file.mode)}\n`)
  return sha256Text(lines.join(''))
}

function summarizeFiles(files) {
  const sorted = [...files].sort((left, right) => compareBytes(left.path, right.path))
  const modes = new Map()
  for (const file of sorted) {
    const key = modeString(file.mode)
    modes.set(key, (modes.get(key) ?? 0) + 1)
  }
  return {
    files: sorted.length,
    bytes: sorted.reduce((sum, file) => sum + file.bytes, 0),
    pathListSha256: pathListDigest(sorted.map((file) => file.path)),
    contentSha256: contentDigest(sorted),
    modes: sortedObject(modes),
  }
}

/** Group a file inventory by top-level payload entry (`"."` for root files). */
export function buildInventory(files) {
  const groups = new Map()
  for (const file of files) {
    const key = topLevelKey(file.path)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(file)
  }
  const order = [...INCLUDED_DIRECTORIES, '.']
  const byTopLevel = {}
  for (const key of order) {
    if (!groups.has(key)) continue
    byTopLevel[key] = summarizeFiles(groups.get(key))
  }
  const all = [...files].sort((left, right) => compareBytes(left.path, right.path))
  const summary = summarizeFiles(all)
  // Count every directory under the payload root (git tracks no empty dirs, so
  // the ancestor closure of all file paths is the complete directory list).
  const directories = new Set()
  for (const file of all) {
    let directory = posix.dirname(file.path)
    while (directory !== '.' && directory !== '') {
      directories.add(directory)
      directory = posix.dirname(directory)
    }
  }
  const directoryCount = directories.size
  return {
    totals: {
      files: summary.files,
      bytes: summary.bytes,
      directories: directoryCount,
      modes: summary.modes,
    },
    pathListSha256: summary.pathListSha256,
    contentSha256: summary.contentSha256,
    executableFiles: all
      .filter((file) => (file.mode & 0o111) !== 0)
      .map((file) => file.path)
      .sort(compareBytes),
    byTopLevel,
  }
}

/** Whole-tree digest (paths, modes, file hashes, directories) for idempotence. */
export function digestTree(root) {
  if (!existsSync(root)) return null
  const rows = []
  let files = 0
  let bytes = 0
  const walk = (absolute, rel) => {
    const entries = readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
      compareBytes(left.name, right.name),
    )
    for (const entry of entries) {
      const child = join(absolute, entry.name)
      const childRel = rel === '.' ? entry.name : `${rel}/${entry.name}`
      const stat = lstatSync(child)
      if (stat.isSymbolicLink()) {
        rows.push(`L\u0000${childRel}\u0000${readlinkSync(child)}\n`)
        continue
      }
      if (stat.isDirectory()) {
        rows.push(`D\u0000${modeString(stat.mode)}\u0000${childRel}\n`)
        walk(child, childRel)
        continue
      }
      if (!stat.isFile()) {
        rows.push(`X\u0000${childRel}\n`)
        continue
      }
      files += 1
      bytes += stat.size
      rows.push(`F\u0000${modeString(stat.mode)}\u0000${sha256File(child)}\u0000${childRel}\n`)
    }
  }
  walk(root, '.')
  rows.sort(compareBytes)
  return { sha256: sha256Text(rows.join('')), files, bytes }
}

/** Build the full PROVENANCE.json object. */
export function buildProvenance({
  files,
  inventory,
  generatedAt,
  generatedAtSource,
  upstreamInfo,
  repoRoot = DEFAULT_UPSTREAM_ROOT,
  refusedSymlinks,
  skippedArtifacts = [],
  excludedFiles = [],
}) {
  const excluded = [...describeExclusions(repoRoot, refusedSymlinks), ...excludedFiles].sort((left, right) =>
    compareBytes(left.path, right.path),
  )
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    toolVersion: TOOL_VERSION,
    generatedAt,
    generatedAtSource,
    upstream: {
      repository: UPSTREAM.repository,
      repositoryGit: UPSTREAM.repositoryGit,
      commit: upstreamInfo.commit,
      commitDate: upstreamInfo.commitDate,
      pluginName: upstreamInfo.pluginName,
      pluginVersion: upstreamInfo.pluginVersion,
      license: upstreamInfo.license,
      author: UPSTREAM.author,
      homepage: UPSTREAM.homepage,
      checkout: UPSTREAM.checkout,
    },
    payload: {
      layout:
        'upstream repository layout preserved; four third-party page mirrors are excluded (see excluded[]); skills live at <payload>/<skill>/',
      generated: [...GENERATED_FILES],
      skillOrder: [...SKILL_NAMES],
      included: {
        directories: [...INCLUDED_DIRECTORIES],
        files: [...INCLUDED_FILES],
        fileCount: files.length,
      },
      pinned: {
        contentSha256: PAYLOAD_SNAPSHOT.contentSha256,
        pathListSha256: PAYLOAD_SNAPSHOT.pathListSha256,
      },
      excluded,
      symlinksRefused: refusedSymlinks,
      generatedArtifactsSkipped: skippedArtifacts,
    },
    totals: inventory.totals,
    pathListSha256: inventory.pathListSha256,
    contentSha256: inventory.contentSha256,
    executableFiles: inventory.executableFiles,
    byTopLevel: inventory.byTopLevel,
  }
}

/* ------------------------------------------------------------------------- *
 * REFERENCE-INDEX.json
 * ------------------------------------------------------------------------- */

const SKILL_ALTERNATION = [...SKILL_NAMES]
  .sort((left, right) => right.length - left.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
  .join('|')

const REFERENCE_PATTERN = new RegExp(
  [
    '(?<![A-Za-z0-9_./-])',
    '(\\$\\{CLAUDE_PLUGIN_ROOT\\}|\\$CLAUDE_PLUGIN_ROOT\\/)?',
    '((?:',
    REFERENCE_PREFIXES.join('|'),
    ')\\/[A-Za-z0-9_./-]+|MODE_REGISTRY\\.md|(?:',
    SKILL_ALTERNATION,
    ')\\/[A-Za-z0-9_./-]+)',
  ].join(''),
  'gu',
)

const PLACEHOLDER_PATTERNS = Object.freeze([
  /\.\.\./u,
  /[<>{}*…]/u,
  /[_/-]$/u,
])

const TRAILING_PUNCTUATION = /[.,;:)\]}>!?'"`]+$/u

function lineIndex(text) {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return (offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (starts[middle] <= offset) low = middle
      else high = middle - 1
    }
    return low + 1
  }
}

function codeBlockLines(text) {
  const lines = text.split('\n')
  const flags = new Array(lines.length).fill(false)
  let fence = false
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(```|~~~)/u.test(lines[index])) {
      fence = !fence
      flags[index] = true
    } else {
      flags[index] = fence
    }
  }
  return flags
}

/** Convert a captured reference into a payload-relative candidate. */
function relativeCandidate(payloadRoot, baseDir, reference) {
  const normalized = posix.normalize(posix.join(baseDir, reference))
  if (normalized === '..' || normalized.startsWith('../') || posix.isAbsolute(normalized)) return null
  const absolute = join(payloadRoot, ...normalized.split('/'))
  try {
    assertInside(payloadRoot, absolute)
  } catch {
    return null
  }
  return { path: normalized, absolute }
}

function existsPath(payloadRoot, reference) {
  const normalized = posix.normalize(reference)
  if (normalized === '..' || normalized.startsWith('../') || posix.isAbsolute(normalized)) return null
  const absolute = join(payloadRoot, ...normalized.split('/'))
  try {
    assertInside(payloadRoot, absolute)
  } catch {
    return null
  }
  return existsSync(absolute) ? { path: normalized, absolute } : null
}

function primaryResolution({ reference, claudePluginRoot, containingFile }) {
  if (claudePluginRoot) {
    return { resolved: reference, convention: 'claude-plugin-root' }
  }
  if (SKILL_NAMES.some((skill) => reference === skill || reference.startsWith(`${skill}/`))) {
    return { resolved: reference, convention: 'payload-root-relative' }
  }
  const skill = SKILL_NAMES.find((name) => containingFile.startsWith(`${name}/`))
  const prefix = reference.split('/')[0]
  if (skill !== undefined && SKILL_LOCAL_PREFIXES.includes(prefix)) {
    return { resolved: `${skill}/${reference}`, convention: 'own-skill-relative' }
  }
  return { resolved: reference, convention: 'payload-root-relative' }
}

function resolveReference({ payloadRoot, reference, claudePluginRoot, containingFile, markdownLink }) {
  const primary = primaryResolution({ reference, claudePluginRoot, containingFile })
  const primaryExists = existsPath(payloadRoot, primary.resolved)
  if (primaryExists !== null) {
    return { resolved: primary.resolved, convention: primary.convention, exists: true, absolute: primaryExists.absolute }
  }
  // sr-screener ships its own scripts/ directory; upstream prose says
  // "scripts live in this skill's scripts/ folder".
  const skill = SKILL_NAMES.find((name) => containingFile.startsWith(`${name}/`))
  if (skill !== undefined && reference.startsWith('scripts/')) {
    const candidate = existsPath(payloadRoot, `${skill}/${reference}`)
    if (candidate !== null) {
      return { resolved: `${skill}/${reference}`, convention: 'own-skill-relative', exists: true, absolute: candidate.absolute }
    }
  }
  // Root-level agents/*.md mirror one skill's agents/<name>.md.
  if (containingFile.startsWith('agents/') && containingFile.endsWith('.md')) {
    const basename = posix.basename(containingFile)
    const mirrors = SKILL_NAMES.filter((name) => existsSync(join(payloadRoot, name, 'agents', basename)))
    if (mirrors.length === 1) {
      const candidate = relativeCandidate(payloadRoot, mirrors[0], reference)
      if (candidate !== null && existsSync(candidate.absolute)) {
        return { resolved: candidate.path, convention: 'skill-mirror', exists: true, absolute: candidate.absolute }
      }
    }
  }
  // Upstream shared/ documents use ordinary relative Markdown links.
  if (markdownLink) {
    const candidate = relativeCandidate(payloadRoot, posix.dirname(containingFile), reference)
    if (candidate !== null && existsSync(candidate.absolute)) {
      return { resolved: candidate.path, convention: 'file-relative-link', exists: true, absolute: candidate.absolute }
    }
  }
  return { resolved: primary.resolved, convention: primary.convention, exists: false, absolute: null }
}

function isPlaceholder(reference) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(reference))
}

function hasFileExtension(reference) {
  return posix.basename(reference).includes('.')
}

function listMarkdownFiles(payloadRoot) {
  const files = []
  const walk = (absolute, rel) => {
    const entries = readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
      compareBytes(left.name, right.name),
    )
    for (const entry of entries) {
      const child = join(absolute, entry.name)
      const childRel = rel === '.' ? entry.name : `${rel}/${entry.name}`
      const stat = lstatSync(child)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) {
        walk(child, childRel)
        continue
      }
      if (stat.isFile() && childRel.endsWith('.md')) files.push(childRel)
    }
  }
  if (existsSync(payloadRoot)) walk(payloadRoot, '.')
  return files.sort(compareBytes)
}

/**
 * Scan every Markdown file in the payload and resolve each path reference.
 *
 * Two conventions are primary:
 *   - own-skill-relative  (references/, agents/, templates/, examples/ in a skill)
 *   - payload-root-relative (shared/, scripts/, docs/, tools/, MODE_REGISTRY.md,
 *     other skill names)
 * `${CLAUDE_PLUGIN_ROOT}/` is expanded to the payload root. Two narrow
 * fallbacks (skill-mirror, file-relative Markdown links) are documented in the
 * generated file and used only when the primary resolution misses.
 *
 * Missing references are reported and never rewritten.
 */
export function buildReferenceIndex({
  payloadRoot = PAYLOAD_ROOT,
  generatedAt,
  upstream = { commit: UPSTREAM.commit, pluginVersion: UPSTREAM.pluginVersion },
} = {}) {
  if (typeof generatedAt !== 'string' || generatedAt.length === 0) {
    throw new Error('buildReferenceIndex requires a generatedAt value')
  }
  const markdownFiles = listMarkdownFiles(payloadRoot)
  const entries = new Map()
  const areaFiles = new Map()
  let matches = 0
  let skipped = 0

  for (const file of markdownFiles) {
    const area = areaOf(file)
    areaFiles.set(area, (areaFiles.get(area) ?? 0) + 1)
    const text = readFileSync(join(payloadRoot, ...file.split('/')), 'utf8')
    const lineOf = lineIndex(text)
    const inCode = codeBlockLines(text)
    REFERENCE_PATTERN.lastIndex = 0
    for (const match of text.matchAll(REFERENCE_PATTERN)) {
      matches += 1
      const rawFull = match[0]
      const claudePluginRoot = match[1] !== undefined
      let reference = match[2]
      const fragment = reference.indexOf('#')
      if (fragment >= 0) reference = reference.slice(0, fragment)
      reference = reference.replace(TRAILING_PUNCTUATION, '')
      if (reference.length === 0 || reference.endsWith('/')) {
        skipped += 1
        continue
      }
      const line = lineOf(match.index)
      const insideCode = inCode[line - 1] === true
      const markdownLink =
        match.index >= 2 && text.slice(match.index - 2, match.index) === ']('
      const resolution = resolveReference({
        payloadRoot,
        reference,
        claudePluginRoot,
        containingFile: file,
        markdownLink,
      })
      const raw = rawFull.replace(TRAILING_PUNCTUATION, '')
      const key = `${file}\u0000${raw}\u0000${claudePluginRoot ? 'cpr' : 'rel'}`
      const existing = entries.get(key)
      if (existing !== undefined) {
        existing.count += 1
        existing.inCode = existing.inCode && insideCode
        continue
      }
      let classification
      if (resolution.exists) {
        const stat = statSync(resolution.absolute)
        classification = stat.isDirectory() ? 'directory' : 'file'
      } else if (isPlaceholder(reference)) {
        classification = 'placeholder'
      } else if (!hasFileExtension(reference)) {
        classification = 'identifier'
      } else {
        classification = 'file'
      }
      entries.set(key, {
        file,
        area,
        line,
        raw,
        reference,
        resolved: resolution.resolved,
        exists: resolution.exists,
        convention: resolution.convention,
        classification,
        inCode: insideCode,
        count: 1,
      })
    }
  }

  const sortedEntries = [...entries.values()].sort((left, right) => {
    const byFile = compareBytes(left.file, right.file)
    return byFile === 0 ? compareBytes(left.raw, right.raw) : byFile
  })

  const missingGroups = new Map()
  const byArea = new Map()
  const byConvention = new Map()
  const summary = {
    filesScanned: markdownFiles.length,
    matches,
    references: sortedEntries.length,
    skippedDirectoryOrEmpty: skipped,
    resolved: 0,
    missing: 0,
    missingTargets: 0,
    missingOccurrences: 0,
    identifiers: 0,
    placeholders: 0,
    byArea: {},
    byConvention: {},
    missingByArea: {},
  }
  for (const entry of sortedEntries) {
    const area = entry.area
    const bucket = byArea.get(area) ?? { files: areaFiles.get(area) ?? 0, references: 0, resolved: 0, missing: 0 }
    bucket.references += 1
    const conventionBucket = byConvention.get(entry.convention) ?? {
      references: 0,
      resolved: 0,
      missing: 0,
    }
    conventionBucket.references += 1
    if (entry.exists) {
      summary.resolved += 1
      bucket.resolved += 1
      conventionBucket.resolved += 1
    } else if (entry.classification === 'identifier') {
      summary.identifiers += 1
    } else if (entry.classification === 'placeholder') {
      summary.placeholders += 1
    } else {
      summary.missing += 1
      summary.missingOccurrences += entry.count
      bucket.missing += 1
      conventionBucket.missing += 1
      summary.missingByArea[area] = (summary.missingByArea[area] ?? 0) + entry.count
      const groupKey = `${entry.raw}\u0000${entry.resolved}`
      const group = missingGroups.get(groupKey) ?? {
        raw: entry.raw,
        resolved: entry.resolved,
        classification: entry.classification,
        convention: entry.convention,
        inCode: true,
        count: 0,
        files: [],
        areas: [],
      }
      group.count += entry.count
      group.inCode = group.inCode && entry.inCode
      if (!group.files.includes(entry.file)) group.files.push(entry.file)
      if (!group.areas.includes(area)) group.areas.push(area)
      missingGroups.set(groupKey, group)
    }
    byArea.set(area, bucket)
    byConvention.set(entry.convention, conventionBucket)
  }

  const missing = [...missingGroups.values()]
    .map((group) => ({
      raw: group.raw,
      resolved: group.resolved,
      classification: group.classification,
      convention: group.convention,
      inCode: group.inCode,
      count: group.count,
      areas: group.areas.sort(compareBytes),
      files: group.files.sort(compareBytes),
    }))
    .sort((left, right) => right.count - left.count || compareBytes(left.raw, right.raw))

  summary.byArea = Object.fromEntries(
    [...byArea.entries()].sort(([left], [right]) => compareBytes(left, right)),
  )
  summary.byConvention = Object.fromEntries(
    [...byConvention.entries()].sort(([left], [right]) => compareBytes(left, right)),
  )
  summary.missingTargets = missing.length

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    toolVersion: TOOL_VERSION,
    generatedAt,
    upstream: {
      commit: upstream.commit,
      pluginVersion: upstream.pluginVersion,
    },
    conventions: { ...REFERENCE_CONVENTIONS },
    resolutionOrder: [...RESOLUTION_ORDER],
    scan: {
      extensions: ['.md'],
      files: markdownFiles.length,
      areas: Object.fromEntries([...areaFiles.entries()].sort(([left], [right]) => compareBytes(left, right))),
    },
    summary,
    missing,
    entries: sortedEntries,
  }
}

/* ------------------------------------------------------------------------- *
 * Contract verification
 * ------------------------------------------------------------------------- */

/**
 * Fail when a freshly built payload disagrees with the pinned contract in
 * lib/payload-contract.js. The payload bytes must never change silently; a
 * deliberate upstream bump updates the contract and regenerates the payload.
 */
export function verifyContractSnapshot({ inventory, generatedAt, generatedAtSource }) {
  const failures = []
  const compare = (label, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`)
    }
  }
  compare('payload file count', inventory.totals.files, PAYLOAD_SNAPSHOT.files)
  compare('payload byte count', inventory.totals.bytes, PAYLOAD_SNAPSHOT.bytes)
  compare('payload directory count', inventory.totals.directories, PAYLOAD_SNAPSHOT.directories)
  compare('payload mode counts', inventory.totals.modes, PAYLOAD_SNAPSHOT.modes)
  compare('payload contentSha256', inventory.contentSha256, PAYLOAD_SNAPSHOT.contentSha256)
  compare('payload pathListSha256', inventory.pathListSha256, PAYLOAD_SNAPSHOT.pathListSha256)
  for (const [key, expected] of Object.entries(BY_TOP_LEVEL)) {
    const actual = inventory.byTopLevel[key]
    if (actual === undefined) {
      failures.push(`payload group missing: ${key}`)
      continue
    }
    compare(`${key} file count`, actual.files, expected.files)
    compare(`${key} byte count`, actual.bytes, expected.bytes)
  }
  for (const key of Object.keys(inventory.byTopLevel)) {
    if (BY_TOP_LEVEL[key] === undefined) failures.push(`unexpected payload group: ${key}`)
  }
  if (generatedAtSource === PAYLOAD_SNAPSHOT.generatedAtSource) {
    compare('generatedAt', generatedAt, PAYLOAD_SNAPSHOT.generatedAt)
  }
  if (failures.length > 0) {
    throw new Error(
      'built payload does not match lib/payload-contract.js' +
        ` (${UPSTREAM.commit}); update the contract after a deliberate upstream bump:\n - ${failures.join('\n - ')}`,
    )
  }
  return true
}

/* ------------------------------------------------------------------------- *
 * Main
 * ------------------------------------------------------------------------- */

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  // Deterministic metadata mode regardless of the caller's umask.
  chmodSync(path, 0o644)
}

function printReport({ upstreamInfo, generatedAt, generatedAtSource, copy, prune, inventory, provenance, referenceIndex, before, after, idempotent }) {
  const lines = []
  lines.push('ARS payload build')
  lines.push(`  upstream : ${UPSTREAM.repository}`)
  lines.push(`             commit ${upstreamInfo.commit} (${upstreamInfo.pluginVersion})`)
  lines.push(`  payload  : ${PAYLOAD_ROOT}`)
  lines.push(`  timestamp: ${generatedAt} (${generatedAtSource}; not wall-clock)`)
  lines.push(
    `  copied   : ${copy.copied} written, ${copy.reused} reused, ${copy.modesFixed} modes fixed; ` +
      `${inventory.totals.files} files, ${formatBytes(inventory.totals.bytes)}, ${inventory.totals.directories} directories`,
  )
  lines.push(
    `  pruned   : ${prune.removedFiles.length} stale files, ${prune.removedDirectories.length} empty dirs, ` +
      `${prune.removedSymlinks.length} payload symlinks`,
  )
  const refused = provenance.payload.symlinksRefused.length
  lines.push(`  symlinks : ${refused} refused${refused > 0 ? ` (${provenance.payload.symlinksRefused.map((item) => item.path).join(', ')})` : ''}`)
  const skippedArtifacts = provenance.payload.generatedArtifactsSkipped ?? []
  if (skippedArtifacts.length > 0) {
    lines.push(
      `  skipped  : ${skippedArtifacts.length} generated working-tree artifacts ` +
        `(${skippedArtifacts.map((item) => item.path).slice(0, 5).join(', ')}${skippedArtifacts.length > 5 ? ', ...' : ''})`,
    )
  }
  lines.push('  per top level:')
  for (const [key, value] of Object.entries(inventory.byTopLevel)) {
    const label = key === '.' ? '(root)' : key
    lines.push(
      `    ${label.padEnd(28)} ${String(value.files).padStart(5)} files  ${formatBytes(value.bytes).padStart(9)}  ${value.pathListSha256.slice(0, 12)}`,
    )
  }
  const summary = referenceIndex.summary
  lines.push(
    `  references: ${summary.filesScanned} Markdown files, ${summary.matches} matches, ` +
      `${summary.references} unique file+raw references, ${summary.resolved} resolved, ` +
      `${summary.missing} missing (${summary.missingOccurrences} occurrences), ` +
      `${summary.identifiers} identifiers, ${summary.placeholders} placeholders`,
  )
  if (referenceIndex.missing.length > 0) {
    lines.push('  top missing:')
    for (const item of referenceIndex.missing.slice(0, 10)) {
      lines.push(`    ${String(item.count).padStart(4)}x  ${item.raw}  [${item.areas.join(', ')}]`)
    }
    if (referenceIndex.missing.length > 10) lines.push(`    ... ${referenceIndex.missing.length - 10} more in REFERENCE-INDEX.json`)
  }
  lines.push(
    `  files    : PROVENANCE.json (${formatBytes(statSync(join(PAYLOAD_ROOT, 'PROVENANCE.json')).size)}), ` +
      `REFERENCE-INDEX.json (${formatBytes(statSync(join(PAYLOAD_ROOT, 'REFERENCE-INDEX.json')).size)})`,
  )
  lines.push(
    `  digest   : ${after === null ? 'missing' : after.sha256.slice(0, 16)} ` +
      `(before: ${before === null ? 'absent' : before.sha256.slice(0, 16)})`,
  )
  lines.push(`  idempotent: ${idempotent ? 'yes — payload unchanged by this run' : 'no — payload was created or changed by this run'}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      'Usage: node tools/build-payload.mjs\n\n' +
        'Copies the pinned upstream checkout into payload/ and regenerates\n' +
        'payload/PROVENANCE.json and payload/REFERENCE-INDEX.json.\n' +
        'Set SOURCE_DATE_EPOCH to override the deterministic timestamp.\n',
    )
    return { ok: true, help: true }
  }
  const before = digestTree(PAYLOAD_ROOT)
  const upstreamInfo = verifyUpstream()
  const { generatedAt, generatedAtSource } = resolveGeneratedAt()
  const { files, symlinks, unsupported, skippedArtifacts, excludedFiles } = collectSourceEntries()
  const refusedSymlinks = [...describeRefusedSymlinks(), ...symlinks]
  const copy = copyPayload(files)
  const keep = [...files.map((file) => file.path), ...GENERATED_FILES]
  const prune = prunePayload(PAYLOAD_ROOT, keep)
  const payloadInventory = collectPayloadInventory(PAYLOAD_ROOT)
  if (payloadInventory.files.length !== files.length) {
    throw new Error(
      `payload file count ${payloadInventory.files.length} does not match source file count ${files.length}`,
    )
  }
  if (payloadInventory.symlinks.length > 0) {
    throw new Error(`payload contains symlinks: ${payloadInventory.symlinks.map((item) => item.path).join(', ')}`)
  }
  if (payloadInventory.unsupported.length > 0) {
    throw new Error(
      `payload contains unsupported entries: ${payloadInventory.unsupported.map((item) => item.path).join(', ')}`,
    )
  }
  const sourceByPath = new Map(files.map((file) => [file.path, file]))
  for (const file of payloadInventory.files) {
    const source = sourceByPath.get(file.path)
    if (source === undefined) throw new Error(`unexpected payload file: ${file.path}`)
    if (source.sha256 !== file.sha256 || source.mode !== file.mode || source.bytes !== file.bytes) {
      throw new Error(`payload mismatch for ${file.path}`)
    }
  }
  const inventory = buildInventory(payloadInventory.files)
  verifyContractSnapshot({ inventory, generatedAt, generatedAtSource })
  const provenance = buildProvenance({
    files,
    inventory,
    generatedAt,
    generatedAtSource,
    upstreamInfo,
    refusedSymlinks,
    skippedArtifacts,
    excludedFiles,
  })
  if (unsupported.length > 0) {
    throw new Error(`unsupported upstream entries: ${unsupported.map((item) => item.path).join(', ')}`)
  }
  writeJson(join(PAYLOAD_ROOT, 'PROVENANCE.json'), provenance)
  const referenceIndex = buildReferenceIndex({ payloadRoot: PAYLOAD_ROOT, generatedAt })
  writeJson(join(PAYLOAD_ROOT, 'REFERENCE-INDEX.json'), referenceIndex)
  const after = digestTree(PAYLOAD_ROOT)
  const idempotent = before !== null && after !== null && before.sha256 === after.sha256
  printReport({
    upstreamInfo,
    generatedAt,
    generatedAtSource,
    copy,
    prune,
    inventory,
    provenance,
    referenceIndex,
    before,
    after,
    idempotent,
  })
  return { ok: true, provenance, referenceIndex, idempotent }
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
  main().catch((error) => {
    process.stderr.write(`payload build failed: ${error instanceof Error ? error.message : String(error)}\n`)
    if (process.env.ARS_DEBUG === '1' && error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`)
    }
    process.exitCode = 1
  })
}

// Exported for tools/check-payload.mjs and tests.
export const internals = Object.freeze({
  REFERENCE_CONVENTIONS,
  RESOLUTION_ORDER,
  SKILL_LOCAL_PREFIXES,
  REFERENCE_PREFIXES,
})
