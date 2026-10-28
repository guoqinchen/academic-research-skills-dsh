#!/usr/bin/env node
/**
 * Optional Jev upstream-change triage.
 *
 * Consumes the JSON emitted by tools/check-upstream.mjs --json and classifies
 * each changed path as runtime-contract, documentation, test-only, or unknown.
 * The classification is advisory; the payload rebuild remains deterministic.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import {
  JevError,
  assertFileArg,
  createJevClient,
  numberOption,
  parseArgs,
} from './jev-client.mjs'

export const DEFAULT_MAX_DIFF_BYTES = 6000
export const CATEGORIES = Object.freeze({
  runtime_contract: 'The change affects a skill, command, agent, hook, or script that the DSH adapter registers or executes.',
  documentation: 'The change is limited to documentation, metadata, comments, or version text.',
  test_only: 'The change is limited to tests, fixtures, or test data.',
  unknown: 'The provided diff is insufficient to classify the change.',
})

export function collectChangedPaths(diff) {
  const paths = new Set()
  for (const group of ['changed', 'added', 'removed']) {
    for (const entry of diff?.files?.[group] ?? []) {
      const path = typeof entry === 'string'
        ? entry
        : entry?.path ?? entry?.upstream?.path ?? entry?.payload?.path
      if (typeof path === 'string' && path.length > 0) paths.add(path)
    }
  }
  return [...paths].sort()
}

function readDiff(path, { upstreamRoot, payloadRoot, maxDiffBytes }) {
  if (upstreamRoot === undefined) return { change_kind: 'unknown', diff_excerpt: '' }
  const oldPath = join(payloadRoot, path)
  const newPath = join(upstreamRoot, path)
  if (!existsSync(oldPath) || !existsSync(newPath)) {
    return { change_kind: !existsSync(oldPath) ? 'added' : 'removed', diff_excerpt: '' }
  }
  const run = spawnSync('git', ['diff', '--no-index', '--unified=2', oldPath, newPath], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
  if (run.error !== undefined) throw new JevError(`git diff failed: ${run.error.message}`)
  const text = (run.stdout || '').slice(0, maxDiffBytes)
  return { change_kind: 'changed', diff_excerpt: text }
}

/** @param {ReturnType<typeof createJevClient>} client */
export async function classifyChange(client, path, { upstreamRoot, payloadRoot = 'payload', maxDiffBytes = DEFAULT_MAX_DIFF_BYTES } = {}) {
  if (typeof path !== 'string' || path.length === 0) throw new JevError('path is required')
  const details = readDiff(path, { upstreamRoot, payloadRoot, maxDiffBytes })
  const { answers } = await client.ask({
    state: { path, ...details },
    questions: {
      classification: {
        type: 'choice',
        instructions: 'Which category best describes this upstream change?',
        criteria: CATEGORIES,
      },
    },
  })
  const answer = answers.classification
  if (answer === null || typeof answer !== 'object' || !(answer.choice in CATEGORIES)) {
    throw new JevError(`${path}: TypeSafe response has no valid classification`)
  }
  return {
    path,
    change_kind: details.change_kind,
    choice: answer.choice,
    probabilities: answer.probabilities ?? {},
    confidence: answer.confidence ?? null,
  }
}

export async function classifyChanges(client, paths, options = {}) {
  const results = []
  for (const path of paths) results.push(await classifyChange(client, path, options))
  const priority = { runtime_contract: 0, documentation: 1, test_only: 2, unknown: 3 }
  results.sort((left, right) => (priority[left.choice] ?? 9) - (priority[right.choice] ?? 9) || left.path.localeCompare(right.path))
  return {
    results,
    summary: {
      total: results.length,
      runtime_contract: results.filter((row) => row.choice === 'runtime_contract').length,
      documentation: results.filter((row) => row.choice === 'documentation').length,
      test_only: results.filter((row) => row.choice === 'test_only').length,
      unknown: results.filter((row) => row.choice === 'unknown').length,
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const diffPath = assertFileArg(args.diff ?? args._[0], '--diff <check-upstream-json>')
  const diff = JSON.parse(readFileSync(resolve(diffPath), 'utf8'))
  const paths = collectChangedPaths(diff)
  if (paths.length === 0) {
    process.stderr.write('jev-upstream-triage: no changed paths in diff\n')
    return
  }
  const client = createJevClient({ apiKey: process.env.TYPESAFE_API_KEY, model: args.model })
  const { results, summary } = await classifyChanges(client, paths, {
    upstreamRoot: args.upstream === undefined ? undefined : resolve(args.upstream),
    payloadRoot: args.payload === undefined ? resolve('payload') : resolve(args.payload),
    maxDiffBytes: numberOption(args.maxDiffBytes, DEFAULT_MAX_DIFF_BYTES, '--max-diff-bytes'),
  })
  process.stdout.write(results.map((row) => JSON.stringify(row)).join('\n') + '\n')
  process.stderr.write(JSON.stringify({ summary }) + '\n')
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`jev-upstream-triage: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  })
}
