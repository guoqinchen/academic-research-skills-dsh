#!/usr/bin/env node
/**
 * Compare one upstream checkout with the committed payload.
 *
 * Read-only: it never rewrites payload/, PROVENANCE.json, or the contract.
 * Exit codes: 0 = clean, 1 = drift, 2 = error.
 *
 *   node tools/check-upstream.mjs --upstream /path/to/upstream
 *   node tools/check-upstream.mjs --ref <branch-or-commit>   # clone to a temp dir
 *   node tools/check-upstream.mjs --json
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_UPSTREAM_ROOT,
  PLUGIN_ROOT,
  buildInventory,
  collectPayloadInventory,
  collectSourceEntries,
  compareBytes,
  readHeadCommit,
} from './build-payload.mjs'
import {
  UPSTREAM,
  contractDrift,
} from '../lib/payload-contract.js'

const PAYLOAD_ROOT = join(PLUGIN_ROOT, 'payload')
const REGISTERED = [
  /^[^/]+\/SKILL\.md$/u,
  /^commands\/[^/]+\.md$/u,
  /^agents\/[^/]+\.md$/u,
]

/**
 * Compare two inventories. Both arrays contain { path, sha256, mode, bytes }.
 * "added" means the upstream has a file the payload does not.
 *
 * @param {Array<{path: string, sha256: string, mode: number, bytes: number}>} upstream
 * @param {Array<{path: string, sha256: string, mode: number, bytes: number}>} payload
 */
export function compareFileSets(upstream, payload) {
  const expected = new Map(upstream.map((file) => [file.path, file]))
  const actual = new Map(payload.map((file) => [file.path, file]))
  const added = []
  const removed = []
  const changed = []
  for (const [path, file] of expected) {
    const current = actual.get(path)
    if (current === undefined) {
      added.push({ path, upstream: file })
      continue
    }
    if (current.sha256 !== file.sha256 || current.mode !== file.mode) {
      changed.push({ path, upstream: file, payload: current })
    }
  }
  for (const [path, file] of actual) {
    if (!expected.has(path)) removed.push({ path, payload: file })
  }
  const sort = (entries) => entries.sort((left, right) => compareBytes(left.path, right.path))
  return { added: sort(added), removed: sort(removed), changed: sort(changed) }
}

/** Contract values the payload currently pins. */
function currentSnapshot(inventory) {
  return {
    files: inventory.totals.files,
    bytes: inventory.totals.bytes,
    directories: inventory.totals.directories,
    modes: inventory.totals.modes,
    contentSha256: inventory.contentSha256,
    pathListSha256: inventory.pathListSha256,
  }
}

/** @returns {Array<{label: string, expected: unknown, actual: unknown}>} */
export function compareContract(inventory) {
  return contractDrift({
    files: inventory.totals.files,
    bytes: inventory.totals.bytes,
    directories: inventory.totals.directories,
    modes: inventory.totals.modes,
    contentSha256: inventory.contentSha256,
    pathListSha256: inventory.pathListSha256,
    byTopLevel: inventory.byTopLevel,
  })
}

function registeredChanges(diff) {
  const all = [
    ...diff.added.map((entry) => entry.path),
    ...diff.removed.map((entry) => entry.path),
    ...diff.changed.map((entry) => entry.path),
  ]
  return all.filter((path) => REGISTERED.some((pattern) => pattern.test(path)))
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120000 })
  if (result.error || result.status !== 0) {
    const detail = result.stderr || result.error?.message || `exit ${result.status}`
    throw new Error(`git ${args.join(' ')} failed: ${detail.trim()}`)
  }
  return result.stdout.trim()
}

function cloneRef(ref) {
  const root = mkdtempSync(join(tmpdir(), 'ars-upstream-check-'))
  runGit(['init', '-q'], root)
  runGit(['remote', 'add', 'origin', UPSTREAM.repositoryGit], root)
  runGit(['fetch', '--depth', '1', 'origin', ref], root)
  runGit(['checkout', '-q', 'FETCH_HEAD'], root)
  return root
}

function resolveCheckout({ upstream, ref }) {
  if (upstream) {
    const root = resolve(upstream)
    if (!existsSync(join(root, '.claude-plugin', 'plugin.json'))) {
      throw new Error(`not an ARS checkout (missing .claude-plugin/plugin.json): ${root}`)
    }
    return { root, temporary: false }
  }
  if (
    ref === UPSTREAM.commit &&
    existsSync(join(DEFAULT_UPSTREAM_ROOT, '.claude-plugin', 'plugin.json')) &&
    existsSync(join(DEFAULT_UPSTREAM_ROOT, '.git'))
  ) {
    return { root: DEFAULT_UPSTREAM_ROOT, temporary: false }
  }
  return { root: cloneRef(ref), temporary: true }
}

function parseArgs(argv) {
  const options = { upstream: null, ref: UPSTREAM.commit, json: false, help: false, printSnapshot: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--json') options.json = true
    else if (arg === '--print-snapshot') options.printSnapshot = true
    else if (arg === '--ref') options.ref = argv[++index]
    else if (arg.startsWith('--ref=')) options.ref = arg.slice('--ref='.length)
    else if (arg === '--upstream') options.upstream = argv[++index]
    else if (arg.startsWith('--upstream=')) options.upstream = arg.slice('--upstream='.length)
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!options.ref) throw new Error('--ref requires a value')
  return options
}

function usage() {
  return [
    'Usage: node tools/check-upstream.mjs [--upstream <path>] [--ref <rev>] [--json] [--print-snapshot]',
    '',
    'Without --upstream, fetches <rev> (default: the pinned commit) into a temp checkout.',
    'Exit codes: 0 clean, 1 drift, 2 error.',
  ].join('\n')
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return { exitCode: 0 }
  }
  let checkout = null
  try {
    checkout = resolveCheckout(options)
    const commit = existsSync(join(checkout.root, '.git'))
      ? (() => {
          try { return readHeadCommit(checkout.root) } catch { return null }
        })()
      : null
    const manifest = JSON.parse(readFileSync(join(checkout.root, '.claude-plugin', 'plugin.json'), 'utf8'))
    const source = collectSourceEntries(checkout.root)
    const upstreamInventory = buildInventory(source.files)
    const payload = collectPayloadInventory(PAYLOAD_ROOT)
    const diff = compareFileSets(source.files, payload.files)
    const contract = compareContract(upstreamInventory)
    const registered = registeredChanges(diff)
    const clean = diff.added.length === 0 && diff.removed.length === 0 &&
      diff.changed.length === 0 && contract.length === 0

    const report = {
      upstream: {
        root: checkout.root,
        commit,
        repository: UPSTREAM.repository,
        plugin: manifest.name,
        version: manifest.version,
        license: manifest.license,
      },
      payload: { root: PAYLOAD_ROOT, files: payload.files.length },
      files: {
        upstream: source.files.length,
        added: diff.added.map((entry) => entry.path),
        removed: diff.removed.map((entry) => entry.path),
        changed: diff.changed.map((entry) => entry.path),
      },
      contract,
      registeredDocuments: registered,
      distributionExclusions: source.excludedFiles.map((entry) => entry.path),
      ...(options.printSnapshot ? {
        snapshot: currentSnapshot(upstreamInventory),
        byTopLevel: upstreamInventory.byTopLevel,
      } : {}),
      clean,
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      const lines = []
      lines.push(`Upstream : ${checkout.root}${commit ? ` @ ${commit}` : ''}`)
      lines.push(`Plugin   : ${manifest.name}@${manifest.version} (${manifest.license})`)
      lines.push(`Files    : upstream ${source.files.length}, payload ${payload.files.length}`)
      lines.push(`Changed  : ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`)
      if (diff.added.length + diff.removed.length + diff.changed.length > 0) {
        for (const entry of diff.added.slice(0, 20)) lines.push(`  + ${entry.path}`)
        for (const entry of diff.removed.slice(0, 20)) lines.push(`  - ${entry.path}`)
        for (const entry of diff.changed.slice(0, 20)) lines.push(`  ~ ${entry.path}`)
      }
      if (registered.length > 0) lines.push(`Adapter  : review registered documents: ${registered.join(', ')}`)
      if (contract.length > 0) {
        lines.push('Contract : drift')
        for (const entry of contract) lines.push(`  ! ${entry.label}`)
      } else {
        lines.push('Contract : matches PAYLOAD_SNAPSHOT / BY_TOP_LEVEL')
      }
      lines.push(`Mirrors  : ${source.excludedFiles.length} distribution exclusion(s)`)
      if (options.printSnapshot) {
        lines.push('Snapshot :')
        lines.push(JSON.stringify({
          PAYLOAD_SNAPSHOT: currentSnapshot(upstreamInventory),
          BY_TOP_LEVEL: Object.fromEntries(
            Object.entries(upstreamInventory.byTopLevel).map(([group, value]) => [
              group,
              { files: value.files, bytes: value.bytes },
            ]),
          ),
        }, null, 2))
      }
      lines.push(clean ? 'Verdict  : CLEAN' : 'Verdict  : DRIFT — review before rebuilding')
      process.stdout.write(`${lines.join('\n')}\n`)
    }
    return { exitCode: clean ? 0 : 1 }
  } finally {
    if (checkout?.temporary) rmSync(checkout.root, { recursive: true, force: true })
  }
}

function isEntrypoint() {
  if (!process.argv[1]) return false
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntrypoint()) {
  main()
    .then(({ exitCode }) => { process.exitCode = exitCode })
    .catch((error) => {
      process.stderr.write(`check-upstream failed: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 2
    })
}
