# Upstream 3.24.1 review — pin `b34c63f` → tag `v3.24.1`

**Status:** reviewed 2026-11-04 against the upstream tag and the current port tree.
No payload rebuild, no adapter change, and no full test run were performed for this
review. Pins were recomputed read-only with
`node tools/check-upstream.mjs --ref bcbcac39… --print-snapshot --json`.

**Scope:** `Imbad0202/academic-research-skills` tag `v3.24.1` versus the port's
pin `b34c63f` (v3.24.0). Also covers the post-tag commits that the scheduled drift
report saw (`main@2e02041`) and current `main@74c1250`.

## 1. Identity and ancestry

| Ref | Commit | Date | Notes |
|---|---|---|---|
| Port pin | `b34c63f828b3535f403079a4f42bc7955da2f64b` | 2026-10-27 | upstream `v3.24.0`, shipped since adapter 2.1.0 |
| Tag `v3.24.1` | tag object `16ab4b386d009ac55b023869de464d1ce0c52094` → commit `bcbcac39e874744cda98d6ddaaf765cfd00b0e40` | 2026-11-02T10:34:13+08:00 | annotated, SSH-signed tag; `git` peels it to the release commit |
| Issue #2 snapshot | `main` @ `2e02041a3b821a160d98c9398f173c484ac759a8` | 2026-11-02 | 3 commits after the tag; the CI report compared this, not the tag |
| Current `main` | `74c125051cc9c47c29408095d5e69f4c3c274d4d` | 2026-11-04 | 4 commits after the tag |

Ancestry confirmed with the GitHub compare API: `b34c63f...bcbcac39` is
**6 commits ahead, 0 behind**; `bcbcac39...2e02041` is 3 ahead;
`bcbcac39...74c1250` is 4 ahead. The tag is therefore a release boundary on the
pinned branch, not a side branch. The upstream `v3.24.0` tag (`c226d24…`) also
peels to the pin, so `b34c63f` is a released commit, not a branch accident.

Release summary (upstream `CHANGELOG.md` at the tag): claude.ai / Claude Desktop
install repairs, reviewer card confirmation, Brazilian Portuguese README. “No new
skill or mode.”

## 2. Change inventory

`git diff --name-status b34c63f..bcbcac39` reports **61 paths: 3 added, 5 deleted,
53 modified**. The port's payload-only comparison (which excludes `skills/`,
localized READMEs, and other non-payload paths) reports **2 added, 0 removed,
42 modified** — the counts in issue #2.

### 2.1 Payload-included changes (44)

Adapter-registered means the path matches the port's `REGISTERED` patterns
(`<skill>/SKILL.md`, `commands/*.md`, `agents/*.md`).

| Path | Status | What changed | Adapter-registered |
|---|---|---|---|
| `CITATION.cff` | M | upstream `version: 3.24.1`, `date-released: 2026-11-02` | no |
| `MODE_REGISTRY.md` | M | `Last updated: v3.24.1` only; still 35 modes | no |
| `POSITIONING.md` | M | citation version 3.24.1 | no |
| `README.md` | M | version badge + release link, pt-BR language link, claude.ai install paragraph, 3.24.1 changelog section | no |
| `academic-paper-reviewer/SKILL.md` | M | Checkpoint Rule 1 becomes an IRON RULE: show the Reviewer Configuration Cards, end the turn, dispatch no seat until the user accepts the whole set; scope covers `full`, `methodology-focus`, `guided`, `quick`, and a Stage 3 review from the pipeline | **yes** |
| `academic-pipeline/SKILL.md` | M | version strings; Stage 3 checkpoint now names the in-stage card stop | **yes** |
| `academic-pipeline/agents/pipeline_orchestrator_agent.md` | M | checkpoint rule 4 adds the Stage 3 card-confirmation stop | no |
| `agents/report_compiler_agent.md` | M | frontmatter `name: report-compiler-agent`; body names the plugin-scoped hyphenated agent | **yes** |
| `agents/research_architect_agent.md` | M | same | **yes** |
| `agents/screening_reviewer_agent.md` | M | same; line 86 names `academic-research-skills:screening-reviewer-agent` | **yes** |
| `agents/synthesis_agent.md` | M | same | **yes** |
| `deep-research/agents/report_compiler_agent.md` | M | mirror copy; frontmatter name hyphenated | no |
| `deep-research/agents/research_architect_agent.md` | M | mirror copy | no |
| `deep-research/agents/synthesis_agent.md` | M | mirror copy | no |
| `sr-screener/SKILL.md` | M | reviewer dispatch name hyphenated; copy-to-`.claude/agents/` wording | **yes** |
| `sr-screener/agents/screening_reviewer_agent.md` | M | mirror copy; scoped name hyphenated | no |
| `sr-screener/examples/example_config_dta.json` | M | `agent_type` hyphenated | no |
| `sr-screener/references/orchestration.md` | M | dispatch names; pre-#1037 underscore note | no |
| `sr-screener/references/protocol_template.md` | M | `agent_type` table row updated | no |
| `sr-screener/scripts/build_outputs.py` | M | methods sentence uses `srlib.is_lean_reviewer` | no |
| `sr-screener/scripts/build_workflow.py` | M | emitted `agentType` uses `srlib.reviewer_agent_type` | no |
| `sr-screener/scripts/srlib.py` | M | adds `reviewer_agent_type`, `is_lean_reviewer`, `_identity_agent_type`; plugin's old underscore name maps to the new one; stage identity treats the plugin's old/new names as one | no |
| `sr-screener/templates/screening_config.template.json` | M | default `agent_type` hyphenated | no |
| `scripts/_ci_pytest_manifest.toml` | M | upstream CI test manifest (2 new tests) | no |
| `scripts/announce-ars-loaded.sh` | M | plugin-agent list hyphenated | no |
| `scripts/ars_phase_scope_manifest.json` | M | manifest keys for the four agents hyphenated | no |
| `scripts/ars_write_scope_guard.py` | M | adds `LEGACY_AGENT_NAMES` (underscore → hyphen); `_manifest_key` maps old names before lookup | no |
| `scripts/check_pipeline_boundary_semantics.py` | M | content-lock hashes for the two changed pipeline files | no |
| `scripts/check_reviewer_card_confirmation.py` | **A** | new lint pinning the card-confirmation rule literals; imports `_skill_lint`; stdlib only | no |
| `scripts/test_check_reviewer_card_confirmation.py` | **A** | mutation tests for the new lint | no |
| `scripts/check_reviewer_role_label.py` | M | adds pt-BR README required labels | no |
| `scripts/check_skill_inventory_parity.py` | M | checks `plugin.json` `skills[]`; a root `skills/` directory is now a violation | no |
| `scripts/check_spec_consistency.py` | M | README pt-BR and spec pins | no |
| `scripts/test_ars_write_scope_guard.py` | M | legacy-name tests | no |
| `scripts/test_check_skill_inventory_parity.py` | M | new parity tests | no |
| `scripts/test_check_spec_consistency.py` | M | updated | no |
| `scripts/test_check_v3_10_134_write_scope.py` | M | updated | no |
| `scripts/test_sr_screener_pipeline.py` | M | updated for the name normalization | no |
| `docs/ARCHITECTURE.md` | M | version strings (`v3.24.1`) | no |
| `docs/CONTROL_AVAILABILITY.md` | M | claude.ai channel matrix, `Untested` legend, note 11 | no |
| `docs/PERFORMANCE.md` | M | agent names hyphenated (with pre-#1037 note) | no |
| `docs/PERFORMANCE.zh-TW.md` | M | same | no |
| `docs/SETUP.md` | M | claude.ai / Desktop install Method 0; skill-upload scope notes | no |
| `docs/SETUP.zh-TW.md` | M | same | no |

### 2.2 Payload-excluded changes (17)

| Path | Status | Why it still matters |
|---|---|---|
| `.claude-plugin/plugin.json` | M | now declares `skills[]`; source of the builder's `name`/`version`/`license` provenance |
| `.claude-plugin/marketplace.json` | M | keeps its `skills` array; not in payload |
| `.claude/CLAUDE.md` | M | agent list hyphenated; Claude-only install prose |
| `.github/workflows/spec-consistency.yml` | M | upstream CI |
| `CHANGELOG.md` | M | release notes; excluded by design |
| `CONTRIBUTING.md` | M | excluded by design |
| `README.es-ES.md`, `README.ja-JP.md`, `README.ko-KR.md`, `README.zh-CN.md`, `README.zh-TW.md` | M | localized READMEs; excluded by `localizedReadmeReason` |
| `README.pt-BR.md` | **A** | new localization; also excluded by `localizedReadmeReason` |
| `skills/academic-paper`, `skills/academic-paper-reviewer`, `skills/academic-pipeline`, `skills/deep-research`, `skills/sr-screener` | **D** (5 symlinks) | **critical for the port**: the contract still asserts these refused symlinks and a `skills` exclusion |

### 2.3 Post-tag commits

| Commit | Subject | Substance |
|---|---|---|
| `58288a5` | fix(sr-screener): state what the reviewer tool list enforces in the methods text (#1039) | substantive: `sr-screener/scripts/build_outputs.py` + test |
| `a41f3b2` | docs(zh-TW): replace em dashes in SETUP and README (#1044) | docs |
| `2e02041` | docs: record that uploaded skills can dispatch a built-in sub-agent (#1040) | docs (SETUP / CONTROL_AVAILABILITY) |
| `74c1250` | fix(passport): let an experiment with no honest lock values say so (#1049) | substantive: passport schema, integrity agent, orchestrator, scripts, tests |

The tag excludes the two substantive post-tag fixes. Pinning `main@74c1250` would
ship them under a `plugin.json` that still says `3.24.1`.

## 3. Port impact

### 3.1 Contract and gates (must change)

- `lib/payload-contract.js`:
  - `UPSTREAM`: commit, commitDate, pluginVersion.
  - `PAYLOAD_SNAPSHOT`, `BY_TOP_LEVEL`, and (after rebuild) `REFERENCE_INDEX`.
  - `REFUSED_SKILL_SYMLINKS` — the five `skills/<name>` paths no longer exist.
  - `REQUIRED_EXCLUSIONS` includes `skills`, which `describeExclusions` can no
    longer record; `EXCLUDED_ENTRIES` carries the stale reason.
- `tools/check-payload.mjs:364` compares `PROVENANCE.payload.symlinksRefused` to
  `REFUSED_SKILL_SYMLINKS`; `:366` requires the `skills` exclusion. Both fail after
  a rebuild against 3.24.1.
- `test/payload.test.mjs:326-329` asserts the same five refused symlinks.
- `test/e2e.test.mjs`: `scripts: 642` becomes 644; `pluginVersion: '3.24.0'`
  becomes `'3.24.1'`; the provenance commit assertion changes.
- `test/frontmatter.test.mjs:311-317` expects the four agent names in underscore
  form.
- `test/register.test.mjs:214-218` expects `arsAgentType` values in underscore
  form.
- `test/adapt.test.mjs:376` gates the namespace-mapping assertion on the old
  `academic-research-skills:screening_reviewer_agent` string; after the bump the
  branch goes dead unless updated.
- `test/guard.test.mjs` fixtures and `manifestKey` expectations use underscore
  keys; the guard code needs the legacy mapping (below) and the tests need the
  hyphenated cases.
- `test/inventory.test.mjs:47` asserts `role.file.endsWith('/' + role.agentType +
  '.md')`; with a hyphenated frontmatter name and an underscored file name, that
  invariant breaks. The internal `agentType` shape is a G2 decision.
- `test/e2e.test.mjs:462` asserts `status.lint.warnings` is empty; an unmapped
  hyphenated namespace produces residual-token warnings.
- `tools/verify-install.mjs:599` hardcodes `scripts: 642` (→ 644), and
  `tools/verify-install.mjs:886-960` runs the JS-vs-Python guard parity with
  `agent_type: 'synthesis_agent'`, so the JS legacy mapping must match upstream's.

### 3.2 Adapter (must change)

- `lib/adapt.js` / `lib/inventory.js`: `AGENT_NAME_TO_SKILL` is keyed by file
  stem (`synthesis_agent`), while the upstream prose and frontmatter now use
  `synthesis-agent`. `replaceNamespace` will leave
  `academic-research-skills:screening-reviewer-agent` unmapped instead of
  producing `ars-agent-screening-reviewer`. Add hyphenated aliases (and keep the
  underscore form for old payloads).
- The four top-level agents' `agentType` (read from frontmatter) becomes
  hyphenated; `intake.agentRole` description/metadata change accordingly.
- The reviewer SKILL change is prompt-level; the new rule text contains no
  Claude-only tokens. The two new scripts are referenced only by upstream
  `.github/workflows/spec-consistency.yml` and `scripts/_ci_pytest_manifest.toml`;
  no SKILL, command, agent, or hook references them. The card-confirmation lint
  passes at the tag under the managed venv (it imports `yaml`); the port does not
  run upstream lints.

### 3.3 Guard parity (must change for parity)

- Upstream `scripts/ars_write_scope_guard.py` now maps `synthesis_agent` →
  `synthesis-agent` in `_manifest_key`; the manifest itself keys the hyphenated
  names.
- The port's `lib/guard.js::manifestKey` only strips the plugin namespace. A caller
  that supplies an old underscore `agentType` would miss the manifest entry and
  fall through to `allowUnconstrained`. Production never supplies `agentType`
  today, but the pure decision function is documented as upstream parity and is
  covered by tests; mirror the legacy map and update the comment (`ARS 3.24.0`).
- `sr-screener/scripts/srlib.py` adds the same compatibility layer for saved
  screening configs; the port's Python tests should be re-run after the rebuild.

### 3.4 Release surface (must change)

- `README.md` (four count/version references: 1,199 files, byte count, commit,
  upstream version), `NOTICE.md` (1,199), `UPGRADING.md` (current pin),
  `CHANGELOG.md` (new entry), `CITATION.cff` (adapter version and upstream
  version), `package.json` (adapter version), `docs/verification.md` (new section
  plus header), `docs/INTERFACES.md` (upstream clone line),
  `docs/compat-report.md` (token counts and the agent-namespace example),
  `docs/license-assessment.md` and `docs/third-party-audit.md` (3.24.1 update
  line; no new third-party assets), and the `lib/guard.js` header comment.

### 3.5 Distribution exclusions

Unchanged: the same four `docs/design/snapshots/2026-05-13-ai-disclosure-discovery`
mirrors are still the only `DISTRIBUTION_EXCLUDED_FILES`. No new fonts, PDFs, or
third-party page bodies in this release. The new `README.pt-BR.md` is a localized
README and is excluded by the existing regex.

### 3.6 Ordered work list (for the execution ticket)

1. Contract: `UPSTREAM`, `PAYLOAD_SNAPSHOT`, `BY_TOP_LEVEL`; drop or condition
   the `skills` symlink expectations (`REFUSED_SKILL_SYMLINKS`,
   `REQUIRED_EXCLUSIONS`, `EXCLUDED_ENTRIES`).
2. Gate code/tests: `tools/check-payload.mjs:364-368`,
   `test/payload.test.mjs:326-329`, the counts/version assertions in
   `test/e2e.test.mjs`, `test/frontmatter.test.mjs`, `test/register.test.mjs`,
   `test/inventory.test.mjs`.
3. Adapter: hyphenated aliases in `AGENT_NAME_TO_SKILL`; rekey
   `test/adapt.test.mjs` (including the `:376` conditional); confirm `ars_status`
   reports no lint warnings.
4. Guard: add `LEGACY_AGENT_NAMES` to `lib/guard.js::manifestKey`; update
   `test/guard.test.mjs`; re-run the JS/Python parity in `verify-install`.
5. Rebuild the payload; take `REFERENCE_INDEX.summary`.
6. Release surface: README, NOTICE, UPGRADING, CHANGELOG, CITATION, package.json,
   docs/verification, docs/INTERFACES, docs/compat-report, license/third-party
   update lines.
7. Gates: `check-payload`, `npm test`, `verify-install` against the tag checkout,
   `build-python-wrapper --check`; then `check-upstream` at the tag must be clean.
8. Resolve the drift issue under the G1 policy.

## 4. Pins for the bump (recomputed at the tag)

```json
{
  "UPSTREAM": {
    "commit": "bcbcac39e874744cda98d6ddaaf765cfd00b0e40",
    "commitDate": "2026-11-02T10:34:13+08:00",
    "pluginVersion": "3.24.1",
    "license": "CC-BY-NC-4.0"
  },
  "PAYLOAD_SNAPSHOT": {
    "files": 1201,
    "bytes": 24159244,
    "directories": 151,
    "modes": { "644": 1173, "755": 28 },
    "generatedAt": "2026-11-02T02:34:13.000Z",
    "generatedAtSource": "git-commit-date",
    "contentSha256": "78a5900e677f2a273ec4d50f86d14fa2fee0dda205373bcf29399944d5ce0a4b",
    "pathListSha256": "982b05aa1fb14bb51f280cccd08d68c9ecfafb4050e04cdc9bb4681d661ef8e1"
  },
  "BY_TOP_LEVEL": {
    "deep-research": { "files": 53, "bytes": 786607 },
    "academic-paper": { "files": 63, "bytes": 1058429 },
    "academic-paper-reviewer": { "files": 28, "bytes": 633085 },
    "academic-pipeline": { "files": 30, "bytes": 672071 },
    "sr-screener": { "files": 25, "bytes": 264506 },
    "commands": { "files": 16, "bytes": 20904 },
    "agents": { "files": 4, "bytes": 86358 },
    "shared": { "files": 155, "bytes": 1722614 },
    "scripts": { "files": 644, "bytes": 11902139 },
    "hooks": { "files": 2, "bytes": 17708 },
    "docs": { "files": 121, "bytes": 4082760 },
    "examples": { "files": 45, "bytes": 2741686 },
    "tools": { "files": 6, "bytes": 68792 },
    ".": { "files": 9, "bytes": 101585 }
  }
}
```

`REFERENCE_INDEX` is not derivable from the upstream tree; take the new
`summary` from `payload/REFERENCE-INDEX.json` after the rebuild.

## 5. Tag versus main

- **Tag `v3.24.1`** is the release boundary and matches the prior bump
  (`CHANGELOG.md` 2.1.0 pinned `v3.24.0` @ `b34c63f8`). It excludes the two
  substantive post-tag fixes.
- **`main@74c1250`** carries those fixes but is unreleased and still advertises
  `3.24.1`; pinning it would make the payload a moving-branch snapshot.
- **Operational conflict:** the weekly `check-upstream` workflow compares upstream
  `main` (`.github/workflows/upstream-check.yml`, `REF="${INPUT_REF:-main}"`),
  while the bump precedent pins tags. A tag bump leaves `main` ahead, so
  the drift issue will not be auto-closed. That is a policy decision for G1, not
  a reason to pin `main`.

**Recommendation:** pin the tag; decide the weekly-check ref policy explicitly
(tag / latest release / manual close); track the post-tag commits as the next
drift item or a future `3.24.2` bump.

## 6. Open questions

1. G1: tag vs main, the weekly-check policy, and whether the adapter release
   surface (2.1.2, CHANGELOG, README counts) ships in this effort.
2. G2: remove the `skills` symlink expectations outright or keep a conditional
   compatibility path; accept both agent-name forms or adopt only the hyphenated
   one; mirror `LEGACY_AGENT_NAMES` in the guard.
3. Whether the port should run the two new upstream lint scripts as part of its
   gates. They pin the reviewer SKILL and the plugin inventory; the port's gates
   do not currently invoke upstream lints.
4. `docs/compat-report.md` is a measured report of the 25-document corpus; its
   counts and the agent-namespace example must be regenerated or updated with
   evidence, not hand-waved.

## 7. Limitations

- Static review only. No payload rebuild and no `verify-install`.
  The pre-bump baseline gates were run after the review: `npm test` 235/235 pass,
  `check-payload` 0 errors / 4 warnings, `build-python-wrapper --check` up to date,
  `git diff --check` clean. Additional assertions may surface when the full suite
  runs against the rebuilt payload.
- `REFERENCE_INDEX` and the final release-surface numbers are unknown until the
  rebuild.
- `docs/SETUP*` and `docs/CONTROL_AVAILABILITY.md` were read only at diff level;
  they are documentation, not runtime contract.
- The upstream tag object is annotated; tooling that expects a commit SHA must peel
  it first (`git rev-parse v3.24.1^{commit}`).
- Tag spot-check: `scripts/check_reviewer_card_confirmation.py` passes at the tag
  under the managed venv; system `python3` lacks `yaml`. This is an upstream CI
  lint, not a port gate.
- `REFERENCE_INDEX.filesScanned` is expected to stay 412 (the file inventory is
  the same set of documents plus the two scripts), but the exact counts must come
  from the rebuilt index.

## 8. Sources

- Upstream: tag `v3.24.1` / commit `bcbcac39`; `CHANGELOG.md` at the tag;
  `git diff b34c63f..bcbcac39`; `git log --reverse b34c63f..bcbcac39`.
- Port: `lib/payload-contract.js`, `lib/adapt.js`, `lib/inventory.js`,
  `lib/guard.js`, `lib/intake.js`, `tools/build-payload.mjs`,
  `tools/check-payload.mjs`, `test/*.test.mjs`, `README.md`, `NOTICE.md`,
  `UPGRADING.md`, `docs/verification.md`, `docs/compat-report.md`.
- Pins: `node tools/check-upstream.mjs --ref bcbcac39… --print-snapshot --json`
  (2026-11-04).

