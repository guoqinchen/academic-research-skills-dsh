import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseFrontmatter, parseMarkdownFile } from '../lib/frontmatter.js'
import { SKILL_NAMES } from '../lib/inventory.js'

/* -------------------------------------------------------------------------- */
/* Corpus discovery                                                           */
/* -------------------------------------------------------------------------- */

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(here, '..')
const repoRoot = resolve(pluginRoot, '..', 'repo')
const payloadRoot = join(pluginRoot, 'payload')


/** Does `root` look like a complete upstream repository layout? */
function hasDocumentSet(root) {
  return (
    SKILL_NAMES.every((skill) => existsSync(join(root, skill, 'SKILL.md'))) &&
    existsSync(join(root, 'commands', 'ars-3w.md')) &&
    existsSync(join(root, 'agents', 'synthesis_agent.md'))
  )
}

/** Prefer the built payload, fall back to the upstream clone, allow override. */
function resolveCorpusRoot() {
  const override = process.env.ARS_TEST_UPSTREAM_ROOT
  if (typeof override === 'string' && override.length > 0) {
    assert.ok(hasDocumentSet(override), `ARS_TEST_UPSTREAM_ROOT is not an ARS repository: ${override}`)
    return override
  }
  if (hasDocumentSet(payloadRoot)) return payloadRoot
  assert.ok(hasDocumentSet(repoRoot), `no ARS document set found (looked in ${payloadRoot} and ${repoRoot})`)
  return repoRoot
}

const corpusRoot = resolveCorpusRoot()

/** @returns {Array<{kind: 'skill'|'command'|'agent', name: string, file: string}>} */
function listDocuments(root) {
  const documents = SKILL_NAMES.map((skill) => ({
    kind: 'skill',
    name: skill,
    file: join(root, skill, 'SKILL.md'),
  }))
  for (const file of readdirSync(join(root, 'commands')).filter((entry) => entry.endsWith('.md')).sort()) {
    documents.push({ kind: 'command', name: file.slice(0, -'.md'.length), file: join(root, 'commands', file) })
  }
  for (const file of readdirSync(join(root, 'agents')).filter((entry) => entry.endsWith('.md')).sort()) {
    documents.push({ kind: 'agent', name: file.slice(0, -'.md'.length), file: join(root, 'agents', file) })
  }
  return documents
}

const documents = listDocuments(corpusRoot)

function read(file) {
  return readFileSync(file, 'utf8')
}

/* -------------------------------------------------------------------------- */
/* Unit: fence handling                                                       */
/* -------------------------------------------------------------------------- */

test('parseFrontmatter returns null without a leading fence', () => {
  assert.equal(parseFrontmatter('# Heading\n\nbody\n'), null)
  assert.equal(parseFrontmatter(''), null)
  assert.equal(parseFrontmatter('\n---\nname: x\n---\n'), null, 'fence must be the first line')
  assert.equal(parseFrontmatter('---\nname: x\n'), null, 'unterminated fence returns null')
})

test('parseFrontmatter splits data and body and trims the body', () => {
  const parsed = parseFrontmatter('---\nname: demo\n---\n\n# Body\n\ntext  \n\n')
  assert.deepEqual(parsed.data, { name: 'demo' })
  assert.equal(parsed.body, '# Body\n\ntext')
})

test('parseFrontmatter tolerates CRLF and a UTF-8 BOM', () => {
  const parsed = parseFrontmatter('\uFEFF---\r\nname: demo\r\nflag: true\r\n---\r\nbody\r\n')
  assert.deepEqual(parsed.data, { name: 'demo', flag: true })
  assert.equal(parsed.body, 'body')
})

test('parseFrontmatter accepts a "..." closing fence', () => {
  const parsed = parseFrontmatter('---\nname: demo\n...\nbody')
  assert.deepEqual(parsed.data, { name: 'demo' })
  assert.equal(parsed.body, 'body')
})

/* -------------------------------------------------------------------------- */
/* Unit: scalars                                                              */
/* -------------------------------------------------------------------------- */

test('parseFrontmatter parses plain, quoted, and boolean scalars', () => {
  const parsed = parseFrontmatter([
    '---',
    'name: plain-value',
    'double: "quoted: value with colon"',
    "single: 'it''s fine'",
    'yes: true',
    'no: false',
    'model: inherit',
    'tools: Read, Write, Edit, Grep, Glob',
    '---',
    'body',
  ].join('\n'))
  assert.deepEqual(parsed.data, {
    name: 'plain-value',
    double: 'quoted: value with colon',
    single: "it's fine",
    yes: true,
    no: false,
    model: 'inherit',
    tools: 'Read, Write, Edit, Grep, Glob',
  })
})

test('parseFrontmatter does not coerce dates, versions, or arbitrary words', () => {
  const parsed = parseFrontmatter([
    '---',
    'version: "3.23.2"',
    'unquoted_version: 1.0.0',
    'last_updated: 2026-08-15',
    'count: 42',
    'status: active',
    'nothing: null',
    '---',
    'body',
  ].join('\n'))
  assert.equal(parsed.data.version, '3.23.2')
  assert.equal(parsed.data.unquoted_version, '1.0.0')
  assert.equal(parsed.data.last_updated, '2026-08-15')
  assert.equal(parsed.data.count, '42')
  assert.equal(parsed.data.status, 'active')
  assert.equal(parsed.data.nothing, 'null')
})

test('parseFrontmatter decodes double-quoted escapes', () => {
  const parsed = parseFrontmatter([
    '---',
    'escaped: "line\\nbreak \\"quoted\\" and \\u00e9"',
    '---',
    'body',
  ].join('\n'))
  assert.equal(parsed.data.escaped, 'line\nbreak "quoted" and é')
})

/* -------------------------------------------------------------------------- */
/* Unit: structures                                                           */
/* -------------------------------------------------------------------------- */

test('parseFrontmatter parses nested maps and list sequences', () => {
  const parsed = parseFrontmatter([
    '---',
    'name: deep-research',
    'metadata:',
    '  version: "2.12.1"',
    '  status: active',
    '  related_skills:',
    '    - academic-paper',
    '    - academic-pipeline',
    '  nested:',
    '    flag: true',
    '    values:',
    '      - one',
    '      - two',
    '---',
    'body',
  ].join('\n'))
  assert.deepEqual(parsed.data, {
    name: 'deep-research',
    metadata: {
      version: '2.12.1',
      status: 'active',
      related_skills: ['academic-paper', 'academic-pipeline'],
      nested: { flag: true, values: ['one', 'two'] },
    },
  })
})

test('parseFrontmatter ignores blank lines and whole-line comments', () => {
  const parsed = parseFrontmatter([
    '---',
    '# leading comment',
    'name: demo',
    '',
    'metadata:',
    '  # nested comment',
    '  status: active',
    '---',
    'body',
  ].join('\n'))
  assert.deepEqual(parsed.data, { name: 'demo', metadata: { status: 'active' } })
})

test('parseFrontmatter parses a "- key: value" sequence entry', () => {
  const parsed = parseFrontmatter([
    '---',
    'items:',
    '  - name: first',
    '    value: one',
    '  - name: second',
    '---',
    'body',
  ].join('\n'))
  assert.deepEqual(parsed.data.items, [
    { name: 'first', value: 'one' },
    { name: 'second' },
  ])
})

test('parseFrontmatter accepts indentationless block sequences', () => {
  const parsed = parseFrontmatter([
    '---',
    'items:',
    '- one',
    '- two',
    'metadata:',
    '  tags:',
    '  - alpha',
    '  - beta',
    '---',
    'body',
  ].join('\n'))
  assert.deepEqual(parsed.data, {
    items: ['one', 'two'],
    metadata: { tags: ['alpha', 'beta'] },
  })
})

test('parseFrontmatter treats URL list entries as scalars, not maps', () => {
  const parsed = parseFrontmatter([
    '---',
    'links:',
    '  - https://example.com/a',
    '  - ftp://example.org/b',
    '---',
    'body',
  ].join('\n'))
  assert.deepEqual(parsed.data, { links: ['https://example.com/a', 'ftp://example.org/b'] })
})

test('parseFrontmatter strips inline comments but preserves hashes in quotes', () => {
  const parsed = parseFrontmatter([
    '---',
    'title: "A title" # note',
    'plain: value # note',
    'hash: "a # b"',
    "single: 'c # d'",
    'bare: a#b',
    '---',
    'body',
  ].join('\n'))
  assert.deepEqual(parsed.data, {
    title: 'A title',
    plain: 'value',
    hash: 'a # b',
    single: 'c # d',
    bare: 'a#b',
  })
})

test('parseFrontmatter rejects inconsistent indentation', () => {
  assert.throws(
    () => parseFrontmatter('---\nname: demo\n  stray: value\n---\nbody'),
    /unexpected indentation/u,
  )
  assert.throws(
    () => parseFrontmatter('---\nnot a pair\n---\nbody'),
    /expected "key: value"/u,
  )
})

test('parseMarkdownFile returns text unchanged when frontmatter is absent', () => {
  assert.deepEqual(parseMarkdownFile('  \n# Body\n\n'), { data: {}, body: '# Body' })
})

/* -------------------------------------------------------------------------- */
/* Corpus: every upstream document                                            */
/* -------------------------------------------------------------------------- */

test('the corpus contains 5 skills, 16 commands, and 4 top-level agents', () => {
  assert.deepEqual(
    documents.filter((document) => document.kind === 'skill').map((document) => document.name),
    [...SKILL_NAMES],
  )
  const commands = documents.filter((document) => document.kind === 'command').map((document) => document.name)
  assert.equal(commands.length, 16)
  assert.deepEqual(commands, [
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
    'ars-revision-coach',
    'ars-revision',
    'ars-unmark-read',
  ])
  const agents = documents.filter((document) => document.kind === 'agent').map((document) => document.name)
  assert.deepEqual(agents, [
    'report_compiler_agent',
    'research_architect_agent',
    'screening_reviewer_agent',
    'synthesis_agent',
  ])
})

test('every upstream document parses into frontmatter plus body', async (t) => {
  for (const document of documents) {
    await t.test(`${document.kind} ${document.name}`, () => {
      const source = read(document.file)
      const parsed = parseMarkdownFile(source)
      assert.equal(typeof parsed.data.name, 'string', 'name must be a string')
      assert.ok(parsed.data.name.length > 0, 'name must be non-empty')
      assert.equal(typeof parsed.data.description, 'string', 'description must be a string')
      assert.ok(parsed.data.description.length > 0, 'description must be non-empty')
      assert.ok(parsed.body.length > 0, 'body must be non-empty')
      assert.ok(!parsed.body.startsWith('---'), 'frontmatter fences are stripped from the body')
      // The body must be exactly the source after the closing fence, trimmed.
      const closing = source.indexOf('\n---\n', 3)
      assert.ok(closing > 0, 'closing fence exists')
      assert.equal(parsed.body, source.slice(closing + '\n---\n'.length).trim())
    })
  }
})

test('frontmatter names match the file stems for commands and skills', () => {
  for (const document of documents) {
    const parsed = parseMarkdownFile(read(document.file))
    if (document.kind === 'command') {
      assert.equal(parsed.data.name, document.name, `command ${document.file}`)
    }
    if (document.kind === 'skill') {
      assert.equal(parsed.data.name, document.name, `skill ${document.file}`)
    }
  }
})

test('the five skills carry a nested metadata map and related_skills list', () => {
  const skills = documents.filter((document) => document.kind === 'skill')
  for (const document of skills) {
    const { data } = parseMarkdownFile(read(document.file))
    assert.equal(typeof data.metadata, 'object', `${document.name}: metadata map`)
    assert.ok(data.metadata !== null && !Array.isArray(data.metadata), `${document.name}: metadata is a map`)
    assert.equal(typeof data.metadata.version, 'string', `${document.name}: version stays a string`)
    assert.match(data.metadata.version, /^\d+\.\d+\.\d+$/u, `${document.name}: semantic version`)
    assert.equal(typeof data.metadata.last_updated, 'string', `${document.name}: last_updated stays a string`)
    assert.match(data.metadata.last_updated, /^\d{4}-\d{2}-\d{2}$/u, `${document.name}: ISO date`)
    assert.equal(data.metadata.status, 'active', `${document.name}: status`)
    assert.equal(data.metadata.data_access_level, 'raw', `${document.name}: data_access_level`)
    assert.equal(data.metadata.task_type, 'open-ended', `${document.name}: task_type`)
    assert.ok(Array.isArray(data.metadata.related_skills), `${document.name}: related_skills list`)
    assert.ok(data.metadata.related_skills.length >= 2, `${document.name}: at least two related skills`)
    for (const related of data.metadata.related_skills) {
      assert.ok(SKILL_NAMES.includes(related), `${document.name}: related skill ${related} is a real skill`)
    }
  }
})

test('the pipeline skill keeps its depends_on string', () => {
  const { data } = parseMarkdownFile(read(join(corpusRoot, 'academic-pipeline', 'SKILL.md')))
  assert.equal(data.metadata.depends_on, 'deep-research, academic-paper, academic-paper-reviewer')
})

test('commands expose the disable-model-invocation flag as a boolean', () => {
  const commands = documents.filter((document) => document.kind === 'command')
  let flagged = 0
  for (const document of commands) {
    const { data } = parseMarkdownFile(read(document.file))
    if (data['disable-model-invocation'] !== undefined) {
      assert.equal(data['disable-model-invocation'], true, `${document.name}: boolean true`)
      flagged += 1
    }
    if (data.model !== undefined) assert.equal(typeof data.model, 'string', `${document.name}: model string`)
  }
  assert.equal(flagged, 13, '13 of the 16 commands disable model invocation')
})

test('agent files expose their tool allowlist as one string', () => {
  const agents = documents.filter((document) => document.kind === 'agent')
  for (const document of agents) {
    const { data } = parseMarkdownFile(read(document.file))
    assert.equal(typeof data.tools, 'string', `${document.name}: tools string`)
    assert.equal(data.model, 'inherit', `${document.name}: model inherit`)
    for (const tool of data.tools.split(',').map((value) => value.trim())) {
      assert.match(tool, /^(?:Read|Write|Edit|Grep|Glob|Bash)$/u, `${document.name}: known tool ${tool}`)
    }
  }
})
