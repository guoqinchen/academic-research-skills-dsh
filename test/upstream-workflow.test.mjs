import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const workflow = readFileSync(resolve(here, '..', '.github', 'workflows', 'upstream-check.yml'), 'utf8')

test('upstream check resolves the latest GitHub Release by default', () => {
  assert.ok(workflow.includes('releases/latest'), 'workflow resolves releases/latest')
  assert.ok(workflow.includes('gh api repos/Imbad0202/academic-research-skills/releases/latest'), 'workflow uses the upstream API')
  assert.ok(!workflow.includes('${INPUT_REF:-main}'), 'workflow must not fall back to main')
})

test('upstream check keeps the manual ref override and fails loudly', () => {
  assert.ok(workflow.includes('workflow_dispatch'), 'manual dispatch remains')
  assert.ok(workflow.includes('INPUT_REF'), 'ref input remains')
  assert.ok(workflow.includes('GH_TOKEN'), 'API call authenticates')
  assert.ok(workflow.includes('no latest release'), 'empty resolution is rejected')
  assert.ok(workflow.includes('fetch --depth 1 origin "$REF"'), 'fetch still uses the resolved ref')
})
