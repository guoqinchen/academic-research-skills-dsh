# Verification record — Academic Research Skills for DeepSeek Harness

Independent verifier record for the DSH port of
[`academic-research-skills`](https://github.com/Imbad0202/academic-research-skills)
(upstream commit `1ec249df98728682dfbbdfb940a658338bfd6f80`, plugin version `3.23.2`).

> **Status: historical record (2026-10-26).** The output below is the
> pre-P0-fix verification snapshot. Current gates after the fixes:
> `node --test test/*.test.mjs` → **207/207**; `node tools/verify-install.mjs` →
> **46 PASS / 0 FAIL / 3 WARN / 1 SKIP** (the SKIP is upstream-clone parity;
> set `ARS_UPSTREAM_ROOT` to a pinned checkout for **51 PASS / 0 SKIP**);
> `node tools/check-payload.mjs` → **0 errors / 4 warnings**; payload
> **1,199 files / 24,118,122 bytes** after four third-party page mirrors were
> withheld (see `NOTICE.md`).

- Date: 2026-10-26
- DSH profile: `desktop`; `dsh` CLI `0.2.1-rc.3`
- Node.js: `v24.22.1` (no npm dependencies in the plugin)
- Host: macOS (`darwin arm64`), `python3` 3.15.1 for tooling
- Managed ARS venv: `<managed-venv>` (CPython 3.12.13, `uv` available)
- Plugin root: `<plugin-root>`
- Upstream clone: `<upstream-checkout>`

The verification is read-only with respect to the plugin: it writes only to fresh
OS temp directories (removed before exit), never mutates the payload, installs
nothing, and performs no network access. Python is always invoked with `-B` and
`PYTHONDONTWRITEBYTECODE=1`.

## 1. Verdict

**PASS.** All ten verification suites pass (`196/196` tests across the whole
repository), `tools/verify-install.mjs` reports
`51 PASS / 0 FAIL / 3 WARN / 0 SKIP`, and `tools/check-payload.mjs` exits `0`
with `0 errors, 4 warning(s)`.

The declared port surface is present and behaves as documented:

| Surface | Claim | Verified |
|---|---|---|
| Research skills | 5 | 5 registered from the real payload |
| Agent-role skills | 4 | 4 registered, bound to their mirror skill directories |
| Slash commands | 16 | 16 registered; every handler dispatches one raw-input user message |
| Tools | 3 | 3 schemas accepted by the real `@deepseek-ai/dsh-tools` validator |
| Announce section | 1 | one static order-40 section; suppressed by `announce:false` |
| Write-scope guard | 1 synchronous guard | infra protection + schema-drift deny active; phase fence reported `unavailable` (no DSH agent type) |
| Payload | 1,203 upstream files, 24,815,025 bytes | recomputed and byte-identical to the clone |
| Guard parity | upstream Python reference | 29/29 decisions and advisory flags match |

The three WARN rows are honest, non-blocking limitations documented in §7.
Live evidence additionally confirms the installed plugin registers the five
research skills, four agent-role skills, sixteen commands, and the announce
section in the running DSH session (see §4.8).

## 2. Artifacts delivered by the verifier

Only these files were written (per shared task `task-5`; no `lib/*`, `index.js`,
`package.json`, `payload/*`, `bin/*`, or other owners' tests were touched):

| File | Purpose |
|---|---|
| `test/register.test.mjs` | registration counts/names/content, payload roots, mirror-skill agent roles, all 16 command handler dispatches, message shape, literal `$ARGUMENTS` handling, error path, effect ownership |
| `test/payload.test.mjs` | independent inventory/digest recomputation, PROVENANCE/REFERENCE-INDEX consistency, 1,203-file byte/mode pins, symlink/bytecode/absolute-path audits, mirror identity, guard fixtures |
| `test/e2e.test.mjs` | real `apply()` wiring with a fake DSH host, schema validity (local mirror + real DSH validator), announce, guard, flag matrix, live `ars_status`, `ars_script` guard rails, import hygiene, teardown |
| `tools/verify-install.mjs` | runnable read-only PASS/FAIL report: environment, package, registration, guard parity vs the Python reference, payload provenance, upstream clone parity, limitations |
| `docs/verification.md` | this record |

## 3. Commands and exact results

### 3.1 Full test suite

```sh
cd "academic-research-skills-dsh"
node --test test/*.test.mjs
# exit code 0
```

Output (durations vary; every other line is stable):

```
ℹ tests 196
ℹ suites 0
ℹ pass 196
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 362.1535
```

Per-suite breakdown (each run individually, exit 0):

| Suite | Tests | Pass | Fail |
|---|---:|---:|---:|
| `test/frontmatter.test.mjs` | 44 | 44 | 0 |
| `test/adapt.test.mjs` | 52 | 52 | 0 |
| `test/env.test.mjs` | 19 | 19 | 0 |
| `test/guard.test.mjs` | 21 | 21 | 0 |
| `test/tools.test.mjs` | 12 | 12 | 0 |
| `test/register.test.mjs` (new) | 10 | 10 | 0 |
| `test/payload.test.mjs` (new) | 11 | 11 | 0 |
| `test/e2e.test.mjs` (new) | 17 | 17 | 0 |
| `test/inventory.test.mjs` (new) | 6 | 6 | 0 |
| `test/model-profile.test.mjs` (new) | 4 | 4 | 0 |
| **Total** | **196** | **196** | **0** |

Note: `node --test test/` is not used. On this Node version it fails with
`MODULE_NOT_FOUND`; the repository scripts and this record use the glob
`node --test test/*.test.mjs`.

### 3.2 Install verification

```sh
node tools/verify-install.mjs
# exit code 0
```

Output:

```
ARS DSH install verification (read-only)
  plugin     : <plugin-root>
  payload    : <plugin-root>/payload
  upstream   : <upstream-checkout>

[environment]
  PASS node runtime — v24.22.1
  PASS platform — darwin arm64
  PASS dsh CLI — 0.2.1-rc.3
  PASS python3 — Python 3.15.1
  PASS managed Python environment — venv 3.12.13 (<managed-venv>); 8/8 runtime deps present
  PASS installed in desktop profile — linked to this checkout (<plugin-root>)
  PASS real DSH schema validator — @deepseek-ai/dsh-tools 0.2.0-rc.2

[package]
  PASS manifest identity — academic-research-skills-dsh@1.0.0, engines.dsh >=0.2.1-rc.3
  PASS bundle entry points — exports["."]=./index.js, dsh.bundle.patch=./cordis.patch.yml
  PASS no npm dependencies — no dependency fields, no node_modules
  PASS shipped files — 15 required files present, lib/*.js=20
  PASS interpreter wrapper — bin/ars-python mode 755 (generated from lib/python-contract.js)
  PASS locales — en.json + zh.json carry meta.title/description
  PASS icon — 512 byte SVG
  PASS runtime requirements — 8 entries, no test-only packages
  PASS cordis.patch.yml — one enabled academic-research-skills row, all five flags true

[registration]
  PASS surface counts — skills=9 (5 research + 4 agent roles), commands=16, tools=3, guards=1, announce=1, effects=28
  PASS registered names — 5 research skills, 4 agent-role skills, 16 /ars-* commands
  PASS adaptation lint — 9/9 registered skill bodies are lint-clean
  PASS command dispatch — 16/16 handlers returned success and one {id,role:'user',content:[text],source:{kind:'user'}} followup
  PASS announce section — one order-40 static section names 5+4 skills, 16 commands, payload root, routing rule
  PASS tool schemas — 3 object-rooted raw JSON Schemas, top-level required arrays, no per-property required
  PASS real DSH schema validation — 6/6 schemas accepted by @deepseek-ai/dsh-tools
  PASS ars_status live check — 9 skills + 16 commands registered, payload complete, commit 1ec249df, lint clean, Python ready
  PASS write-scope guard — infra deny for index.js/lib/guard.js/payload guard script; schema-drift deny; workspace write and Bash pass
  PASS config flags — announce/commands/tools/guard each suppress only their own surface
  PASS import hygiene — 20 runtime modules import only node: built-ins and local files
  PASS payload bytecode safety — ars_script env and bin/ars-python export PYTHONDONTWRITEBYTECODE=1 (no __pycache__ in the payload)
  PASS shipped Python gates execute — check_skill_description_length.py exit 0 (5 descriptions <=1024); check_command_frontmatter_name.py exit 0 (16 command files); via <managed-venv>/bin/python
  PASS bin/ars-python behavior — exports ARS_PAYLOAD_ROOT + PYTHONDONTWRITEBYTECODE=1; fresh-HOME probe resolves the documented fallback interpreter
  PASS effect teardown — 28 disposers remove every registered surface

[guard-parity]
  PASS reference assets — payload guard script + manifest (23 agents) + captured fixtures present
  PASS captured fixtures — 3/3 captured Claude Code payloads produce the recorded decisions
  PASS upstream decision parity — 29/29 decisions + advisory flags match payload/scripts/ars_write_scope_guard.py (captured fixtures 3, generated 26)
  PASS DSH tool-name mapping — write→Write, edit→Edit, bash→Bash preserve the canonical decision and flags
  PASS plugin infrastructure extension — index.js/lib/**.js/bin/**/cordis.patch.yml/package.json denied (intentional superset of upstream enforcement globs)

[payload]
  PASS provenance identity — 1ec249df9872 (3.23.2), generated 2026-10-26T01:10:36.000Z
  PASS upstream inventory totals — 1203 files, 23.7 MB, 151 dirs, modes {"644":1175,"755":28}
  PASS content and path-list digests — content a39f49a22894ab6d…, paths b35fc5dc50208e61…
  PASS per-top-level inventory — 14 groups match (deep-research 53, academic-paper 63, academic-paper-reviewer 28, academic-pipeline 30, sr-screener 25, commands 16, agents 4, shared 155, scripts 642, hooks 2, docs 125, examples 45, tools 6)
  PASS critical registration corpus — 5 SKILL.md + 16 commands + 4 agent roles, no extras
  PASS no symlinks or special entries — 0 symlinks, 0 special entries
  PASS no generated bytecode — 0 __pycache__/.pyc files
  PASS no build-machine absolute paths — payload content is free of this checkout, the upstream clone, and <home> paths
  PASS REFERENCE-INDEX consistency — 2686 refs, 2556 resolved (2543 files + 13 dirs verified on disk), 80 unresolved
  PASS guard fixtures and phase manifest — 23 bucket-A scopes; 3 captured payload fixtures

[upstream]
  PASS pinned commit — git HEAD = 1ec249df9872
  PASS upstream plugin manifest — academic-research-skills@3.23.2 (CC-BY-NC-4.0)
  PASS registered documents are byte-identical — 25/25 registered documents byte-identical to the clone
  PASS entire payload is byte-identical to the clone — 1203/1203 payload files byte- and mode-identical to the clone
  PASS guard and fixtures are byte-identical — guard script, manifest, and captured fixtures match upstream

[limitations]
  WARN guard phase fence unavailable by design — DSH tool executions expose no agent_type and the plugin keeps no role registry; phase fencing is reported as unavailable (infra protection still applies)
  WARN upstream repo-only maintenance gates — check_version_consistency.py exits 1 from the payload because it expects .claude/CLAUDE.md, which the payload intentionally excludes (Version consistency check failed:)
  WARN sr-screener generated workflow script format — build_workflow.py emits Claude-Code-oriented scripts; the registration note routes DSH runs to --emit-prompts + one subagent call per prompt until the generator is validated on DSH

payload statistics: 1203 files, 23.7 MB, 151 dirs; commit 1ec249df9872 (3.23.2); generated 2026-10-26T01:10:36.000Z
reference index   : 2686 references, 2556 resolved, 80 unresolved
guard parity      : 29/29 decisions + advisory flags match the Python reference

summary: 51 PASS, 0 FAIL, 3 WARN, 0 SKIP
RESULT: PASS
```

`node tools/verify-install.mjs --json` returns the same result (`ok: true`,
`counts: {"PASS":51,"FAIL":0,"WARN":3,"SKIP":0}`) with every row, and exits 0.

### 3.3 Payload checker

```sh
node tools/check-payload.mjs
# exit code 0
```

Output:

```
ARS payload check
  payload    : <plugin-root>/payload
               1203 files, 23.7 MB, 151 dirs, 0 symlinks
  critical   : skills 5/5, commands 16/16, agents 4/4
  provenance : 1ec249df9872 (3.23.2), 2026-10-26T01:10:36.000Z (git-commit-date)
  references : 412 Markdown files, 2686 refs, 2556 resolved, 80 missing (72 targets / 134 occurrences), 37 identifiers, 13 placeholders
               file-relative-link         2 refs,     2 resolved,   0 missing
               own-skill-relative       245 refs,   243 resolved,   0 missing
               payload-root-relative   2434 refs,  2306 resolved,  80 missing
               skill-mirror               5 refs,     5 resolved,   0 missing
  per top level:
    deep-research                   53 files   768.2 KB
    academic-paper                  63 files     1.0 MB
    academic-paper-reviewer         28 files   616.8 KB
    academic-pipeline               30 files   656.1 KB
    sr-screener                     25 files   256.1 KB
    commands                        16 files    20.4 KB
    agents                           4 files    84.3 KB
    shared                         155 files     1.6 MB
    scripts                        642 files    11.3 MB
    hooks                            2 files    17.3 KB
    docs                           125 files     4.5 MB
    examples                        45 files     2.6 MB
    tools                            6 files    67.2 KB
    (root)                           9 files    98.7 KB
  top missing references:
      11x  shared/references/epistemic_status_vocabulary.md  [docs]
       6x  scripts/epistemic_status_extractor.py  [docs]
       5x  deep-research/agents/cite_provenance_finalizer_agent.md  [docs]
       5x  scripts/check_silent_upgrade.py  [docs]
       5x  scripts/migrate_passport_to_v3_10_epistemic_status.py  [docs]
       4x  scripts/codex-audit-on-phase-complete.sh  [docs]
       3x  deep-research/agents/cite_provenance_terminal_gate_agent.md  [docs]
       3x  examples/ab_evidence/v3.6.6/agreement_audit_results.md  [docs]
       3x  references/semantic_scholar_api_protocol.md  [docs]
       3x  scripts/adapters/__init__.py  [docs]
  warnings:
    - missing references in docs: 68 targets / 129 occurrences
    - missing references in examples: 2 targets / 3 occurrences (all inside code examples)
    - missing references in shared: 1 targets / 1 occurrences
    - missing references in academic-paper: 1 targets / 1 occurrences (all inside code examples)
OK: 0 errors, 4 warning(s)
```

The 4 warnings are upstream documentation/example references that never shipped
in the pinned commit (the checker reports them by area); they are not runtime
references required by a skill. All five skill directories, all 16 commands, and
all 4 root agent files are present and non-empty.

## 4. Independent challenge results

Every claim below was checked from the filesystem / real modules, not taken from
the implementation's own reports.

### 4.1 Registration counts and names

- 5 research skills (`deep-research`, `academic-paper`, `academic-paper-reviewer`,
  `academic-pipeline`, `sr-screener`) with non-empty descriptions, valid kebab
  names, `source: 'bundled'`, existing `SKILL.md` paths, directory `resourceBase`,
  `metadata.version`, and `modelInvocable/userInvocable: true`.
- 4 agent-role skills (`ars-agent-synthesis`, `ars-agent-research-architect`,
  `ars-agent-report-compiler`, `ars-agent-screening-reviewer`) with
  `userInvocable: false`, `modelInvocable: true`, upstream agent type and tool
  allowlist in metadata, and `resourceBase` = the **mirror** skill directory
  (`deep-research` for three, `sr-screener` for the screening reviewer). The four
  root `payload/agents/*.md` files are byte-identical mirrors of their skill-local
  copy (tested for all four).
- 16 commands, matching the upstream file set exactly; 13 with upstream
  `disable-model-invocation: true`, 3 CLI commands with `$ARGUMENTS`.
- `apply()` produces 28 effect-scoped registrations (5 + 4 + 16 + tools 1 + guard
  1 + announce 1); all 28 disposers unregister their surface.
- `ars_status` (executed against the live registries) reports every skill,
  agent-role skill, and command as `registered: true` and `payload.missing: []`.

### 4.2 Command handler follow-up message shape

For all 16 commands, a fake `CommandInvocation` (`commandId`, `rawInput:
'probe input'`, `attachments: []`, `signal`, `agent.followup`) produced:

- `result.kind === 'success'` with text naming the command;
- exactly one `followup(message)` call;
- `message = { id: <fresh UUID v4>, role: 'user', content: [{ type: 'text', text }],
  source: { kind: 'user' } }`;
- the adapted prompt contains the absolute payload root and the raw input;
- the 3 placeholder commands substitute `$ARGUMENTS` literally (no `$&`/`$1`
  expansion; verified with `a$&b $1 ${ARGUMENTS} c\d`); the 13 others append
  `## User request (raw input)` and use `_No additional input was provided._` for
  empty input;
- no adapted dispatch text fails the residual-token lint.

The fake invocation/message contract was cross-checked against the installed DSH
packages (`@deepseek-ai/dsh-commands` `CommandInvocation`/`CommandResult` and
`@deepseek-ai/dsh-llm` `createMessage`/`createUserMessage`), so the fake is not
inventing a private shape.

### 4.3 Payload provenance, digests, and hygiene

- Independently recomputed (from bytes on disk, not from `PROVENANCE.json`):
  - 1,203 files, 24,815,025 bytes, 151 directories, modes `{"644":1175,"755":28}`;
  - `contentSha256 = a39f49a22894ab6dd00942d85ba7fce41e0e2b9362ae07bcaf53e07c6854b41f`;
  - `pathListSha256 = b35fc5dc50208e61c9ada1b612569b11263c4f9e9c430d7636e8daf8df307f68`;
  - all per-top-level counts/bytes/digests/modes match `PROVENANCE.byTopLevel`.
- `PROVENANCE.upstream`: commit `1ec249df…`, plugin version `3.23.2`, license
  `CC-BY-NC-4.0`; `generatedAt` equals the commit date (`git-commit-date`
  derivation) and `checkout` is relative (`../repo`).
- Every one of the 1,203 payload files is **byte- and mode-identical** to the
  upstream clone (not only the 25 registered documents).
- No symlinks, no special files, no `__pycache__`/`.pyc`, no `.DS_Store`.
- No build-machine absolute paths inside payload content (this checkout, the
  upstream clone, or `<home>`). The two upstream test fixtures that mention
  `/Users/private/...` and `/Users/x` are upstream content, not build leakage.
- `REFERENCE-INDEX.json`: 2,686 references; 2,556 resolved (2,543 files + 13
  directories, each verified to exist on disk as the recorded kind); 80
  unresolved file references, with 37 identifiers + 13 placeholders classified
  separately (130 unresolved entries in total); the 72 `missing[]` targets are backed by the unresolved entries
  with matching counts/areas/files and do not exist on disk.
- Shipped guard fixtures: 3 captured Claude Code payloads with recorded decisions
  `allow/allow/deny`; phase-scope manifest with 23 bucket-A scopes.
- Registration corpus: exactly 5 `SKILL.md`, 16 `commands/*.md`, 4 `agents/*.md`.
- `MODE_REGISTRY.md` independently totals 35 modes (8 + 11 + 6 + 2 + 8), matching
  the README/`plugin.json` claim; 47 role Markdown files exist
  (4 top-level + 43 unique skill/shared roles) matching `ars_status.agentFiles`.
- Upstream token inventory independently recounted across the 25 documents and
  matches `docs/compat-report.md`: `${CLAUDE_PLUGIN_ROOT}` 41 occurrences/13
  files, `academic-research-skills:` 15/15, `Skill tool` 13/13, `$ARGUMENTS` 3/3,
  `python3 scripts/` 9/6, `AskUserQuestion` 5/5, `WebSearch` 2/1, 0 residual
  after adaptation; corpus 25 documents / 4,599 lines / 367,109 bytes.

### 4.4 DSH compatibility of the declared interfaces

The fake host mirrors contracts read directly from the installed packages, not
assumed ones:

- `skills.register(definition)`: kebab-case name, non-empty description,
  boolean `invocation` policy, optional `resourceBase`, string `content`/`source`;
  no description-length cap (the five skill descriptions are 783–1,021 code
  points).
- `commands.register({name, description, input:{hint}, handler})`: name grammar
  `/^[a-z][a-z0-9_-]*$/`, non-empty hint, handler returns
  `{kind:'success'|'error', text}`; `CommandInvocation` carries `rawInput` and
  `agent.followup`.
- `tools.register(tool)`: `output.render` required, `output.schema` checked by
  `assertSupportedJsonSchema`; `parameters` checked with the same enforced raw
  subset. The verifier runs the **real** `assertSupportedJsonSchema` and
  `validateJsonSchemaValue` from `@deepseek-ai/dsh-tools 0.2.0-rc.2` on all three
  tools and on the live `ars_status` value: 6/6 schemas and the status value are
  accepted.
- `ctx.tools.guard(fn)`: synchronous; a returned string denies. The registered
  guard denies plugin infra writes, denies schema-drift write payloads, and
  passes workspace writes and main-session Bash.
- `systemPrompt.section({name, order, text, interpolate})`: finite order,
  duplicate names throw; the plugin registers one static order-40 section.
- No runtime module imports `@deepseek-ai/*` or any bare npm specifier: `index.js`
  plus the 20 `lib/*.js` modules import only `node:` built-ins and local files.
  (A JSDoc type comment mentions `@deepseek-ai/cordis`; it is documentation, not
  an import.) `package.json` has no dependency fields and the package carries no
  `node_modules`.

### 4.5 Write-scope guard parity vs the upstream Python reference

The payload ships the upstream guard, manifest, and captured fixtures. The
verifier executes the **shipped payload** `scripts/ars_write_scope_guard.py`
(with `python3 -B`) via `importlib` and compares its
`evaluate_decision(payload, manifest, workspace_root, plugin_root)` result to the
JS `evaluateDecision`:

- **3/3** captured Claude Code payloads reproduce the recorded decisions;
- **26/26** generated decisions across the upstream decision space (untracked
  session, Bucket-A in/out of phase, wholesale Bash deny, path traversal, symlink
  escape, escape allow for the main session, schema drift, phase-lookalike files,
  phase unions, scoped agent namespace, case-sensitive agent names, infra writes)
  match on **decision and advisory flags**;
- **29/29 total**.

Additional checks: DSH `write`/`edit`/`bash` names map to the canonical
`Write`/`Edit`/`Bash` decisions; the plugin adds infra protection for its own
wiring files (`index.js`, `lib/**`, `bin/**`, `cordis.patch.yml`, `package.json`)
as a deliberate **superset** of the upstream enforcement globs (widening a deny
list is upstream's stated safe direction; this is documented, not a parity
failure).

### 4.6 Flag and announce behavior

- `announce:false` → 0 prompt sections; `commands:false` → 0 commands;
  `tools:false` → 0 tools; `guard:false` → 0 guards; each leaves the other
  surfaces and the 9 skills registered. Effects drop exactly as expected
  (28 → 27 / 12 / 27 / 27; all four off → 9).
- The announce text names all 5 research skills, all 4 agent-role skills, all 16
  commands (`Commands (16): …`), the payload root, and the
  "academic research requests only / route unrelated requests outside ARS"
  sentence; it is static (`interpolate:false`, no `{{…}}`) and lint-clean.

### 4.7 Real deterministic-gate execution

Through the real `ars_script` tool and the managed venv interpreter:

- `scripts/check_skill_description_length.py` → exit `0`, reports all five
  descriptions within the upstream 1,024-code-point limit;
- `scripts/check_command_frontmatter_name.py` → exit `0`, reports
  `OK (16 command files, all name: == filename stem)`.

After these runs the payload still contains **0** `__pycache__`/`.pyc` files,
proving the `PYTHONDONTWRITEBYTECODE=1` fix in `lib/env.js` and `bin/ars-python`
works end to end. `bin/ars-python` itself was probed and exports
`ARS_PAYLOAD_ROOT`, `PYTHONDONTWRITEBYTECODE=1`, and a payload-root-first
`PYTHONPATH`, executing the managed venv interpreter.

### 4.8 Live installed-plugin registration (read-only)

The plugin is installed in the `desktop` profile as a link to this checkout, and
its own `ars_status` tool was invoked in the live session. Observed result:

- `plugin`: `academic-research-skills-dsh@1.0.0`, plugin/payload roots as above;
- `model`: `deepseek-flash`, 1,048,576-token context, text+image, noClaudeDependency true;
- `webSearch`: enabled, `web_search` / `deepseek-official`, 4 queries per call;
- `payload`: present, counts `{skills: 5, commands: 16, agentDefinitions: 4,
  agentFiles: 47, scripts: 455, hooks: 2}`, `missing: []`, commit
  `1ec249df98728682dfbbdfb940a658338bfd6f80`, plugin version `3.23.2`,
  digests `a39f49a2…` / `b35fc5dc…` (the pinned values);
- `python`: `mode: venv`, `executable:
  <managed-venv>/bin/python`, `ready: true`, `missing: []`,
  version `3.12.13`, `uv: true`;
- `guard`: enabled, infra-protected, manifest loaded with 23 agents,
  `phaseFence: "unavailable"` with a reason, workspace root `<home>/Projects/Academic Research`;
- `registrations`: all 5 research skills, all 4 agent-role skills, and all 16
  `/ars-*` commands report `registered: true`;
- `lint.warnings: []`.

The live session's system prompt also carries the plugin's announce block (the
payload root, the 5 + 4 skill names, the 16 commands, and the ARS-only routing
sentence), and the live tool catalog exposes `ars_status`, `ars_script`, and
`ars_env_setup`, matching the source registration. This is live registration
evidence, not a Web-composer dispatch test (see §7).

## 5. Incident fixed during verification (F1)

Initial verification found the payload dirty:

```
payload/scripts/__pycache__/file_lock.cpython-312.pyc
payload/scripts/__pycache__/human_read_attestation_resolver.cpython-312.pyc
payload/sr-screener/scripts/__pycache__/srlib.cpython-312.pyc
```

`node tools/check-payload.mjs` exited `1` with 25 errors (1,206 files vs the
pinned 1,203; content/path-list digests and the `sr-screener`/`scripts` group
counts no longer matched `PROVENANCE.json`). Root cause: payload Python runs
imported sibling modules with the managed CPython 3.12 venv and wrote bytecode
caches into the "read-only" payload.

The finding was reported to the Lead with the file list and reproduction. The
Lead's fix: `PYTHONDONTWRITEBYTECODE=1` added to `lib/env.js#scriptEnv()` and
`bin/ars-python`, the three `__pycache__` directories removed, and the payload
rebuilt/validated to the pinned digests. Regression coverage was added here:

- `test/payload.test.mjs` asserts no `__pycache__`/`.pyc`/`.DS_Store` and exact
  pinned counts/digests;
- `test/e2e.test.mjs` asserts the bytecode-suppression env and wrapper exports;
- `tools/verify-install.mjs` re-checks it after executing real payload gates.

Re-verification after the fix: `check-payload` exit `0` (0 errors), payload
digests pinned, 0 bytecode files, no payload mutation by this verification run.

## 6. Pass/fail counts

| Check | Result |
|---|---|
| `node --test test/*.test.mjs` | 196/196 pass, exit 0 |
| New verifier suites (`register`/`payload`/`e2e`) | 38/38 pass |
| `node tools/verify-install.mjs` | 51 PASS / 0 FAIL / 3 WARN / 0 SKIP, exit 0 |
| `node tools/check-payload.mjs` | 0 errors / 4 upstream-doc warnings, exit 0 |
| Guard parity (Python reference) | 29/29 decisions + advisory flags |
| Captured Claude Code fixtures | 3/3 |
| Byte-identical payload files vs clone | 1,203/1,203 (bytes + modes) |
| Registered surfaces | 5 skills + 4 agent roles + 16 commands + 3 tools + 1 guard + 1 announce |
| Adapted documents lint-clean | 25/25 (5 skills + 16 commands + 4 agent roles) |

## 7. What remains unverified / limitations

These are not covered by static or fake-context verification and must not be
claimed as verified here:

1. **Live Web composer execution of `/ars-*` commands.** The handlers are
   unit-tested with the documented `CommandInvocation` shape and the live
   registration is confirmed through the plugin's own `ars_status` tool (§4.8),
   but the verifier did not type `/ars-*` into the Web UI composer. Whether the
   submitted follow-up message starts the next model step is host/UI behavior;
   the Lead owns that live end-to-end check.
2. **Live UI rendering** of skills/commands in the DSH Web GUI, and the actual
   model-side quality of executing the 25 adapted prompts (tool usage, mode
   adherence, subagent dispatch, long-running workflows). Static content
   correctness is verified; model behavior is not.
3. **Guard phase fence.** DSH tool executions expose no `agent_type`, so the
   phase fence is `unavailable` by design (documented; `ars_status.guard.phaseFence`
   is `"unavailable"` plus a reason). The hypothetical role registry was removed;
   `evaluateDecision` retains the phase logic for upstream parity. Only
   infrastructure protection and schema-drift denial are active for ordinary
   sessions.
4. **sr-screener generated workflow script format.** `build_workflow.py` emits
   Claude-Code-oriented workflow scripts. The registration-time override note
   routes DSH runs to `--emit-prompts` + one `subagent` call per prompt; the
   generated script itself was not validated against DSH's `workflow` tool.
5. **Upstream repo-only maintenance gates.** e.g.
   `scripts/check_version_consistency.py` exits `1` from the payload because it
   expects `.claude/CLAUDE.md`, which the payload intentionally excludes
   (`PROVENANCE.payload.excluded`). This gate checks the upstream repository
   itself and is not referenced by the skill workflows.
6. **Host-dependent / external paths.** `scripts/run_codex_audit.sh` requires the
   external `codex` CLI and network-dependent verification scripts require
   network access at run time. Neither was exercised.
7. **Model aliases** (`sonnet`/`opus`/`haiku`) are rewritten to `deepseek-flash` at
   adaptation time; no adapted document selects a Claude model. Quality-tier prose
   remains, mapped to DeepSeek Flash/reasoning effort guidance.
8. **Legacy runtime prose**: `Claude Code` and `.claude/...` runtime references are
   rewritten, so adapted content does not require Claude filesystem or models.
9. **Upstream `PreToolUse` descriptions** remain as provenance; the DSH hook
   behavior is the registered tool guard. The `.claude/...` runtime paths have
   been adapted out of the registered documents.
9. **Environment note:** at verification time the live session also exposed a
   temporary probe tool (`ars_selftest_followup`, described as a temporary probe)
   used to exercise `agent.followup` end to end. It is not present in the
   workspace plugin source and is excluded from the 3-tool count above. The installed desktop profile links
   this checkout (`~/.dsh/profiles/desktop/node_modules/academic-research-skills-dsh`),
   and `dsh` CLI `0.2.1-rc.3` matches `engines.dsh >=0.2.1-rc.3`; the profile's
   `@deepseek-ai/dsh` package metadata reports `0.2.0-rc.2`, which is the
   environment's version mix, not a plugin requirement mismatch observed here.

## 8. Reproduction

```sh
cd "<plugin-root>"

# full suite (196 tests) — do not use `node --test test/` on this Node
node --test test/*.test.mjs

# read-only install verification (package, registration, schemas, guard parity,
# payload provenance, upstream clone parity, limitations)
node tools/verify-install.mjs
node tools/verify-install.mjs --json

# payload integrity (pinned commit, digests, reference index)
node tools/check-payload.mjs
```

The verifier suites read the real `payload/` and real `lib/` modules; only the
DSH context is faked. No test performs network I/O, installs anything, or writes
inside the plugin/payload tree.

## 9. Lead live-install checks (same machine, after the F1 fix)

These checks were run by the Lead against the actual installed profile, in
addition to the verifier's static/local suites. They are the live half of the
"host behavior" that §7 says the verifier does not own.

| Check | Evidence |
|---|---|
| Bundle installation | `plugin_manager install_bundle target=<plugin dir>` → `application: applied`, bundle `academic-research-skills-dsh 1.0.0`, no warnings. Reinstalled once more after the F1 fix and the final polish; still `applied`. |
| Skill catalog | The live session catalog lists all 9 ARS skills: `deep-research`, `academic-paper`, `academic-paper-reviewer`, `academic-pipeline`, `sr-screener`, `ars-agent-synthesis`, `ars-agent-research-architect`, `ars-agent-report-compiler`, `ars-agent-screening-reviewer`. |
| Announce section | The live system prompt contains the ARS availability block with 5 research skills, 4 agent-role skills, all 16 `/ars-*` commands, the payload root, and the academic-only routing sentence. |
| Subagent end-to-end | A separate subagent reported 6/6 PASS: catalog 9/9; `skill("ars-agent-synthesis")` loaded with mirror directory `payload/deep-research`; it read `payload/deep-research/references/apa7_style_guide.md` (4,684 B) and `payload/shared/references/intent_clarification_protocol.md` (11,564 B); `ars_status` showed all registrations true; `ars_script` ran `check_acronyms.py --help` (exit 0). |
| `ars_status` live | payload present, `missing: []`; counts 5 skills / 16 commands / 4 agent definitions / 47 agent files / 455 top-level scripts / 2 hooks; Python `mode: venv`, `ready: true`, 3.12.13; model `deepseek-flash` + DeepSeek `web_search` (`toolAvailable: true` in the live session); guard `manifestAgents: 23`, `phaseFence: "unavailable"` + reason; 5/5 + 4/4 + 16/16 `registered: true`; payload contract matches 1,203/24,815,025; `lint.warnings: []`. |
| Deterministic gates through `ars_script` | `scripts/check_acronyms.py --help` exit 0; `scripts/check_acronyms.py --input /tmp/ars-acronym-sample.md --lang en` exit 0 with a real advisory report (AI/LLM undefined); `scripts/check_pipeline_integrity.py /tmp` exit 0; `sr-screener/scripts/build_workflow.py --help` exit 0. Interpreter was `<managed-venv>/bin/python`. |
| Guard live denial | A `write` to the plugin's `cordis.patch.yml` (identical content, no-op) was denied: `Error: ARS scope guard: …/cordis.patch.yml is part of the ARS plugin's enforcement infrastructure and may not be written by any agent.` This exercised the installed guard, not just the unit tests. |
| Command-dispatch message shape | Two plain `agent.followup({id, role:'user', content:[{type:'text',text}], source:{kind:'user'}})` messages were sent from a temporary probe bundle; both were delivered to this session as real user turns (`ARS spike followup probe…`, `ARS-FOLLOWUP-PROBE-3…`). This proves the message shape used by every `/ars-*` handler is accepted by the host and starts the next turn. The probe bundle was removed afterwards. |
| Payload immutability live | After the live gate runs, `find payload -name '__pycache__' -o -name '*.pyc'` is empty and `node tools/check-payload.mjs` exits 0 with the pinned digests (1,203 files / 24,815,025 bytes); the `PYTHONDONTWRITEBYTECODE=1` fix in `lib/env.js` and `bin/ars-python` was verified live. |
| Final gates after polish | `node --test test/*.test.mjs` → 196/196 pass; `node tools/verify-install.mjs` → 51 PASS / 0 FAIL / 3 WARN; `node tools/check-payload.mjs` → 0 errors / 4 upstream-doc warnings. |

**Narrower remaining gap.** §7.1 is now narrowed to the composer itself: the
Lead did not type `/ars-plan` (or another `/ars-*`) into the Web GUI composer and
watch the UI turn. The handler code (including the follow-up message) is covered
by unit tests and by the live follow-up delivery above; the Composer wiring and
the model-side execution quality of the workflows remain UI/model behavior that
was not exercised here. §7.2–§7.8 stand unchanged.
