/**
 * DeepSeek Flash profile + web-search default tests.
 *
 * The plugin must not depend on a Claude model or CLI. Upstream model labels
 * are rewritten to DeepSeek Flash at adaptation time, and the prelude/announce
 * text points source discovery at the DeepSeek native `web_search` tool.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPaths } from '../lib/paths.js'
import { normalizeConfig } from '../lib/config.js'
import { createAdapter } from '../lib/adapt.js'
import {
  DEEPSEEK_FLASH,
  MODEL_PROFILE_LABEL,
  deepseekAnnouncement,
  deepseekGuidance,
} from '../lib/model-profile.js'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(here, '..')
const paths = createPaths(pluginRoot)
const adapter = createAdapter({ paths })

test('DeepSeek Flash profile carries the context, image, reasoning, and search facts', () => {
  assert.equal(DEEPSEEK_FLASH.id, 'deepseek-flash')
  assert.equal(DEEPSEEK_FLASH.contextTokens, 1048576)
  assert.equal(DEEPSEEK_FLASH.maxOutputTokens, 256000)
  assert.deepEqual(DEEPSEEK_FLASH.inputs, ['text', 'image'])
  assert.deepEqual(DEEPSEEK_FLASH.reasoningEfforts, ['off', 'low', 'high', 'max'])
  assert.equal(DEEPSEEK_FLASH.searchTool, 'web_search')
  assert.equal(DEEPSEEK_FLASH.searchProvider, 'deepseek-official')
  assert.match(MODEL_PROFILE_LABEL, /DeepSeek Flash/)
})

test('guidance and announcement default to DeepSeek native web search and no Claude runtime', () => {
  const guidance = deepseekGuidance()
  assert.match(guidance, /web_search/)
  assert.match(guidance, /deepseek-official/)
  assert.match(guidance, /1,048,576/)
  assert.match(guidance, /image/i)
  assert.match(guidance, /subagent/)
  assert.doesNotMatch(guidance, /\b(?:sonnet|opus|haiku|Claude)\b/u)

  const announce = deepseekAnnouncement()
  assert.match(announce, /DeepSeek Flash/)
  assert.match(announce, /web_search/)
  assert.doesNotMatch(announce, /\b(?:sonnet|opus|haiku|Claude)\b/u)
})

test('config defaults select the DeepSeek Flash profile and DeepSeek search', () => {
  const config = normalizeConfig({}, { home: pluginRoot })
  assert.equal(config.modelProfile, 'deepseek-flash')
  assert.equal(config.webSearch, true)
})

test('adaptation removes legacy model labels and Claude runtime filesystem prose', () => {
  const body = [
    'Route this to a `sonnet` subagent, or use `opus` for the hard review.',
    'The routing core lives in `.claude/CLAUDE.md`; copy the role into `.claude/agents/`.',
    'This is a Claude Code session; the legacy Opus-class tier is optional.',
  ].join('\n')
  const text = adapter.adaptSkillBody(body, { skill: 'deep-research' })
  assert.match(text, /deepseek-flash/)
  assert.doesNotMatch(text, /\b(?:sonnet|opus|haiku|Opus-class|Claude Code)\b/u)
  assert.doesNotMatch(text, /\.claude\//u)
  assert.deepEqual(adapter.lint(text), [])
})
