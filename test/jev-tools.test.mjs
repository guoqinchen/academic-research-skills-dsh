import { test } from 'node:test'
import assert from 'node:assert/strict'

import { JevError, createJevClient, noulVerdict } from '../tools/jev-client.mjs'
import { judgeCitation, runCitationCheck } from '../tools/jev-citation-support.mjs'
import { judgeScreening, runScreening } from '../tools/jev-screening-assist.mjs'
import { classifyChange, classifyChanges, collectChangedPaths } from '../tools/jev-upstream-triage.mjs'
import { compareVersions } from '../tools/check-release-parity.mjs'

function clientFor(handler) {
  return {
    async ask({ state, questions }) {
      return { answers: await handler({ state, questions }) }
    },
  }
}

test('jev client sends the API key, model, state, and questions', async () => {
  let captured
  const fetchImpl = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) }
    return new Response(JSON.stringify({ model: 'jev-test', answers: { q: { type: 'noul', noul: 0.8 } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const client = createJevClient({ apiKey: 'test-key', fetchImpl, model: 'jev-test' })
  const data = await client.ask({ state: { text: 'x' }, questions: { q: { type: 'noul', instructions: 'Is x true?' } } })
  assert.equal(data.answers.q.noul, 0.8)
  assert.equal(captured.url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(captured.init.headers.Authorization, 'Bearer test-key')
  assert.equal(captured.body.model, 'jev-test')
  assert.deepEqual(captured.body.state, { text: 'x' })
})

test('jev client fails closed on missing key, HTTP errors, and invalid JSON', async () => {
  assert.throws(() => createJevClient({ apiKey: '' }), JevError)
  const httpClient = createJevClient({
    apiKey: 'k',
    fetchImpl: async () => new Response('upstream error', { status: 502 }),
  })
  await assert.rejects(
    httpClient.ask({ state: {}, questions: { q: { type: 'noul', instructions: 'x' } } }),
    /TypeSafe API 502/,
  )
  const badJson = createJevClient({
    apiKey: 'k',
    fetchImpl: async () => new Response('not json', { status: 200 }),
  })
  await assert.rejects(
    badJson.ask({ state: {}, questions: { q: { type: 'noul', instructions: 'x' } } }),
    /invalid JSON/,
  )
})

test('noulVerdict uses the documented thresholds', () => {
  assert.equal(noulVerdict(0.7), 'yes')
  assert.equal(noulVerdict(0.3), 'no')
  assert.equal(noulVerdict(0.5), 'unresolved')
  assert.equal(noulVerdict(0.69), 'unresolved')
})

test('citation support maps Noul to supported/unsupported/unresolved', async () => {
  const client = clientFor(({ state }) => ({
    citation_support: {
      type: 'noul',
      noul: state.claim === 'supported' ? 0.91 : state.claim === 'unsupported' ? 0.08 : 0.5,
    },
  }))
  const results = []
  for (const claim of ['supported', 'unsupported', 'unclear']) {
    results.push(await judgeCitation(client, { id: claim, claim, source: { passage: 'p', locator: 'L1' } }))
  }
  assert.deepEqual(results.map((row) => row.verdict), ['supported', 'unsupported', 'unresolved'])
  const run = await runCitationCheck({ client, items: [{ id: 'x', claim: 'supported', source: 'p' }], strict: true })
  assert.equal(run.ok, true)
})

test('screening returns an advisory summary and never a final include decision', async () => {
  const client = clientFor(({ questions }) => {
    const answers = {}
    for (const [id, question] of Object.entries(questions)) {
      answers[id] = { type: 'noul', noul: question.instructions.includes('must be empirical') ? 0.2 : 0.82 }
    }
    return answers
  })
  const record = { id: 'r1', title: 'A study', abstract: 'We report a study.', criteria: [
    { id: 'empirical', text: 'The record must be empirical.' },
    { id: 'english', text: 'The record is in English.' },
  ] }
  const result = await judgeScreening(client, record)
  assert.equal(result.verdict, 'likely_not_meet')
  assert.equal(result.advisory, true)
  assert.equal(result.criteria.find((row) => row.id === 'empirical').verdict, 'no')
  const run = await runScreening({ client, records: [record] })
  assert.equal(run.summary.likely_not_meet, 1)
})

test('release parity compares npmjs and GitHub Packages versions', () => {
  assert.deepEqual(compareVersions('2.1.0', '2.1.0'), {
    npm: '2.1.0', github: '2.1.0', ok: true, differences: [],
  })
  const mismatch = compareVersions('2.1.0', '2.0.1')
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.differences.length, 1)
})

test('upstream triage collects paths, classifies, and prioritizes runtime changes', async () => {
  const diff = { files: { changed: ['docs/README.md', 'scripts/gate.py'], added: [{ path: 'tests/new.py' }], removed: [] } }
  assert.deepEqual(collectChangedPaths(diff), ['docs/README.md', 'scripts/gate.py', 'tests/new.py'])
  const client = clientFor(({ state }) => ({
    classification: {
      type: 'choice',
      choice: state.path.startsWith('scripts/') ? 'runtime_contract' : state.path.startsWith('tests/') ? 'test_only' : 'documentation',
      probabilities: {},
      confidence: 0.9,
    },
  }))
  const { results, summary } = await classifyChanges(client, collectChangedPaths(diff))
  assert.equal(results[0].choice, 'runtime_contract')
  assert.equal(summary.runtime_contract, 1)
  assert.equal(summary.documentation, 1)
  assert.equal(summary.test_only, 1)
  const one = await classifyChange(client, 'scripts/gate.py')
  assert.equal(one.choice, 'runtime_contract')
})
