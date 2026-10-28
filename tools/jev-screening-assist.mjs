#!/usr/bin/env node
/**
 * Optional Jev screening aid for sr-screener.
 *
 * The tool judges each protocol criterion independently and returns an
 * advisory summary. It never emits the final include/exclude decision and must
 * not replace the dual-review + adjudication workflow.
 *
 * Input JSONL row: { id, title, abstract, criteria: [{ id, text }] }
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

function normalizeCriteria(record) {
  if (!Array.isArray(record.criteria) || record.criteria.length === 0) {
    throw new JevError(`record ${String(record.id)}: criteria must be a non-empty array`)
  }
  if (record.criteria.length > 20) {
    throw new JevError(`record ${String(record.id)}: at most 20 criteria per call`)
  }
  return record.criteria.map((criterion, index) => {
    if (typeof criterion === 'string') return { id: `criterion_${index + 1}`, text: criterion }
    if (criterion !== null && typeof criterion === 'object' && typeof criterion.text === 'string') {
      return { id: typeof criterion.id === 'string' && criterion.id.length > 0 ? criterion.id : `criterion_${index + 1}`, text: criterion.text }
    }
    throw new JevError(`record ${String(record.id)}: criterion ${index + 1} needs text`)
  })
}

/** @param {ReturnType<typeof createJevClient>} client */
export async function judgeScreening(client, record, thresholds = DEFAULT_THRESHOLDS) {
  if (record === null || typeof record !== 'object') throw new JevError('screening row must be an object')
  if (typeof record.id !== 'string' || record.id.length === 0) throw new JevError('screening row requires id')
  if (typeof record.title !== 'string' || typeof record.abstract !== 'string') {
    throw new JevError(`record ${record.id}: title and abstract are required strings`)
  }
  const criteria = normalizeCriteria(record)
  const questions = {}
  for (const [index, criterion] of criteria.entries()) {
    questions[`criterion_${index + 1}`] = {
      type: 'noul',
      instructions: `The record meets this protocol criterion: ${criterion.text}`,
    }
  }
  const { answers } = await client.ask({
    state: {
      record: { title: record.title, abstract: record.abstract },
      criteria,
    },
    questions,
  })
  const judged = criteria.map((criterion, index) => {
    const answer = answers[`criterion_${index + 1}`]
    if (answer === null || typeof answer !== 'object' || typeof answer.noul !== 'number') {
      throw new JevError(`record ${record.id}: missing answer for criterion ${criterion.id}`)
    }
    const verdict = noulVerdict(answer.noul, thresholds)
    return {
      id: criterion.id,
      text: criterion.text,
      noul: answer.noul,
      verdict: verdict === 'yes' ? 'yes' : verdict === 'no' ? 'no' : 'unresolved',
    }
  })
  const summary = judged.some((row) => row.verdict === 'no')
    ? 'likely_not_meet'
    : judged.every((row) => row.verdict === 'yes')
      ? 'likely_meet'
      : 'unresolved'
  return {
    id: record.id,
    verdict: summary,
    advisory: true,
    criteria: judged,
  }
}

export async function runScreening({ client, records, thresholds = DEFAULT_THRESHOLDS }) {
  const results = []
  for (const record of records) results.push(await judgeScreening(client, record, thresholds))
  return {
    results,
    summary: {
      total: results.length,
      likely_meet: results.filter((row) => row.verdict === 'likely_meet').length,
      likely_not_meet: results.filter((row) => row.verdict === 'likely_not_meet').length,
      unresolved: results.filter((row) => row.verdict === 'unresolved').length,
    },
  }
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
  const records = readJsonLines(readFileSync(resolve(input), 'utf8'))
  const { results, summary } = await runScreening({ client, records, thresholds })
  process.stdout.write(results.map((row) => JSON.stringify(row)).join('\n') + (results.length > 0 ? '\n' : ''))
  process.stderr.write(JSON.stringify({ summary, advisory: true }) + '\n')
  if (args.strict === true && results.some((row) => row.verdict !== 'likely_meet')) process.exitCode = 1
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`jev-screening-assist: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  })
}
