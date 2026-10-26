import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseMarkdownFile } from '../lib/frontmatter.js'
import { createAdapter, SKILL_NAMES, AGENT_NAME_TO_SKILL } from '../lib/adapt.js'
import { createHost } from './support/host.mjs'
import {
  ANNOUNCE_ORDER,
  ANNOUNCE_SECTION_NAME,
  FALLBACK_COMMAND_NAMES,
  listCommandNames,
  registerAnnounce,
} from '../lib/announce.js'

/* -------------------------------------------------------------------------- */
/* Corpus discovery                                                           */
/* -------------------------------------------------------------------------- */

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(here, '..')
const repoRoot = resolve(pluginRoot, '..', 'repo')
const builtPayloadRoot = join(pluginRoot, 'payload')

function hasDocumentSet(root) {
  return (
    SKILL_NAMES.every((skill) => existsSync(join(root, skill, 'SKILL.md'))) &&
    existsSync(join(root, 'commands', 'ars-3w.md')) &&
    existsSync(join(root, 'agents', 'synthesis_agent.md'))
  )
}

function resolveCorpusRoot() {
  const override = process.env.ARS_TEST_UPSTREAM_ROOT
  if (typeof override === 'string' && override.length > 0 && hasDocumentSet(override)) return override
  if (hasDocumentSet(builtPayloadRoot)) return builtPayloadRoot
  assert.ok(hasDocumentSet(repoRoot), `no ARS document set found (looked in ${builtPayloadRoot} and ${repoRoot})`)
  return repoRoot
}

const corpusRoot = resolveCorpusRoot()

function createTestPaths(root) {
  return {
    pluginRoot,
    payloadRoot: root,
    commandsRoot: join(root, 'commands'),
    agentsRoot: join(root, 'agents'),
    scriptsRoot: join(root, 'scripts'),
    sharedRoot: join(root, 'shared'),
    docsRoot: join(root, 'docs'),
    hooksRoot: join(root, 'hooks'),
    binRoot: join(pluginRoot, 'bin'),
    requirementsPath: join(pluginRoot, 'requirements-runtime.txt'),
    provenancePath: join(root, 'PROVENANCE.json'),
    referenceIndexPath: join(root, 'REFERENCE-INDEX.json'),
  }
}

const paths = createTestPaths(corpusRoot)
const adapter = createAdapter({ paths })

/**
 * The four root agent files are byte-identical mirrors of one skill's role
 * file; their bare `references/`/`templates/`/`agents/` prefixes therefore
 * resolve inside that skill directory (Lead's reference audit).
 */
const AGENT_MIRROR = Object.freeze({
  synthesis_agent: 'deep-research',
  research_architect_agent: 'deep-research',
  report_compiler_agent: 'deep-research',
  screening_reviewer_agent: 'sr-screener',
})

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

function readParsed(document) {
  return parseMarkdownFile(readFileSync(document.file, 'utf8'))
}

function adaptDocument(document) {
  const parsed = readParsed(document)
  if (document.kind === 'skill') {
    return { parsed, text: adapter.adaptSkillBody(parsed.body, { skill: document.name }) }
  }
  if (document.kind === 'agent') {
    return {
      parsed,
      text: adapter.adaptAgentBody(parsed.body, {
        agent: parsed.data.name,
        skill: AGENT_MIRROR[parsed.data.name],
      }),
    }
  }
  return {
    parsed,
    text: adapter.adaptCommandBody(parsed.body, { command: parsed.data.name, skill: null, args: 'test request 42' }),
  }
}

function headings(text) {
  const result = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (!inFence && /^#{1,6} /u.test(line)) result.push(line)
  }
  return result
}

function fenceCount(text) {
  return text.split('\n').filter((line) => line.startsWith('```')).length
}

function assertClean(text, label) {
  assert.deepEqual(adapter.lint(text), [], `${label} must be lint-clean`)
  for (const token of ['${CLAUDE_PLUGIN_ROOT}', 'academic-research-skills:', 'Skill tool', 'subagent_type', 'python3 scripts/', 'python scripts/']) {
    assert.ok(!text.includes(token), `${label} must not contain ${token}`)
  }
}

/* -------------------------------------------------------------------------- */
/* Corpus summary                                                             */
/* -------------------------------------------------------------------------- */

test('adapter exposes the payload root, wrapper, and the expected counts', () => {
  assert.equal(adapter.payloadRoot, corpusRoot)
  assert.equal(adapter.binRoot, join(pluginRoot, 'bin'))
  assert.equal(adapter.pythonWrapper, join(pluginRoot, 'bin', 'ars-python'))
  assert.equal(typeof adapter.prelude, 'function')
  assert.equal(typeof adapter.adaptSkillBody, 'function')
  assert.equal(typeof adapter.adaptCommandBody, 'function')
  assert.equal(typeof adapter.adaptAgentBody, 'function')
  assert.equal(typeof adapter.announceText, 'function')
  assert.equal(typeof adapter.lint, 'function')
  assert.equal(documents.length, 25)
  assert.equal(documents.filter((document) => document.kind === 'skill').length, 5)
  assert.equal(documents.filter((document) => document.kind === 'command').length, 16)
  assert.equal(documents.filter((document) => document.kind === 'agent').length, 4)
})

/* -------------------------------------------------------------------------- */
/* Every document                                                             */
/* -------------------------------------------------------------------------- */

test('all 25 adapted documents are clean, rooted, and preserve upstream structure', async (t) => {
  for (const document of documents) {
    await t.test(`${document.kind} ${document.name}`, () => {
      const { parsed, text } = adaptDocument(document)
      const label = `${document.kind} ${document.name}`
      assertClean(text, label)
      assert.ok(text.includes(corpusRoot), `${label}: payload root appears`)
      assert.ok(text.length > parsed.body.length, `${label}: prelude was added`)
      const bodyHeadings = headings(parsed.body)
      const adaptedHeadings = headings(text)
      assert.deepEqual(
        adaptedHeadings.slice(1, 1 + bodyHeadings.length),
        bodyHeadings,
        `${label}: every upstream heading is preserved in order`,
      )
      const extra = adaptedHeadings.length - (1 + bodyHeadings.length)
      assert.ok(extra === 0 || (document.kind === 'command' && extra === 1), `${label}: only a request heading is added`)
      assert.equal(fenceCount(text), fenceCount(parsed.body), `${label}: every code fence is preserved`)
    })
  }
})

test('adaptation is deterministic and does not mutate the payload', () => {
  for (const document of documents) {
    const before = readFileSync(document.file)
    const first = adaptDocument(document).text
    const second = adaptDocument(document).text
    const after = readFileSync(document.file)
    assert.equal(first, second, `${document.name}: deterministic`)
    assert.deepEqual(before, after, `${document.name}: payload bytes unchanged`)
  }
})

/* -------------------------------------------------------------------------- */
/* Prelude                                                                    */
/* -------------------------------------------------------------------------- */

test('the skill prelude states roots, path conventions, tools, and skill invocation', () => {
  const prelude = adapter.prelude({ skill: 'academic-paper' })
  assert.ok(prelude.includes('DeepSeek Harness compatibility layer'))
  assert.ok(prelude.includes(corpusRoot), 'payload root')
  assert.ok(prelude.includes(join(corpusRoot, 'academic-paper')), 'skill directory')
  assert.ok(prelude.includes('Skill-relative prefixes'))
  assert.ok(prelude.includes('Payload-root-relative prefixes'))
  assert.ok(prelude.includes('`references/`'), 'skill-relative prefixes listed')
  assert.ok(prelude.includes('`shared/`') && prelude.includes('`scripts/`') && prelude.includes('MODE_REGISTRY.md'), 'payload-root prefixes listed')
  assert.ok(prelude.includes('`skill` tool'), 'skill tool invocation')
  assert.ok(prelude.includes('plain name'), 'load by plain name')
  assert.ok(prelude.includes('Read → `read`'), 'Read mapping')
  assert.ok(prelude.includes('Write → `write`'), 'Write mapping')
  assert.ok(prelude.includes('Edit → `edit`'), 'Edit mapping')
  assert.ok(prelude.includes('Bash → `bash`'), 'Bash mapping')
  assert.ok(prelude.includes('Grep → `grep`'), 'Grep mapping')
  assert.ok(prelude.includes('Glob → `glob`'), 'Glob mapping')
  assert.ok(prelude.includes('WebSearch → `web_search`'), 'WebSearch mapping')
  assert.ok(prelude.includes('WebFetch → `web_fetch`'), 'WebFetch mapping')
  assert.ok(prelude.includes('TodoWrite → `todo_write`'), 'TodoWrite mapping')
  assert.ok(prelude.includes('AskUserQuestion → `ask_user_question`'), 'AskUserQuestion mapping')
  assert.ok(prelude.includes('Task / Agent → `subagent`'), 'Task mapping')
  assert.ok(prelude.includes('MultiEdit → `edit` (one call per hunk)'), 'MultiEdit mapping')
  assert.ok(prelude.includes('NotebookEdit → `edit`'), 'NotebookEdit mapping')
  assert.ok(prelude.includes('BashOutput → `job_output`'), 'BashOutput mapping')
  assert.ok(prelude.includes('KillShell → `job_kill`'), 'KillShell mapping')
  assert.ok(prelude.includes('Workflow → `workflow`'), 'Workflow mapping')
  assert.ok(prelude.includes(adapter.pythonWrapper), 'managed Python wrapper')
  assert.ok(prelude.includes('read-only'), 'payload is read-only')
  assertClean(prelude, 'skill prelude')
})

test('adaptSkillBody starts with the skill prelude', () => {
  for (const skill of SKILL_NAMES) {
    const parsed = parseMarkdownFile(readFileSync(join(corpusRoot, skill, 'SKILL.md'), 'utf8'))
    const adapted = adapter.adaptSkillBody(parsed.body, { skill })
    assert.ok(adapted.startsWith(adapter.prelude({ skill })), `${skill}: prelude first`)
  }
})

test('the sr-screener prelude explains its skill-local scripts directory', () => {
  const prelude = adapter.prelude({ skill: 'sr-screener' })
  assert.ok(prelude.includes(join(corpusRoot, 'sr-screener', 'scripts')))
  assert.ok(prelude.includes('carries its own scripts'))
})

test('a generic prelude is available without a skill', () => {
  const prelude = adapter.prelude()
  assert.ok(prelude.includes(corpusRoot))
  assert.ok(prelude.includes('Read → `read`'))
})

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

const skillCommands = documents.filter((document) => {
  if (document.kind !== 'command') return false
  return /academic-research-skills:/u.test(readFileSync(document.file, 'utf8'))
})

test('13 skill commands are rewritten to plain-name `skill` invocation', () => {
  assert.equal(skillCommands.length, 13)
  for (const document of skillCommands) {
    const parsed = readParsed(document)
    const skill = /academic-research-skills:([a-z0-9-]+)/u.exec(readFileSync(document.file, 'utf8'))[1]
    assert.ok(SKILL_NAMES.includes(skill), `${document.name}: upstream skill ${skill} is ported`)
    const adapted = adapter.adaptCommandBody(parsed.body, {
      command: parsed.data.name,
      skill,
      args: `request for ${document.name}`,
    })
    assertClean(adapted, document.name)
    assert.ok(adapted.includes(`First invoke the \`skill\` tool with \`name: "${skill}"\``), `${document.name}: plain-name lead-in`)
    assert.ok(!adapted.includes('skill: "'), `${document.name}: no upstream skill: argument`)
    assert.ok(adapted.includes('After the skill loads'), `${document.name}: no arguments parameter`)
    assert.ok(!adapted.includes("as its arguments"), `${document.name}: phrase removed`)
    assert.ok(adapted.includes(`request for ${document.name}`), `${document.name}: raw request appended`)
    assert.ok(adapted.includes('## User request (raw input)'), `${document.name}: request section`)
  }
})

test('all 16 commands resolve ${CLAUDE_PLUGIN_ROOT} to absolute payload paths', () => {
  const commands = documents.filter((document) => document.kind === 'command')
  for (const document of commands) {
    const parsed = readParsed(document)
    const adapted = adapter.adaptCommandBody(parsed.body, {
      command: parsed.data.name,
      skill: null,
      args: 'request',
    })
    assert.ok(!adapted.includes('${CLAUDE_PLUGIN_ROOT}'), `${document.name}: token removed`)
    if (readFileSync(document.file, 'utf8').includes('MODE_REGISTRY.md')) {
      assert.ok(adapted.includes(`${corpusRoot}/MODE_REGISTRY.md`), `${document.name}: absolute mode registry`)
    }
  }
  const full = documents.find((document) => document.name === 'ars-full')
  const parsed = readParsed(full)
  const adapted = adapter.adaptCommandBody(parsed.body, { command: 'ars-full', skill: 'academic-pipeline', args: 'x' })
  assert.ok(adapted.includes(`${corpusRoot}/academic-pipeline/SKILL.md`), 'skill entry resolved')
  assert.ok(adapted.includes('`/ars-full`'), 'command identity in the prelude')
})

test('$ARGUMENTS is substituted verbatim in the three CLI commands', () => {
  const cases = [
    { name: 'ars-cache-invalidate', args: 'smith2024', script: 'ars_cache_invalidate.py' },
    { name: 'ars-mark-read', args: 'smith2024 --scope full_text --locator "page 3"', script: 'ars_mark_read.py' },
    { name: 'ars-unmark-read', args: 'smith2024', script: 'ars_mark_read.py' },
  ]
  for (const entry of cases) {
    const document = documents.find((candidate) => candidate.name === entry.name)
    const parsed = readParsed(document)
    assert.ok(parsed.body.includes('$ARGUMENTS'), `${entry.name}: upstream placeholder`)
    const adapted = adapter.adaptCommandBody(parsed.body, { command: entry.name, skill: null, args: entry.args })
    assert.ok(!adapted.includes('$ARGUMENTS'), `${entry.name}: placeholder gone`)
    assert.ok(adapted.includes(join(corpusRoot, 'scripts', entry.script)), `${entry.name}: absolute script`)
    assert.ok(adapted.includes(adapter.pythonWrapper), `${entry.name}: managed interpreter`)
    assert.ok(adapted.includes(entry.args), `${entry.name}: raw arguments verbatim`)
    assert.ok(!adapted.includes('## User request (raw input)'), `${entry.name}: no duplicate request section`)
  }
  const markRead = documents.find((document) => document.name === 'ars-mark-read')
  const adapted = adapter.adaptCommandBody(readParsed(markRead).body, {
    command: 'ars-mark-read',
    skill: null,
    args: 'key --locator "page 3"',
  })
  assert.ok(adapted.includes('--passport-path "<path>"'), 'passport placeholder untouched')
})

test('replacement text is treated literally (no $-pattern expansion)', () => {
  const document = documents.find((candidate) => candidate.name === 'ars-3w')
  const args = 'A $& B $1 C ${ARGUMENTS} D'
  const adapted = adapter.adaptCommandBody(readParsed(document).body, {
    command: 'ars-3w',
    skill: 'deep-research',
    args,
  })
  assert.ok(adapted.includes(args), 'raw input preserved exactly')
})

test('commands without a placeholder get the raw request appended', () => {
  const document = documents.find((candidate) => candidate.name === 'ars-3w')
  const parsed = readParsed(document)
  assert.ok(!parsed.body.includes('$ARGUMENTS'))
  const adapted = adapter.adaptCommandBody(parsed.body, {
    command: 'ars-3w',
    skill: 'deep-research',
    args: 'Compare the WHY of papers P1 and P2',
  })
  const marker = adapted.indexOf('## User request (raw input)')
  assert.ok(marker > 0, 'request section present')
  assert.equal(adapted.slice(marker + '## User request (raw input)\n\n'.length), 'Compare the WHY of papers P1 and P2')
  const empty = adapter.adaptCommandBody(parsed.body, { command: 'ars-3w', skill: 'deep-research', args: '' })
  assert.ok(empty.includes('_No additional input was provided._'))
})

/* -------------------------------------------------------------------------- */
/* Namespace and tool mapping                                                 */
/* -------------------------------------------------------------------------- */

test('no adapted document keeps the plugin namespace', () => {
  for (const document of documents) {
    const { text, parsed } = adaptDocument(document)
    assert.ok(!text.includes('academic-research-skills:'), `${document.name}: namespace removed`)
    if (parsed.body.includes('academic-research-skills:screening_reviewer_agent')) {
      assert.ok(text.includes('`ars-agent-screening-reviewer`'), `${document.name}: agent namespace mapped to its DSH agent-role skill`)
    }
  }
})

test('upstream Claude Code tool names are rewritten in prose', () => {
  const synthetic = [
    'Use the Task tool to dispatch work; the Task tool accepts subagent_type: research_architect_agent.',
    'Ask the user with AskUserQuestion instead of guessing.',
    'Track progress with TodoWrite.',
    'Verify via WebSearch; fetch with WebFetch.',
    'Apply hunks with MultiEdit, cells with NotebookEdit.',
    'Read output with BashOutput and stop with KillShell.',
    'A quoted Agent tool or Agent call behaves like the Task tool.',
    '(Read and Grep tools only)',
  ].join('\n')
  const adapted = adapter.adaptSkillBody(synthetic, { skill: 'deep-research' })
  assertClean(adapted, 'synthetic tool mapping')
  assert.ok(adapted.includes('Use the `subagent` tool to dispatch work'))
  assert.ok(adapted.includes('the `subagent` tool accepts the ARS agent-role skill for `ars-agent-research-architect`.'))
  assert.ok(adapted.includes('`ask_user_question`'))
  assert.ok(adapted.includes('`todo_write`'))
  assert.ok(adapted.includes('`web_search`'))
  assert.ok(adapted.includes('`web_fetch`'))
  assert.ok(adapted.includes('`edit` (one call per hunk)'))
  assert.ok(adapted.includes('`edit`'))
  assert.ok(adapted.includes('`job_output`'))
  assert.ok(adapted.includes('`job_kill`'))
  assert.ok(adapted.includes('`subagent` call'))
  assert.ok(adapted.includes('(`read` and `grep` tools only)'))
})

test('upstream documents map the tools they actually mention', () => {
  for (const document of documents.filter((candidate) => candidate.kind === 'skill')) {
    const { text } = adaptDocument(document)
    if (readFileSync(document.file, 'utf8').includes('AskUserQuestion')) {
      assert.ok(text.includes('`ask_user_question`'), `${document.name}: AskUserQuestion mapped`)
    }
    if (readFileSync(document.file, 'utf8').includes('WebSearch')) {
      assert.ok(text.includes('`web_search`'), `${document.name}: WebSearch mapped`)
    }
  }
  const paper = adaptDocument(documents.find((document) => document.name === 'academic-paper')).text
  assert.ok(paper.includes('verified via DOI or `web_search`'), 'WebSearch sentence')
  assert.ok(!paper.includes('via DOI or WebSearch'))
  const sr = adaptDocument(documents.find((document) => document.name === 'sr-screener')).text
  assert.ok(sr.includes('`workflow` tool'), 'Workflow tool mapped')
  assert.ok(sr.includes('one `subagent` call per batch'), 'Agent call mapped')
  assert.ok(sr.includes('run the printed script with the `workflow` tool'), 'Workflow scriptPath line mapped')
  assert.ok(!sr.includes('Workflow tool') && !sr.includes('Agent call') && !sr.includes('Workflow({scriptPath'))
  const screening = adaptDocument(documents.find((document) => document.name === 'screening_reviewer_agent')).text
  assert.ok(screening.includes('the `read` and `grep` tools'))
  assert.ok(!screening.includes('(Read and Grep'))
})

/* -------------------------------------------------------------------------- */
/* Python and shell invocations                                               */
/* -------------------------------------------------------------------------- */

test('python3 scripts/ invocations use the managed interpreter and absolute paths', () => {
  const expectations = [
    { name: 'academic-paper-reviewer', scripts: ['check_acronyms.py', 'verify_panel_recommendations.py', 'audit_panel_claims.py'] },
    { name: 'academic-paper', scripts: ['run_ledger.py'] },
    { name: 'deep-research', scripts: ['run_ledger.py'] },
  ]
  for (const expectation of expectations) {
    const document = documents.find((candidate) => candidate.name === expectation.name && candidate.kind === 'skill')
    const { text } = adaptDocument(document)
    assert.ok(text.includes(adapter.pythonWrapper), `${expectation.name}: wrapper`)
    for (const script of expectation.scripts) {
      assert.ok(text.includes(join(corpusRoot, 'scripts', script)), `${expectation.name}: absolute ${script}`)
    }
    assert.ok(text.includes(`${adapter.pythonWrapper}`), `${expectation.name}: wrapper used in invocation`)
    assert.ok(!/python3?\s+scripts\//u.test(text), `${expectation.name}: no relative invocation`)
  }
})

test('sr-screener routes its six skill-local scripts through $S and the wrapper', () => {
  const sr = adaptDocument(documents.find((document) => document.name === 'sr-screener')).text
  const scriptDir = join(corpusRoot, 'sr-screener', 'scripts')
  assert.ok(
    sr.includes('S=' + scriptDir) || sr.includes('S="' + scriptDir + '"'),
    '$S assignment absolute and quoted',
  )
  for (const script of ['prepare_records.py', 'build_workflow.py', 'merge_decisions.py', 'build_outputs.py']) {
    assert.ok(sr.includes(`"$S/${script}"`), `$S invocation for ${script}`)
  }
  assert.ok(!/python3?\s+\$S\//u.test(sr), 'no bare python $S invocation')
  assert.ok(!sr.includes('python $S/'))
})

test('shell paths escape substitutions and quotes', (t) => {
  const evilRoot = join(mkdtempSync(join(tmpdir(), 'ars-shell-')), 'ars$(touch /tmp/ARS_PWNED)')
  mkdirSync(evilRoot, { recursive: true })
  const evilPayload = join(evilRoot, 'payload')
  try {
    symlinkSync(join(pluginRoot, 'payload'), evilPayload, 'dir')
  } catch {
    t.skip('symlinks unavailable; cannot build a readable hostile path')
    return
  }
  const evilAdapter = createAdapter({ paths: createTestPaths(evilPayload) })
  const body = evilAdapter.adaptSkillBody('Run bash scripts/check.sh now.', { skill: 'deep-research' })
  assert.ok(body.includes('bash "'), 'script path stays double-quoted')
  assert.ok(body.includes('ars\\$(touch /tmp/ARS_PWNED)/payload/scripts/check.sh'), 'dollar is escaped')
  assert.ok(!body.includes('"$('), 'no unescaped command substitution')
  const rooted = evilAdapter.adaptSkillBody('Then bash ${CLAUDE_PLUGIN_ROOT}/scripts/check.sh.', { skill: 'deep-research' })
  assert.ok(rooted.includes('ars\\$(touch /tmp/ARS_PWNED)/payload/scripts/check.sh'), 'absolute rewrite is escaped')
})

test('the PYTHONPATH module invocation uses the managed interpreter', () => {
  const pipeline = adaptDocument(documents.find((document) => document.name === 'academic-pipeline')).text
  assert.ok(pipeline.includes(adapter.pythonWrapper))
  assert.ok(pipeline.includes('-m unittest scripts.test_claim_audit_calibration'))
  assert.ok(!pipeline.includes('PYTHONPATH=.'))
  assert.ok(!/(?<![-\w])python3?\s+-m/u.test(pipeline))
})

test('bash script invocations resolve to absolute payload paths', () => {
  // The adapter quotes a path only when the shell needs it; mirror that rule
  // instead of assuming the checkout path contains a space.
  const shellArg = (value) => (/[\s"'\\$`]/.test(value) ? JSON.stringify(value) : value)
  const expected = `bash ${shellArg(join(corpusRoot, 'scripts', 'check.sh'))}`
  const plain = adapter.adaptSkillBody('Run `bash scripts/check.sh --flag` now.', { skill: 'deep-research' })
  assert.ok(plain.includes(expected), 'relative bash script is absolute')
  const rooted = adapter.adaptSkillBody('Then bash ${CLAUDE_PLUGIN_ROOT}/scripts/check.sh.', { skill: 'deep-research' })
  assert.ok(rooted.includes(expected), 'plugin-root bash script is absolute')
  assertClean(rooted, 'bash rewrite')
  const sr = adapter.adaptSkillBody('bash scripts/local.sh', { skill: 'sr-screener' })
  assert.ok(sr.includes(`bash ${shellArg(join(corpusRoot, 'sr-screener', 'scripts', 'local.sh'))}`))
})

/* -------------------------------------------------------------------------- */
/* Agents                                                                     */
/* -------------------------------------------------------------------------- */

test('agent roles adapt with mirror-skill path resolution', () => {
  const agents = documents.filter((candidate) => candidate.kind === 'agent')
  assert.equal(agents.length, 4)
  for (const document of agents) {
    const parsed = readParsed(document)
    const mirror = AGENT_MIRROR[parsed.data.name]
    assert.ok(mirror !== undefined, `${document.name}: has a mirror skill`)
    const adapted = adapter.adaptAgentBody(parsed.body, { agent: parsed.data.name, skill: mirror })
    assertClean(adapted, document.name)
    assert.ok(adapted.includes(`Agent role: \`${parsed.data.name}\``), `${document.name}: role identity`)
    assert.ok(adapted.includes('`subagent` tool'), `${document.name}: dispatch tool`)
    assert.ok(adapted.includes(corpusRoot), `${document.name}: payload root`)
    assert.ok(adapted.includes(`Skill directory: \`${join(corpusRoot, mirror)}\``), `${document.name}: mirror skill directory in prelude`)
    assert.ok(adapted.includes('Skill-relative prefixes — resolve against the skill directory: `references/`, `agents/`, `templates/`, `examples/`.'), `${document.name}: skill-relative prefixes stated`)
    assert.ok(adapted.includes('Payload-root-relative prefixes'), `${document.name}: payload-root prefixes stated`)
    assert.ok(!adapted.includes('Every relative reference resolves against the payload root'), `${document.name}: not the all-payload-root fallback`)
  }
  const screening = adaptDocument(documents.find((document) => document.name === 'screening_reviewer_agent')).text
  assert.ok(screening.includes('`ars-agent-screening-reviewer`'))
  assert.ok(screening.includes('`sr-screener/scripts/build_workflow.py`'), 'explicit payload-root reference preserved')
  assert.ok(screening.includes(join(corpusRoot, 'sr-screener', 'scripts')), 'sr-screener script directory explained in the prelude')
  const architecture = adaptDocument(documents.find((document) => document.name === 'research_architect_agent')).text
  assert.ok(architecture.includes(`Skill directory: \`${join(corpusRoot, 'deep-research')}\``), 'deep-research mirror for the architect role')
  const fallback = adapter.adaptAgentBody('body', { agent: 'synthesis_agent', skill: null })
  assert.ok(fallback.includes('Every relative reference resolves against the payload root'), 'legacy fallback when no mirror is supplied')
})

/* -------------------------------------------------------------------------- */
/* Announce                                                                   */
/* -------------------------------------------------------------------------- */

function fakeContext() {
  const host = createHost()
  return { ctx: host.ctx, sections: host.state.sections, effects: host.state.effects }
}

test('listCommandNames matches the 16 upstream commands and the fallback list', () => {
  const names = listCommandNames(paths)
  assert.equal(names.length, 16)
  assert.deepEqual([...names].sort(), [...FALLBACK_COMMAND_NAMES].sort())
  assert.equal(FALLBACK_COMMAND_NAMES.length, 16)
  assert.deepEqual(listCommandNames({}), [...FALLBACK_COMMAND_NAMES])
})

test('registerAnnounce registers one effect-owned section with the ARS inventory', () => {
  const { ctx, sections, effects } = fakeContext()
  const registered = registerAnnounce(ctx, { paths, adapter, config: { announce: true } })
  assert.equal(registered, true)
  assert.equal(effects.length, 1, 'registration is owned by one ctx.effect')
  assert.equal(sections.length, 1)
  const section = sections[0]
  assert.equal(section.name, ANNOUNCE_SECTION_NAME)
  assert.equal(section.order, ANNOUNCE_ORDER)
  assert.equal(section.order, 40)
  assert.equal(section.interpolate, false)
  for (const skill of SKILL_NAMES) assert.ok(section.text.includes(`\`${skill}\``), `announce names ${skill}`)
  for (const skill of Object.values(AGENT_NAME_TO_SKILL)) assert.ok(section.text.includes(`\`${skill}\``), `announce names ${skill}`)
  assert.equal(listCommandNames(paths).length, 16)
  for (const command of listCommandNames(paths)) assert.ok(section.text.includes(`/${command}`), `announce names /${command}`)
  assert.ok(section.text.includes(corpusRoot))
  assert.ok(section.text.includes('academic research requests'))
  assert.ok(section.text.includes('Commands (16)'))
  assert.deepEqual(adapter.lint(section.text), [])
  assert.ok(!section.text.includes('{{'), 'no interpolation markers')
})

test('config.announce === false suppresses the section', () => {
  const { ctx, sections, effects } = fakeContext()
  assert.equal(registerAnnounce(ctx, { paths, adapter, config: { announce: false } }), false)
  assert.equal(effects.length, 0)
  assert.equal(sections.length, 0)
})

test('registerAnnounce requires a system prompt registry', () => {
  assert.throws(() => registerAnnounce({}, { paths, adapter }), /systemPrompt/u)
  assert.throws(() => registerAnnounce({ systemPrompt: {} }, { paths, adapter }), /section/u)
  assert.throws(() => registerAnnounce(fakeContext().ctx, { paths, adapter: {} }), /announceText/u)
})

test('announceText accepts plain command names and objects', () => {
  const text = adapter.announceText({
    commands: ['ars-3w', { name: '/ars-full' }, 'ars-3w'],
    agentSkills: ['ars-agent-synthesis'],
  })
  assert.ok(text.includes('/ars-3w'))
  assert.ok(text.includes('/ars-full'))
  assert.equal((text.match(/\/ars-3w/gu) ?? []).length, 1, 'deduplicated')
})

/* -------------------------------------------------------------------------- */
/* Lint                                                                       */
/* -------------------------------------------------------------------------- */

test('lint reports every residual token with counts and first line', () => {
  assert.deepEqual(adapter.lint('clean text'), [])
  const dirty = [
    'ok',
    '${CLAUDE_PLUGIN_ROOT} and ${CLAUDE_PLUGIN_ROOT}',
    'academic-research-skills:deep-research',
    'the Skill tool',
    'subagent_type: x',
    'python3 scripts/a.py',
    'python scripts/b.py',
  ].join('\n')
  const findings = adapter.lint(dirty)
  assert.equal(findings.length, 6)
  const joined = findings.join('\n')
  assert.ok(joined.includes('${CLAUDE_PLUGIN_ROOT} × 2 (first at line 2)'))
  assert.ok(joined.includes('academic-research-skills: × 1 (first at line 3)'))
  assert.ok(joined.includes('Skill tool × 1'))
  assert.ok(joined.includes('subagent_type × 1'))
  assert.ok(joined.includes('python3 scripts/ × 1'))
  assert.ok(joined.includes('python scripts/ × 1'))
  assert.throws(() => adapter.lint(undefined), /string/u)
})

/* -------------------------------------------------------------------------- */
/* Payload agreement (only when payload-porter has produced the payload)      */
/* -------------------------------------------------------------------------- */

test('the built payload adapts exactly like the upstream clone when present', async (t) => {
  if (!hasDocumentSet(builtPayloadRoot)) {
    t.skip('payload/ is not built yet')
    return
  }
  const payloadPaths = createTestPaths(builtPayloadRoot)
  const payloadAdapter = createAdapter({ paths: payloadPaths })
  const payloadDocuments = listDocuments(builtPayloadRoot)
  assert.equal(payloadDocuments.length, documents.length)

  const differences = []
  for (const document of payloadDocuments) {
    const payloadParsed = readParsed(document)
    const payloadText = document.kind === 'skill'
      ? payloadAdapter.adaptSkillBody(payloadParsed.body, { skill: document.name })
      : document.kind === 'agent'
        ? payloadAdapter.adaptAgentBody(payloadParsed.body, {
          agent: payloadParsed.data.name,
          skill: AGENT_MIRROR[payloadParsed.data.name],
        })
        : payloadAdapter.adaptCommandBody(payloadParsed.body, {
          command: payloadParsed.data.name,
          skill: null,
          args: 'test request 42',
        })
    assert.deepEqual(payloadAdapter.lint(payloadText), [], `${document.name}: payload adaptation clean`)
    const repoFile = join(repoRoot, document.file.slice(builtPayloadRoot.length + 1))
    if (!existsSync(repoFile)) continue
    const repoParsed = parseMarkdownFile(readFileSync(repoFile, 'utf8'))
    if (JSON.stringify(repoParsed.data) !== JSON.stringify(payloadParsed.data)) {
      differences.push(`${document.name}: frontmatter differs`)
      continue
    }
    const adaptedFromRepo = document.kind === 'skill'
      ? adapter.adaptSkillBody(repoParsed.body, { skill: document.name })
      : document.kind === 'agent'
        ? adapter.adaptAgentBody(repoParsed.body, {
          agent: repoParsed.data.name,
          skill: AGENT_MIRROR[repoParsed.data.name],
        })
        : adapter.adaptCommandBody(repoParsed.body, {
          command: repoParsed.data.name,
          skill: null,
          args: 'test request 42',
        })
    const normalizedPayload = payloadText.split(builtPayloadRoot).join('<ROOT>')
    const normalizedRepo = adaptedFromRepo.split(corpusRoot).join('<ROOT>')
    if (normalizedPayload !== normalizedRepo) differences.push(`${document.name}: adapted text differs`)
  }
  t.diagnostic(`payload documents checked: ${payloadDocuments.length}; differences: ${differences.length}`)
  assert.deepEqual(differences, [], 'payload and upstream clone agree')
})
