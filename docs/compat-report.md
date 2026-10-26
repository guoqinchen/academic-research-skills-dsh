# DeepSeek Harness compatibility report — Academic Research Skills

> **2026-10-26 runtime update.** Attribution rules now also rewrite legacy
> runtime vocabulary: `sonnet`/`opus`/`haiku` → `deepseek-flash`, `Claude Code`
> → `DeepSeek Harness`, `.claude/CLAUDE.md` and `.claude/agents/` → the plugin's
> own routing/agent-role layout. The registered documents contain zero Claude
> model or filesystem references and are lint-clean. `ars_status` reports the
> runtime as DeepSeek Flash with DeepSeek native `web_search` as the default
> search path, and reports the guard phase fence honestly as `unavailable`
> (DSH exposes no agent type; the hypothetical role registry was removed).

Scope: the 25 upstream Markdown documents that the DSH port registers or feeds to the model
(5 × `<skill>/SKILL.md`, 16 × `commands/*.md`, 4 × top-level `agents/*.md`), plus the short
system-prompt announcement.

| Item | Value |
|---|---|
| Upstream repository | `github.com/Imbad0202/academic-research-skills` |
| Upstream commit | `1ec249df98728682dfbbdfb940a658338bfd6f80` |
| Upstream plugin version | `3.23.2` (`.claude-plugin/plugin.json`) |
| Payload | `payload/` — byte-preserving snapshot with `PROVENANCE.json` and `REFERENCE-INDEX.json` |
| Corpus size | 25 documents, 4,599 lines, 367,109 bytes |
| Registration surfaces | 5 research skills, 4 agent-role skills, 16 `/ars-*` commands, 1 announcement section |
| Adaptation point | registration time, in memory (`lib/adapt.js`); the payload is never modified |
| Parser | `lib/frontmatter.js` — dependency-free YAML subset parser |
| Compat code | `lib/frontmatter.js`, `lib/adapt.js`, `lib/announce.js` |
| Tests | `test/frontmatter.test.mjs` (44 tests), `test/adapt.test.mjs` (52 tests) |
| Result | **96/96 tests pass; 0 lint findings across all 25 adapted documents** |

The four root `payload/agents/*.md` files are byte-identical mirrors of a skill-local role file:
`synthesis_agent`, `research_architect_agent`, and `report_compiler_agent` mirror
`deep-research`; `screening_reviewer_agent` mirrors `sr-screener` (confirmed by
`payload/REFERENCE-INDEX.json`). Their bare `references/`, `agents/`, `templates/`, and
`examples/` prefixes therefore resolve inside the **mirror skill directory**, and
`lib/agents.js` passes that directory to `adaptAgentBody(body, { agent, skill })`.

---

## 1. Method

1. **Parse** every document with `parseMarkdownFile(text)` → `{ data, body }`. The parser
   understands only the YAML subset actually used upstream: plain/quoted scalars, nested maps,
   `- item` lists, and `true`/`false`. Dates, versions, and numbers stay strings.
2. **Adapt only the body** (frontmatter is consumed by registration code):
   - `adaptSkillBody(body, { skill })` — `prelude({ skill })` + transformed body;
   - `adaptCommandBody(body, { command, skill, args })` — command prelude + transformed body +
     the raw user request (or inline `$ARGUMENTS` substitution);
   - `adaptAgentBody(body, { agent, skill })` — agent prelude + transformed body, with `skill`
     naming the mirror skill for relative-path resolution.
3. **Lint** the result with `lint(text)`; a non-empty result is a registration-time warning that
   `lib/skills.js`, `lib/agents.js`, and `lib/commands.js` log (and `ars_status` can surface),
   never a crash.
4. **Verify** against the real corpus: every document must parse, adapt, and lint clean; the
   built payload must adapt identically to the upstream clone (after normalizing the two roots).

Nothing in this report required editing the payload, and the tests assert the payload bytes are
unchanged after adaptation.

### Relative path contract encoded by the prelude

| Prefix | Resolves against |
|---|---|
| `references/`, `agents/`, `templates/`, `examples/` | the skill directory (for agent files: the mirror skill directory) |
| `shared/`, `scripts/`, `docs/`, `tools/`, `MODE_REGISTRY.md`, other skill names (`deep-research`, `academic-paper`, …) | the payload root |
| `scripts/` inside `sr-screener` | the `sr-screener` skill directory, **not** the payload root (the skill ships its own `sr-screener/scripts/`) |

The prelude states the payload root, the skill/mirror directory, these two prefix classes, the
tool-name table, plain-name `skill` invocation, and the managed Python wrapper
(`paths.binRoot/ars-python`, absolute). Command preludes also name the upstream command; agent
preludes name the role and its mirror-skill directory.

---

## 2. Token inventory (real counts from the 25-document corpus)

Counts are occurrences across the 25 documents (frontmatter included where noted). “Residual”
counts are after adaptation and are also covered by `lint`.

| # | Upstream token / pattern | Occurrences (files) | Rule applied | Residual |
|---|---|---:|---|---:|
| 1 | `${CLAUDE_PLUGIN_ROOT}` | 41 (13) | absolute `paths.payloadRoot` (no trailing slash) | 0 |
| 2 | `academic-research-skills:` | 15 (15) | strip plugin namespace; skill names stay plain; `screening_reviewer_agent` → `ars-agent-screening-reviewer` | 0 |
| 3 | `Skill tool` | 13 (13) | `` `skill` tool `` | 0 |
| 4 | ``skill: "academic-research-skills:x"`` lead-in | 13 (13) | `` `name: "x"` `` + “as its arguments” sentence rewritten (the DSH tool has no arguments parameter) | 0 |
| 5 | `$ARGUMENTS` | 3 (3) | raw user input, verbatim (inline substitution) | 0 |
| 6 | `python3 scripts/<x>.py` | 9 (6) | `<binRoot>/ars-python <payloadRoot>/scripts/<x>.py` | 0 |
| 7 | `python $S/<x>.py` + `S=<this skill's folder>/scripts` | 6 + 1 (1) | `S="<payloadRoot>/sr-screener/scripts"` + `<binRoot>/ars-python "$S/<x>.py"` | 0 |
| 8 | `PYTHONPATH=. python3 -m unittest scripts.test_*` | 1 (1) | `<binRoot>/ars-python -m unittest scripts.test_*` (wrapper supplies `PYTHONPATH`) | 0 |
| 9 | `AskUserQuestion` | 5 (5) | `` `ask_user_question` `` | 0 in bodies¹ |
| 10 | `WebSearch` | 2 (1) | `` `web_search` `` | 0 in bodies¹ |
| 11 | `Agent call` | 2 (1) | `` `subagent` call `` | 0 |
| 12 | `Workflow tool` | 2 (1) | `` `workflow` tool `` | 0 |
| 13 | `-> Workflow` | 2 (1) | `` -> `workflow` tool `` | 0 |
| 14 | `Workflow({scriptPath: "<printed path>"})` | 1 (1) | “run the printed script with the `workflow` tool” | 0 |
| 15 | `Workflow / Agent` (reference-table phrase) | 1 (1) | `` `workflow` tool / `subagent` tool `` | 0 |
| 16 | `Read and Grep` (tool-list shorthand) | 2 (2) | `` `read` and `grep` `` | 0 |
| 17 | `Claude Code session` | 1 (1) | `DeepSeek Harness session` | 0 |
| 18 | `Task tool` | 0 | `` `subagent` tool `` (implemented; synthetic test) | 0 |
| 19 | `subagent_type: X` | 0 | `the ARS agent-role skill for X` (implemented; synthetic test) | 0 |
| 20 | `TodoWrite`, `WebFetch`, `MultiEdit`, `NotebookEdit`, `BashOutput`, `KillShell` | 0 each | mapped to `todo_write`, `web_fetch`, `edit` (per hunk), `edit`, `job_output`, `job_kill` (implemented; synthetic test) | 0 |

¹ The prelude’s mapping table intentionally prints upstream names on the left side
(`WebSearch → web_search`). Those are the only occurrences of `AskUserQuestion`/`WebSearch`
in the adapted documents; the upstream prose itself is fully rewritten.

Additional corpus facts used by the adaptation:

- 13 of 16 commands start with the Claude Code lead-in and carry the plugin namespace;
  the 3 CLI commands (`ars-cache-invalidate`, `ars-mark-read`, `ars-unmark-read`) do not.
- 13 commands set `disable-model-invocation: true`; 12 commands set `model: sonnet`; the four
  agents set `model: inherit`. None of these frontmatter values is forwarded as a DSH model.
- 13 commands have no `$ARGUMENTS` placeholder. Their adapted prompt appends
  `## User request (raw input)` with the raw input; without this the user request would be
  dropped, because DSH commands receive a separate `rawInput` string rather than Claude Code’s
  implicit argument interpolation.
- 55 relative `scripts/…` path references exist. 9 are `python3 scripts/*.py` invocation forms
  that become absolute; the other 46 are prose/file references and stay relative, resolvable
  through the prelude’s payload-root rule.

---

## 3. Transformation examples

### 3.1 Plugin root

Upstream (`commands/ars-3w.md:12-13`):

```text
Mode reference: `${CLAUDE_PLUGIN_ROOT}/MODE_REGISTRY.md` § deep-research.
Skill entry: `${CLAUDE_PLUGIN_ROOT}/deep-research/SKILL.md`.
```

Adapted:

```text
Mode reference: `<payloadRoot>/MODE_REGISTRY.md` § deep-research.
Skill entry: `<payloadRoot>/deep-research/SKILL.md`.
```

### 3.2 Skill namespace and invocation lead-in

Upstream (`commands/ars-3w.md:8`):

```text
First invoke the Skill tool with `skill: "academic-research-skills:deep-research"`. Pass the mode and the user's request described below as its arguments. Use the loaded skill and its supporting files before producing the result.
```

Adapted (`deep-research` is now a plain DSH skill name; the `skill` tool takes `name` only):

```text
First invoke the `skill` tool with `name: "deep-research"`. After the skill loads, execute the mode and the user's request described below. Use the loaded skill and its supporting files before producing the result.
```

Agent namespace (`sr-screener/SKILL.md:146`, `agents/screening_reviewer_agent.md:86`):
`academic-research-skills:screening_reviewer_agent` → `ars-agent-screening-reviewer` (the DSH
agent-role skill registered from `payload/agents/screening_reviewer_agent.md`).

### 3.3 Python and shell invocations

| Upstream | Adapted |
|---|---|
| `python3 scripts/run_ledger.py show …` (deep-research:205) | `<binRoot>/ars-python <payloadRoot>/scripts/run_ledger.py show …` |
| `python3 scripts/check_acronyms.py --input …` (academic-paper-reviewer:232) | `<binRoot>/ars-python <payloadRoot>/scripts/check_acronyms.py --input …` |
| `python3 scripts/ars_mark_read.py $ARGUMENTS --passport-path "<path>"` (ars-mark-read:15) | `<binRoot>/ars-python <payloadRoot>/scripts/ars_mark_read.py <raw input> --passport-path "<path>"` |
| `PYTHONPATH=. python3 -m unittest scripts.test_claim_audit_calibration -v` (academic-pipeline:670) | `<binRoot>/ars-python -m unittest scripts.test_claim_audit_calibration -v` |
| `bash scripts/<x>.sh` (absence in corpus; implemented) | `bash <payloadRoot>/scripts/<x>.sh` |

`sr-screener/SKILL.md:255-264` becomes:

```bash
S="<payloadRoot>/sr-screener/scripts"
<binRoot>/ars-python "$S/prepare_records.py" --inputs exports/ --work sr_work --config screening_config.json
<binRoot>/ars-python "$S/build_workflow.py" ta --work sr_work --protocol screening_protocol.md --config screening_config.json --jobs pilot
#   -> run the printed script with the `workflow` tool after the user approves the cost
…
```

`<binRoot>` is `paths.binRoot` (`<pluginRoot>/bin`), **not** `<payloadRoot>/bin`; `bin/ars-python`
belongs to the plugin package. The adapter exposes the absolute path as `adapter.pythonWrapper`.
Paths containing shell-special characters are double-quoted; in this workspace the absolute
paths contain a space, so the emitted commands are quoted.

### 3.4 `$ARGUMENTS` and raw input

- Placeholder form (3 commands): `$ARGUMENTS` → the raw user input, substituted verbatim with
  literal `.split().join()` (no `$&`/`$1` expansion) and **no** extra request section.
- No-placeholder form (13 commands): the raw input is appended under
  `## User request (raw input)`; empty input becomes `_No additional input was provided._`.
- `${ARGUMENTS}` is accepted too (absent upstream); `$1` is deliberately left untouched.

### 3.5 Tool names

| Upstream prose | Adapted |
|---|---|
| `AskUserQuestion tool` | `` `ask_user_question` tool `` |
| `WebSearch` | `` `web_search` `` |
| `Task tool` | `` `subagent` tool `` |
| `subagent_type: X` | `the ARS agent-role skill for `X`` |
| `Agent call` / `Agent tool` | `` `subagent` call `` / `` `subagent` tool `` |
| `Workflow tool` | `` `workflow` tool `` |
| `Read and Grep tools` | `` `read` and `grep` tools `` |
| `MultiEdit` / `NotebookEdit` | `` `edit` (one call per hunk) `` / `` `edit` `` |
| `BashOutput` / `KillShell` | `` `job_output` `` / `` `job_kill` `` |

Ordinary prose is intentionally untouched: `read`, `write`, `skill`, `Grep retry`, `Read scope`,
`Write scope`, `Bash deny`, `/ars-*`, role names, protocol markers (`[direct-mode]`,
`[CROSS-MODEL-…]`), and environment variables. Only precise tool-name/pattern matches change.

---

## 4. Prelude and announcement

### 4.1 Document prelude (every skill / command / agent)

The prelude is a compact Markdown block placed before the adapted body. It states:

- the immutable payload root and, when applicable, the skill (or mirror skill) directory;
- command identity (`/ars-x`) or agent role name and dispatch semantics;
- which prefixes are skill-relative and which are payload-root-relative;
- the `sr-screener` exception for its own `scripts/`;
- plain-name `skill` invocation (no namespace, no arguments parameter);
- the managed Python wrapper and the `bash` invocation rule;
- the full upstream → DSH tool-name table;
- that the payload is read-only.

### 4.2 System-prompt announcement (`lib/announce.js`)

- One section named `academic-research-skills`, order `40`, registered through
  `ctx.effect(() => ctx.systemPrompt.section({...}))` so uninstall/reinstall disposes it cleanly.
- `interpolate: false` (static text; no `{{variable}}` interpolation).
- Content: payload root; the 5 research skills; the 4 agent-role skills; all 16 `/ars-*`
  commands (`Commands (16): …`); and the routing sentence
  “Use these skills only for academic research requests: … Route unrelated coding, office, or
  general requests outside ARS.”
- Disabled entirely when `config.announce === false` (returns `false`, no effect, no section).
- Command names are read from `paths.commandsRoot` at registration time; a frozen 16-name
  fallback list is used only if the payload directory cannot be read.

---

## 5. Residual, non-rewritten patterns

These appear in adapted text but are not Claude-Code-only *execution* tokens; they are listed
with the reason they were left alone. None matches `lint`. Line numbers are upstream.

| Pattern | Count | Examples | Assessment |
|---|---:|---|---|
| `.claude/` | 8 | `.claude/CLAUDE.md` at deep-research:23 (also academic-paper:24, academic-paper-reviewer:24, academic-pipeline:21, sr-screener:31); `.claude/agents/` at sr-screener:147 and agents/screening_reviewer_agent:87 | **Safe / stale.** Install-context prose only; the routing core it mentions is already embedded in each `SKILL.md`, and DSH never loads `.claude/`. The copy-to-`.claude/agents/` note is historical; the role is registered as `ars-agent-screening-reviewer`. |
| `PreToolUse` | 6 | deep-research:385, academic-paper:228, academic-paper-reviewer:297, academic-pipeline:377, agents/research_architect_agent:28, agents/synthesis_agent:28 | **Safe.** Describes upstream hook enforcement. DSH implements the same write-scope decision through the runtime guard (`ctx.tools.guard`), not hooks; the sentence still truthfully says enforcement exists in the plugin install. Caveat: the DSH guard has no role source, so the phase fence is reported as unavailable (infrastructure protection still applies). |
| Legacy model aliases `sonnet` / `opus` / `haiku` | 15 tokens in 5 prose lines | sr-screener:427-428,433 (model-tier table); commands/ars-reviewer:9 and commands/ars-revision-coach:9 (“opus frontmatter floor retired”) | **Rewritten at adaptation time** to `deepseek-flash`; no adapted instruction selects a Claude model. |
| `model:` frontmatter values | 16 | 12 commands `model: sonnet`; 4 agents `model: inherit` | **Safe.** Frontmatter is stripped; DSH does not forward an upstream model selection. |
| `disable-model-invocation: true` | 13 | 13 command frontmatter blocks | **Safe.** DSH’s command plane is user-invoked; the upstream intent is preserved by the registration model. |
| `Workflow scripts` / `generate the Workflow script` | 2 lines | sr-screener:477,493 | **Risk, documented.** The adapted instructions now route to DSH’s `workflow` tool, but `build_workflow.py` generates Claude-Code-style workflow scripts (`templates/workflows/*.template.js`). Script-format portability is unverified; prefer `--emit-prompts DIR` + one `subagent` call per prompt file in DSH until the generator is validated. Runtime/payload follow-up, outside this adapter. |
| Relative `scripts/…` references | 46 | deep-research:189, academic-paper-reviewer:232, agents/research_architect_agent:109 | **Safe.** Resolvable through the prelude’s payload-root rule; every executable invocation form is absolute. |
| `scripts/run_codex_audit.sh` external audit | 1 | academic-pipeline:46 | **Safe / opt-in.** Gated behind `ARS_AUDIT_ARTIFACT_GATE=1`, sends a deliverable to the external `codex` CLI; the wrapper exists in the payload, but the external CLI is a host dependency. It is a prose reference, so it stays relative and resolves via the prelude. |
| `/ars-*` and “slash command” mentions | 11 | deep-research:30,198,383; academic-paper:30,225,391; academic-paper-reviewer:31,295; academic-pipeline:26,373; sr-screener:38 | **Safe.** The 16 commands are registered in DSH with these names. |
| Role numbering (`Agent 9`, `Agent 1->7`) | 1+ | commands/ars-disclosure:10, academic-paper:341 | **Safe.** Internal role numbering, not a tool name. |
| `plugin install` / `skills-copy install` prose | several | skill routing-discipline notes | **Safe / stale.** Describes upstream installation methods; no action. |
| Protocol markers and environment variables | many | `[direct-mode]`, `[CROSS-MODEL-HANDOFF v1]`, `ARS_*`, `~/.cache/ars/…` | **Safe.** Deliberately untouched; they are part of the skill contracts. |

### Known lint edge case

`lint` scans the finished adapted string, including the appended raw user request. A user who
literally types a forbidden token (for example `${CLAUDE_PLUGIN_ROOT}`) will therefore produce a
registration-time warning for that command invocation. This is a warning only; it does not fail
dispatch or alter the payload. The upstream templates themselves are lint-clean (0 findings for
all 25 documents).

---

## 6. Verification

Environment: Node `v24.22.1`, no npm dependencies, tests read the built `payload/` when present
and fall back to the upstream clone.

```bash
cd "academic-research-skills-dsh"
node --test test/frontmatter.test.mjs test/adapt.test.mjs
# tests 96, pass 96, fail 0
```

Coverage asserted by the tests:

- **Frontmatter (44 tests):** fence/BOM/CRLF handling, quoted/plain/boolean scalars, no
  date/version coercion, escapes, nested maps, list sequences, comment/blank handling, malformed
  indentation; all 25 documents parse with non-empty name/description/body; nested
  `metadata.version` / `last_updated` / `status` / `data_access_level` / `task_type` /
  `related_skills` for all 5 skills; `depends_on`; 13 boolean command flags; 4 agent `tools`
  allowlists.
- **Adapter (52 tests):** the 5+16+4 surface counts; every adapted document lint-clean, rooted,
  heading-preserving, fence-preserving, deterministic, and payload-immutable; prelude contents
  (roots, prefix classes, all 16 tool mappings, wrapper, read-only rule); 13 lead-in rewrites;
  41 plugin-root substitutions; `$ARGUMENTS` inline substitution in 3 commands and
  `## User request` injection in 13; literal `$&`/`$1` preservation; namespace/agent mapping;
  Python/shell rewrites (including the `$S` block and the `PYTHONPATH` module invocation);
  mirror-skill preludes for all 4 agent roles; announcement registration through
  `ctx.effect`, order/name/interpolate, 5/4/16 inventory, disable flag, fallback list; six lint
  patterns; payload-vs-clone agreement (25 documents, 0 differences).

Payload agreement test diagnostic from the run: `payload documents checked: 25; differences: 0`
(frontmatter data and adapted text identical after normalizing the payload root), with the
payload preferred automatically when complete.

---

## 7. Limitations / follow-ups (not blocking registration)

1. **sr-screener workflow generation** targets the Claude Code workflow script format; only the
   per-call prompt-file path is known to be host-neutral today (see §5).
2. **Model-tier aliases** in `sr-screener` and two command descriptions are not translated to
   DSH model identifiers; DSH uses the session/agent model configuration.
3. **Guard prose vs. DSH guard implementation:** the `PreToolUse` sentences remain upstream
   descriptions; the DSH guard is wired separately and reports the phase fence as unavailable without an agent type
   role.
4. **Lint scope includes user input** for command dispatch (warning only, see §5).
5. **Absolute paths are quoted only when they contain shell-special characters**; the tests use
   `adapter.pythonWrapper` rather than a hard-coded path segment, so a future install location
   without spaces still passes.
