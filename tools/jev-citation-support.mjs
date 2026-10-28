#!/usr/bin/env node
/**
 * Optional Jev citation-support check.
 *
 * Input: JSONL rows with id, claim, source (string or { passage, locator }).
 * Output: JSONL rows with the Noul probability and a code-owned verdict.
 *
 * This tool is advisory. It does not replace the deterministic citation gate
 * or a human's reading of the source.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import {
  JevError,
  assertFileArg,
  createJevClient,
  noulVerdict,
  numberOption,
  parseArgs,
  readJsonLines,
} from './jev-client.mjs'

export const DEFAULT_THRESHOLDS = Object.freeze({ yes: 0.7, no: 0.3 })

function sourcePassage(item) {
  if (typeof item.source === 'string') return item.source
  if (item.source !== null && typeof item.source === 'object' && typeof item.source.passage === 'string') {
    return item.source.passage
  }
  throw new JevError(`citation ${String(item.id)}: source must be a string or { passage }`)
}

/** @param {ReturnType<typeof createJevClient>} client */
export async function judgeCitation(client, item, thresholds = DEFAULT_THRESHOLDS) {
  if (item === null || typeof item !== 'object') throw new JevError('citation row must be an object')
  if (typeof item.id !== 'string' || item.id.length === 0) throw new JevError('citation row requires id')
  if (typeof item.claim !== 'string' || item.claim.length === 0) throw new JevError(`citation ${item.id}: claim is required`)
  const passage = sourcePassage(item)
  const locator = typeof item.locator === 'string' ? item.locator : (item.source && item.source.locator) || null
  const { answers } = await client.ask({
    state: {
      claim: item.claim,
      source: { passage, locator },
    },
    questions: {
      citation_support: {
        type: 'noul',
        instructions: 'The source passage supports the claim as stated.',
      },
    },
  })
  const answer = answers.citation_support
  if (answer === null || typeof answer !== 'object' || typeof answer.noul !== 'number') {
    throw new JevError(`citation ${item.id}: TypeSafe response has no citation_support.noul`)
  }
  const verdict = noulVerdict(answer.noul, thresholds)
  return {
    id: item.id,
    claim: item.claim,
    locator,
    noul: answer.noul,
    verdict: verdict === 'yes' ? 'supported' : verdict === 'no' ? 'unsupported' : 'unresolved',
  }
}

export async function runCitationCheck({ client, items, thresholds = DEFAULT_THRESHOLDS, strict = false }) {
  const results = []
  for (const item of items) results.push(await judgeCitation(client, item, thresholds))
  const summary = {
    total: results.length,
    supported: results.filter((row) => row.verdict === 'supported').length,
    unsupported: results.filter((row) => row.verdict === 'unsupported').length,
    unresolved: results.filter((row) => row.verdict === 'unresolved').length,
  }
  return { results, summary, ok: !strict || (summary.unsupported === 0 && summary.unresolved === 0) }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = assertFileArg(args.input ?? args._[0], '--input <jsonl>')
  const thresholds = {
    yes: numberOption(args.yes, DEFAULT_THRESHOLDS.yes, '--yes'),
    no: numberOption(args.no, DEFAULT_THRESHOLDS.no, '--no'),
  }
  if (thresholds.no >= thresholds.yes) throw new JevError('--no must be lower than --yes')
  const client = createJevClient({ apiKey: process.env.TYPESAFE_API_KEY, model: args.model })
  const items = readJsonLines(readFileSync(resolve(input), 'utf8'))
  const { results, summary, ok } = await runCitationCheck({
    client,
    items,
    thresholds,
    strict: args.strict === true,
  })
  process.stdout.write(results.map((row) => JSON.stringify(row)).join('\n') + (results.length > 0 ? '\n' : ''))
  process.stderr.write(JSON.stringify({ summary }) + '\n')
  if (!ok) process.exitCode = 1
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`jev-citation-support: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  })
}
