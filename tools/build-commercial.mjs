#!/usr/bin/env node
/**
 * Build a commercial-clearance copy of this plugin.
 *
 * The default checkout is deliberately byte-identical to the upstream payload
 * and remains CC BY-NC 4.0. A commercial release needs a different artifact:
 *
 *   - Semantic Scholar is skipped when ARS_COMMERCIAL_MODE=1 (its API licence
 *     is non-commercial);
 *   - the condensed COREQ and STROBE checklists are replaced by pointers
 *     (permission required from OUP / the STROBE Initiative);
 *   - licence notes are added for PRISMA, PRISMA-P, CONSORT, SQUIRE, and
 *     PaperOrchestra;
 *   - the payload hashes and the pinned contract are recomputed for the copy.
 *
 * IEEE policy quotations are shortened/paraphrased by default so they fit the
 * commercial budget (--ieee-budget, default 50 words). --keep-ieee-quotes
 * preserves the verbatim text. Paraphrasing changes policy-anchor semantics;
 * review the diff before release. With --strict the build fails if the measured
 * budget is still exceeded.
 *
 * This script does not grant any licence. It only makes the technical artifact
 * match a commercial clearance the operator must obtain separately.
 *
 * Usage:
 *   node tools/build-commercial.mjs --out ../ars-commercial
 *   node tools/build-commercial.mjs --out ../ars-commercial --strict
 *   node tools/build-commercial.mjs --out ../ars-commercial --force
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { buildReferenceIndex } from './build-payload.mjs'

const pluginRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

const args = process.argv.slice(2)
const outArg = valueOf('--out') ?? 'dist/commercial'
const out = resolve(pluginRoot, outArg)
const force = args.includes('--force')
const strict = args.includes('--strict')
const keepIeeeQuotes = args.includes('--keep-ieee-quotes')
const IEEE_BUDGET = Number(valueOf('--ieee-budget') ?? 50)

if (!Number.isFinite(IEEE_BUDGET) || IEEE_BUDGET < 0) {
  fail('--ieee-budget must be a non-negative number')
}
if (existsSync(out)) {
  if (!force) fail(`output exists: ${out} (pass --force to replace it)`)
  rmSync(out, { recursive: true, force: true })
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

const EXCLUDED_TOP = new Set(['.git', 'node_modules', 'dist', '.workbuddy'])
cpSync(pluginRoot, out, {
  recursive: true,
  filter: (source) => {
    const rel = relative(pluginRoot, source)
    if (rel === '') return true
    return !EXCLUDED_TOP.has(rel.split(sep)[0])
  },
})

const payloadRoot = join(out, 'payload')
const patches = []

/* -------------------------------------------------------------------------- */
/* Text patches                                                               */
/* -------------------------------------------------------------------------- */

function replaceOnce(text, find, replacement, label) {
  const count = text.split(find).length - 1
  if (count !== 1) {
    fail(`${label}: expected exactly 1 occurrence, found ${count}`)
  }
  return text.replace(find, replacement)
}

function replaceRegexOnce(text, regex, replacement, label) {
  const matches = [...text.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g'))]
  if (matches.length !== 1) {
    fail(`${label}: expected exactly 1 match, found ${matches.length}`)
  }
  return text.replace(regex, replacement)
}

function patchFile(relPath, transform, label) {
  const abs = join(payloadRoot, relPath)
  const before = readFileSync(abs, 'utf8')
  const after = transform(before)
  if (after === before) fail(`${label}: patch produced no change`)
  writeFileSync(abs, after)
  patches.push(label)
}

function patchOutFile(relPath, transform, label) {
  const abs = join(out, relPath)
  const before = readFileSync(abs, 'utf8')
  const after = transform(before)
  if (after === before) fail(`${label}: patch produced no change`)
  writeFileSync(abs, after)
  patches.push(label)
}

/* S2: skip the non-commercial resolver when the commercial env flag is set. */
patchFile(
  'scripts/verification_gate/__init__.py',
  (text) => {
    let next = text
    if (!/^import os$/m.test(next)) {
      next = replaceOnce(
        next,
        'from __future__ import annotations\n',
        'from __future__ import annotations\n\nimport os\n',
        'gate: add import os',
      )
    }
    const find = `            "semantic_scholar": _run_semantic_scholar(
                entry, clients["semantic_scholar"], cache=cache,
                bypass_stale=revalidate_stale),`
    const replacement = `            "semantic_scholar": (
                (_outcome(STATUS_SKIPPED, None), False)
                if os.environ.get("ARS_COMMERCIAL_MODE") == "1"
                else _run_semantic_scholar(
                    entry, clients["semantic_scholar"], cache=cache,
                    bypass_stale=revalidate_stale)
            ),`
    return replaceOnce(next, find, replacement, 'gate: skip Semantic Scholar in commercial mode')
  },
  'verification_gate skips Semantic Scholar when ARS_COMMERCIAL_MODE=1',
)

/* COREQ / STROBE: replace the condensed derivative with a pointer. */
patchFile(
  'deep-research/references/equator_reporting_guidelines.md',
  (text) => {
    let next = text
    next = replaceRegexOnce(
      next,
      /^## 4\. STROBE — Observational Study Condensed Checklist\n[\s\S]*?(?=^## 5\. COREQ)/m,
      `## 4. STROBE — Observational Study (commercial pointer)

The condensed STROBE checklist is not included in this commercial build because
the STROBE Initiative asks users to contact the coordinating group before
re-publishing STROBE material. Use the official checklist:
https://www.strobe-statement.org/

---

`,
      'STROBE: replace condensed checklist with pointer',
    )
    next = replaceRegexOnce(
      next,
      /^## 5\. COREQ — Qualitative Research Condensed Checklist\n[\s\S]*?(?=^## 6\. SQUIRE)/m,
      `## 5. COREQ — Qualitative Research (commercial pointer)

The condensed COREQ checklist is not included in this commercial build because
the COREQ article is published under the Oxford University Press standard
publication model. Use the official checklist:
https://www.equator-network.org/reporting-guidelines/coreq/

---

`,
      'COREQ: replace condensed checklist with pointer',
    )
    next = replaceOnce(
      next,
      '**Version**: PRISMA 2020 (latest)',
      '**Version**: PRISMA 2020 (latest)\n**License**: CC BY 4.0 (Page et al., 2021).',
      'PRISMA: add licence note',
    )
    next = replaceOnce(
      next,
      '**Version**: CONSORT 2010 + extensions',
      '**Version**: CONSORT 2010 + extensions\n**Source**: BMC Medicine 2010;8:18 (CC BY 2.0); pin this version, not the CC BY-NC-ND 4.0 reprint.',
      'CONSORT: pin BMC Medicine CC BY 2.0 source',
    )
    next = replaceOnce(
      next,
      '**Version**: SQUIRE 2.0',
      '**Version**: SQUIRE 2.0\n**License**: CC BY-NC 4.0.',
      'SQUIRE: add licence note',
    )
    return next
  },
  'EQUATOR: remove COREQ/STROBE derivatives; add PRISMA/CONSORT/SQUIRE notes',
)

patchFile(
  'deep-research/templates/prisma_protocol_template.md',
  (text) => replaceOnce(
    text,
    '**Reference**: Shamseer et al. (2015). BMJ, 349, g7647. https://doi.org/10.1136/bmj.g7647',
    '**Reference**: Shamseer et al. (2015). BMJ, 349, g7647. https://doi.org/10.1136/bmj.g7647\n**License**: CC BY 4.0 (PRISMA-P Group).',
    'PRISMA-P: add licence note',
  ),
  'PRISMA-P template: add CC BY 4.0 note',
)

patchFile(
  'academic-paper/references/anti_leakage_protocol.md',
  (text) => replaceOnce(
    text,
    '**Source**: Adapted from PaperOrchestra (Song et al., 2026, Appendix D.4)',
    '**Source**: Adapted from PaperOrchestra (Song et al., 2026, Appendix D.4)\n**License**: CC BY 4.0.',
    'PaperOrchestra: add licence note',
  ),
  'Anti-leakage protocol: add PaperOrchestra CC BY 4.0 note',
)

/* -------------------------------------------------------------------------- */
/* IEEE quote budget                                                          */
/* -------------------------------------------------------------------------- */

function wordCount(text) {
  return (text.match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) ?? []).length
}

function quotedWords(text) {
  const quotes = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue
    for (const cell of line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')) {
      const match = cell.trim().match(/^"([^"]{10,})"/)
      if (match) quotes.push(match[1])
    }
  }
  const unique = [...new Set(quotes)]
  return {
    cells: quotes.length,
    unique: unique.length,
    words: unique.reduce((sum, quote) => sum + wordCount(quote), 0),
    quotes: unique,
  }
}

function section(text, start, end) {
  const startIndex = text.indexOf(start)
  if (startIndex < 0) return ''
  const rest = text.slice(startIndex + start.length)
  const endIndex = rest.search(end)
  return endIndex < 0 ? rest : rest.slice(0, endIndex)
}

const ieeeFiles = [
  join(payloadRoot, 'academic-paper/references/policy_anchor_table.md'),
  join(payloadRoot, 'docs/design/2026-05-13-ai-disclosure-schema-discovery.md'),
]
if (!keepIeeeQuotes) {
  const paraphrases = [
    [
      '"specific sections of the article that use AI-generated content shall be identified and accompanied by a brief explanation regarding the level at which the AI system was used to generate the content"',
      '"specific sections of the article that use AI-generated content shall be identified" — IEEE also requires a brief explanation of the level of AI use.',
      'IEEE: shorten the section-locator quote',
    ],
    [
      '"accompanied by a brief explanation regarding the level at which the AI system was used to generate the content"',
      'IEEE asks for a brief explanation of the level at which the AI system was used',
      'IEEE: paraphrase the level-of-use passage',
    ],
    [
      '"The use of AI systems for editing and grammar enhancement is common practice and, as such, is generally outside the intent of the above policy. In this case, disclosure as noted above is recommended."',
      '"generally outside the intent of the above policy" — editing and grammar assistance is common practice; disclosure is recommended but not required.',
      'IEEE: shorten the copyediting quote',
    ],
    [
      '"The use of content generated by artificial intelligence (AI) in an article (including but not limited to text, figures, images, and code) shall be disclosed in the acknowledgments section"',
      "IEEE's disclosure mandate covers AI-generated text, figures, images, and code",
      'IEEE: paraphrase the image-rights passage',
    ],
  ]
  let changed = 0
  for (const file of ieeeFiles) {
    let text = readFileSync(file, 'utf8')
    for (const [find, replacement, label] of paraphrases) {
      const count = text.split(find).length - 1
      if (count === 0) continue
      text = text.split(find).join(replacement)
      changed += count
      console.log(`${label}: ${count} occurrence(s)`)
    }
    writeFileSync(file, text)
  }
  if (changed > 0) patches.push('IEEE: paraphrase/shorten verbatim policy quotations')
}

const policyTable = readFileSync(ieeeFiles[0], 'utf8')
const designDoc = readFileSync(ieeeFiles[1], 'utf8')
const ieeePolicy = quotedWords(section(policyTable, '## Anchor: ieee', /^## /m))
const ieeeDesign = quotedWords(section(designDoc, '### 4.6 Per-anchor matrix — IEEE', /^### /m))
const ieeeUniqueQuotes = [...new Set([...ieeePolicy.quotes, ...ieeeDesign.quotes])]
const ieeeWords = ieeeUniqueQuotes.reduce((sum, quote) => sum + wordCount(quote), 0)
const ieeeUnique = ieeeUniqueQuotes.length

console.log(`IEEE quote budget: ${ieeeWords} words across ${ieeeUnique} unique quotes (limit ${IEEE_BUDGET})`)
if (strict && ieeeWords > IEEE_BUDGET) {
  fail(
    `IEEE quotations still exceed the commercial budget (${ieeeWords} > ${IEEE_BUDGET}). ` +
      'Paraphrase them or obtain permission, then rebuild. ' +
      'Use --no-strict (default) only for a non-releasable working copy.',
  )
}

/* -------------------------------------------------------------------------- */
/* Payload inventory and hashes                                               */
/* -------------------------------------------------------------------------- */

const GENERATED = new Set(['PROVENANCE.json', 'REFERENCE-INDEX.json'])

function sha256File(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex')
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function modeString(mode) {
  return mode.toString(8)
}

function summarize(files) {
  const sorted = [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const pathListSha256 = sha256Text(sorted.map((file) => `${file.rel}\n`).join(''))
  const contentSha256 = sha256Text(
    sorted.map((file) => `${file.rel}\u0000${file.sha256}\u0000${modeString(file.mode)}\n`).join(''),
  )
  const modes = {}
  for (const file of sorted) {
    const key = modeString(file.mode)
    modes[key] = (modes[key] ?? 0) + 1
  }
  return {
    files: sorted.length,
    bytes: sorted.reduce((sum, file) => sum + file.bytes, 0),
    pathListSha256,
    contentSha256,
    modes,
  }
}

function inventory(root) {
  const files = []
  let directories = 0
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      const st = statSync(abs)
      if (st.isDirectory()) {
        directories += 1
        walk(abs)
      } else {
        const rel = relative(root, abs).split(sep).join('/')
        if (GENERATED.has(rel)) continue
        files.push({
          rel,
          bytes: st.size,
          mode: st.mode & 0o777,
          sha256: sha256File(abs),
        })
      }
    }
  }
  walk(root)
  const total = summarize(files)
  const groups = new Map()
  for (const file of files) {
    const key = file.rel.includes('/') ? file.rel.split('/')[0] : '.'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(file)
  }
  const byTopLevel = {}
  for (const [key, group] of groups) byTopLevel[key] = summarize(group)
  return { ...total, directories, byTopLevel }
}

const inv = inventory(payloadRoot)

/* -------------------------------------------------------------------------- */
/* PROVENANCE and contract                                                    */
/* -------------------------------------------------------------------------- */

const provenancePath = join(payloadRoot, 'PROVENANCE.json')
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))

// The reference index is generated, not part of the content digest, but the
// commercial build changes the set of Markdown references (COREQ/STROBE are
// replaced by pointers). Regenerate it before the contract check.
const referenceIndex = buildReferenceIndex({
  payloadRoot,
  generatedAt: provenance.generatedAt,
  upstream: {
    commit: provenance.upstream?.commit,
    pluginVersion: provenance.upstream?.pluginVersion,
  },
})
writeFileSync(
  join(payloadRoot, 'REFERENCE-INDEX.json'),
  `${JSON.stringify(referenceIndex, null, 2)}\n`,
)
const refSummary = referenceIndex.summary

provenance.contentSha256 = inv.contentSha256
provenance.pathListSha256 = inv.pathListSha256
provenance.totals = {
  files: inv.files,
  bytes: inv.bytes,
  directories: inv.directories,
  modes: inv.modes,
}
provenance.byTopLevel = inv.byTopLevel
if (provenance.payload?.pinned) {
  provenance.payload.pinned.contentSha256 = inv.contentSha256
  provenance.payload.pinned.pathListSha256 = inv.pathListSha256
}
provenance.commercialBuild = {
  generatedAt: new Date().toISOString(),
  sourceCommit: provenance.upstream?.commit ?? null,
  upstreamVersion: provenance.upstream?.pluginVersion ?? null,
  patches,
  ieeeQuoteWords: ieeeWords,
  ieeeQuoteBudget: IEEE_BUDGET,
  ieeeClear: ieeeWords <= IEEE_BUDGET,
}
writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`)

const contractPath = join(out, 'lib/payload-contract.js')
let contract = readFileSync(contractPath, 'utf8')
const snapshotMatch = contract.match(/export const PAYLOAD_SNAPSHOT = Object\.freeze\(\{[\s\S]*?\n\}\)/)
if (!snapshotMatch) fail('payload-contract: PAYLOAD_SNAPSHOT block not found')
const generatedAt = snapshotMatch[0].match(/generatedAt: '([^']+)'/)?.[1] ?? provenance.generatedAt
const generatedAtSource = snapshotMatch[0].match(/generatedAtSource: '([^']+)'/)?.[1] ?? 'git-commit-date'
contract = contract.replace(
  snapshotMatch[0],
  `export const PAYLOAD_SNAPSHOT = Object.freeze({
  files: ${inv.files},
  bytes: ${inv.bytes},
  directories: ${inv.directories},
  modes: Object.freeze({ ${Object.entries(inv.modes).map(([mode, count]) => `${mode}: ${count}`).join(', ')} }),
  generatedAt: '${generatedAt}',
  generatedAtSource: '${generatedAtSource}',
  contentSha256: '${inv.contentSha256}',
  pathListSha256: '${inv.pathListSha256}',
})`,
)

const order = [
  'deep-research',
  'academic-paper',
  'academic-paper-reviewer',
  'academic-pipeline',
  'sr-screener',
  'commands',
  'agents',
  'shared',
  'scripts',
  'hooks',
  'docs',
  'examples',
  'tools',
  '.',
]
const byTopLevelLines = order
  .filter((key) => inv.byTopLevel[key])
  .map((key) => `  '${key}': Object.freeze({ files: ${inv.byTopLevel[key].files}, bytes: ${inv.byTopLevel[key].bytes} }),`)
  .join('\n')
const byTopMatch = contract.match(/export const BY_TOP_LEVEL = Object\.freeze\(\{[\s\S]*?\n\}\)/)
if (!byTopMatch) fail('payload-contract: BY_TOP_LEVEL block not found')
contract = contract.replace(
  byTopMatch[0],
  `export const BY_TOP_LEVEL = Object.freeze({\n${byTopLevelLines}\n})`,
)

const referenceMatch = contract.match(/export const REFERENCE_INDEX = Object\.freeze\(\{[\s\S]*?\n\}\)/)
if (!referenceMatch) fail('payload-contract: REFERENCE_INDEX block not found')
contract = contract.replace(
  referenceMatch[0],
  `export const REFERENCE_INDEX = Object.freeze({
  filesScanned: ${refSummary.filesScanned},
  references: ${refSummary.references},
  resolved: ${refSummary.resolved},
  missing: ${refSummary.missing},
  missingTargets: ${refSummary.missingTargets},
  identifiers: ${refSummary.identifiers},
  placeholders: ${refSummary.placeholders},
})`,
)
writeFileSync(contractPath, contract)

/* -------------------------------------------------------------------------- */
/* Package metadata                                                           */
/* -------------------------------------------------------------------------- */

const packagePath = join(out, 'package.json')
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
pkg.private = true
pkg.version = pkg.version.includes('-commercial') ? pkg.version : `${pkg.version}-commercial.1`
pkg.description = `Commercial build (requires a separate commercial licence). ${pkg.description}`
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

const citationPath = join(out, 'CITATION.cff')
let citation = readFileSync(citationPath, 'utf8')
citation = citation.replace(/^version: .*$/m, `version: ${pkg.version}`)
writeFileSync(citationPath, citation)

patchOutFile(
  'tools/verify-install.mjs',
  (text) => replaceOnce(
    text,
    "equal(manifest.private, false, 'package private')",
    "equal(manifest.private, manifest.version.includes('-commercial'), 'package private (commercial builds stay private)')",
    'verify-install: accept a private commercial build',
  ),
  'verify-install accepts a private commercial build',
)

/* -------------------------------------------------------------------------- */
/* Build note and verification                                                */
/* -------------------------------------------------------------------------- */

const note = `# Commercial build

Generated: ${new Date().toISOString()}
Source: ${pluginRoot}
Output: ${out}

## Content clearance applied

${patches.map((patch) => `- ${patch}`).join('\n')}

- **IEEE quotations**: ${
  keepIeeeQuotes
    ? `kept verbatim at ${ieeeWords} quoted words (budget ${IEEE_BUDGET}); not cleared for release.`
    : `paraphrased/shortened to ${ieeeWords} quoted words (budget ${IEEE_BUDGET}).`
}

## Not applied (must be resolved before release)

- **Fonts**: the showcase PDFs still embed PingFang HK (Apple). Replace it with
  an OFL font and re-render the affected PDFs before a commercial release.
- **Licence**: \`package.json\` is marked \`private: true\`; replace \`LICENSE\`
  and the commercial terms only after the upstream author and, where needed,
  the third-party rights holders grant them. This script does not grant a
  licence.

## Verify

\`\`\`sh
cd ${out}
node tools/check-payload.mjs
node --test test/*.test.mjs
\`\`\`

## What this build does not decide

- Whether the upstream CC BY-NC 4.0 permission has been converted into a
  commercial licence.
- Whether COREQ/STROBE permission has been granted. If it is, restore the
  original sections from the non-commercial checkout.
- Whether IEEE has granted permission for the quotations.
`
writeFileSync(join(out, 'COMMERCIAL-BUILD.md'), note)

const check = spawnSync(process.execPath, ['tools/check-payload.mjs'], {
  cwd: out,
  encoding: 'utf8',
})
process.stdout.write(check.stdout ?? '')
process.stderr.write(check.stderr ?? '')
if (check.status !== 0) {
  fail('commercial build failed check-payload; see output above')
}

console.log(`\ncommercial build: ${out}`)
console.log(`patches: ${patches.length}`)
console.log(`payload: ${inv.files} files, ${inv.bytes} bytes, ${inv.directories} dirs`)
console.log(`IEEE quotes: ${ieeeWords} words (limit ${IEEE_BUDGET}); strict=${strict}`)
console.log(`package: ${pkg.version}, private=${pkg.private}`)

/* -------------------------------------------------------------------------- */

function valueOf(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function fail(message) {
  console.error(`build-commercial: ${message}`)
  process.exit(1)
}
