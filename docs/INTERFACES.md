# Internal interfaces (Lead-owned, change only by agreement)

Plugin root: `<plugin-root>`
Upstream clone: `<upstream-checkout>` (commit b34c63f828b3535f403079a4f42bc7955da2f64b, plugin version 3.24.0)

All modules are plain ESM JavaScript with **no external npm dependencies**. Node built-ins only
(`node:fs`, `node:path`, `node:process`, `node:os`, `node:crypto`, `node:child_process`, `node:url`, `node:test`).
The plugin runs inside the DSH Host process and must not import `@deepseek-ai/*` packages
(they are not resolvable from a linked workspace bundle).

## `lib/paths.js` (Lead — done)

```js
createPaths(pluginRoot?) -> {
  pluginRoot, payloadRoot, commandsRoot, agentsRoot, scriptsRoot,
  sharedRoot, docsRoot, hooksRoot, binRoot, requirementsPath,
  provenancePath, referenceIndexPath,
  phaseManifestPath, guardScriptPath, wrapperPath,
  skillFile(skill), skillDirectory(skill), commandFile(file)
}
```

## `lib/config.js` (Lead — done)

```js
normalizeConfig(raw?, {home?}?) -> {
  announce: boolean, commands: boolean, tools: boolean,
  guard: boolean, guardInfra: boolean,
  pythonPath: string|null, cacheRoot: string, envDir: string,
  scriptTimeoutMs: number, maxScriptOutputBytes: number,
  modelProfile: 'deepseek-flash', webSearch: boolean,
  commercialMode: boolean
}
```

## `lib/frontmatter.js` (compat-adapter owns)

Dependency-free parser for the YAML frontmatter used by the upstream repository:
plain/quoted scalars, nested maps, `- item` lists (indented or indentationless),
URL list entries, and inline comments (`#` outside quotes; a quoted `#` is
preserved). It must not need a full YAML engine.

```js
parseFrontmatter(text) -> { data: object, body: string } | null
  // Returns null when the text does not start with a `---` fence.
  // `body` is the text after the closing fence, trimmed.
parseMarkdownFile(text) -> { data: object, body: string }
  // Same, but a missing frontmatter yields { data: {}, body: text.trim() }.
```

Must parse all 5 upstream `*/SKILL.md`, all 16 `commands/*.md`, and all `agents/*.md`
without throwing; nested `metadata:` blocks and lists are required for skills.
Unknown scalar values stay strings (do not coerce dates/numbers except obvious booleans).

Malformed frontmatter still throws from the parser. `index.js#loadInventory` catches
a strict-read failure, retries with `strict:false`, records every issue in the
registration report, and the skill/command/agent registrars skip `valid:false`
entries instead of aborting the whole mount.

## `lib/adapt.js` (compat-adapter owns)

```js
createAdapter({ paths, inventory?, policy?, webSearch? }) -> {
  payloadRoot: string,
  prelude({ skill }): string,          // DSH compatibility preamble for one skill
  adaptSkillBody(body, { skill }): string,   // prelude + transformed body; frontmatter already stripped
  adaptCommandBody(body, { command, skill, args }): string,
  adaptAgentBody(body, { agent, skill }): string,
  announceText({ commands, agentSkills }): string,
  lint(text): string[],                // residual legacy-runtime tokens (Claude/model aliases) found in an adapted string
}
```

Transformation requirements (see `docs/compat-report.md` for the inventory and counts):

1. `${CLAUDE_PLUGIN_ROOT}` → absolute `paths.payloadRoot` (no trailing slash).
2. `academic-research-skills:<skill>` → `<skill>`; the DSH skill names are exactly
   `deep-research`, `academic-paper`, `academic-paper-reviewer`, `academic-pipeline`, `sr-screener`.
3. `Skill tool` → `` `skill` tool ``; `skill: "x"` → `name: "x"` where the upstream line
   tells the model to invoke a skill. Do not rewrite ordinary prose uses of "skill".
4. Tool-name mapping in prose: `Task tool` → `` `subagent` tool ``,
   `subagent_type: X` → `the ARS agent-role skill for X`, `AskUserQuestion` → `ask_user_question`,
   `TodoWrite` → `todo_write`, `WebSearch` → `web_search`, `WebFetch` → `web_fetch`,
   `MultiEdit` → `edit (one call per hunk)`, `NotebookEdit` → `edit`, `BashOutput` → `job_output`,
   `KillShell` → `job_kill`.
5. Python/shell script invocation: `python3 scripts/<x>` (and `python scripts/...`,
   `${CLAUDE_PLUGIN_ROOT}/scripts/...`, `sr-screener/scripts/...`) must resolve through the
   managed interpreter and absolute payload paths:
   `<binRoot>/ars-python <payloadRoot>/scripts/<x>`
   where `<binRoot>` is `paths.binRoot` (the plugin's `bin/` directory, NOT under payload/).
   `bash scripts/<x>.sh` → `bash <payloadRoot>/scripts/<x>.sh`.
   Never rewrite code that is prose only; keep `$ARGUMENTS` handling below.
6. `$ARGUMENTS` (command bodies only) → the raw user input, verbatim. Also `${ARGUMENTS}`
   and `$1` are absent upstream and may stay untouched.
7. Skill bodies keep their upstream meaning; the prelude must state:
   - repo root and skill directory; which relative prefixes resolve to the skill directory
     (`references/`, `agents/`, `templates/`, `examples/`) vs the repo root
     (`shared/`, `scripts/`, `docs/`, `tools/`, `MODE_REGISTRY.md`, other skill names);
   - the DSH tool-name mapping table (Read→read, Write→write, Edit→edit, Bash→bash,
     Grep→grep, Glob→glob, WebSearch→web_search, WebFetch→web_fetch, TodoWrite→todo_write,
     AskUserQuestion→ask_user_question, Task→subagent with the role file as prompt);
   - invoke skills with the `skill` tool by name (no namespace);
   - run Python through `<binRoot>/ars-python` (absolute).
8. `lint(text)` reports any residual `${CLAUDE_PLUGIN_ROOT}`, `academic-research-skills:`,
   `Skill tool`, `subagent_type`, `python3 scripts/`, `python scripts/`, `Claude Code`,
   and `sonnet`/`opus`/`haiku` in the transformed text.
   Legacy model labels are rewritten to `deepseek-flash`, `Claude Code` to
   `DeepSeek Harness`, and `.claude/...` runtime paths to the plugin layout, so
   no adapted document requires a Claude model or Claude filesystem.
   The command/skill/agent registration code must treat a non-empty lint result as a
   registration-time warning (log + expose in `ars_status`), not a crash.

## `lib/env.js` (runtime-tools owns)

```js
createPythonEnv({ paths, config, run?, requirementsPath?, home? }) -> {
  status(): Promise<{mode, executable, venvPath, ready, missing: string[], uv: boolean, pythonVersion: string|null}>,
  ensure({ force = false }): Promise<{ok, mode, venvPath, python, installed: string[], log: string}>,
  pythonExecutable(): string,          // contract resolution (venv → configured → python3)
  scriptEnv(): Record<string,string>,
  wrapperPath(): string,               // <binRoot>/ars-python, generated from the contract
  writeRuntimeState(): boolean,        // publish envDir for a model-issued shell wrapper
}

`lib/python-contract.js` is the one owner of venv resolution, env names, PYTHONPATH,
bytecode policy, and the wrapper text. `bin/ars-python` is generated from
`renderWrapper()` by `tools/build-python-wrapper.mjs` (use `--check` in tests).
The wrapper resolves `ARS_DSH_VENV` → `$HOME/.cache/ars-dsh/runtime-state` line 1 →
default venv → `python3`, and exports `PYTHONPATH`, `ARS_PAYLOAD_ROOT`,
`PYTHONDONTWRITEBYTECODE=1`.
```

- venv at `config.envDir` (default `~/.cache/ars-dsh/venv`).
- `ensure` prefers `uv` (on PATH) and falls back to `<python> -m venv` + `pip install -r requirements-runtime.txt`.
- `status` must never throw when Python is absent; report `ready: false` and missing entries.
- Dependency probe list (minimum): `yaml`, `jsonschema`, `ruamel.yaml`, `pypdf`, `defusedxml`,
  `openpyxl`, `markdown_it`, `linkify_it`.
- `bin/ars-python` is a generated POSIX sh wrapper (see the contract above).
  `tools/build-python-wrapper.mjs --check` verifies bytes + exec bit.

## `lib/guard.js` (runtime-tools owns)

```js
evaluateDecision({ toolName, toolInput, agentType, cwd, workspaceRoot, pluginRoot, manifest, toolMap })
  -> { decision: 'allow'|'deny', reason: string, ...advisoryFlags }
registerGuard(ctx, { paths, config }) -> boolean
PHASE_FENCE_STATUS -> { mode: 'unavailable', reason: string }
```

- Faithful port of upstream `scripts/ars_write_scope_guard.py::evaluate_decision`:
  inspected tools, Bash-denied for Bucket A, schema-drift deny, infra protection anchored on
  the plugin root, escape check, phase-glob fence, advisory flags.
- DSH tool mapping: `write`→Write, `edit`→Edit, `bash`→Bash, `ars_script`→ArsScript.
  `write`/`edit` use `file_path`; `ars_script` uses its declared output flags.
- `ars_script` is inspected as a *declared-output* tool: a Bucket A agent may not run
  payload scripts at all (same rationale as Bash), and every caller is denied when an
  `--out`/`--output`/`--out-dir`/`--dir`/`-o` target resolves into the plugin's
  enforcement files. Positional arguments are not interpreted — this is an
  infrastructure guard, not a sandbox.
- `ctx.tools.guard` is synchronous and never supplies an agent type (DSH tool
  executions have no `agent_type`). `evaluateDecision` keeps the phase logic for
  upstream parity; `registerGuard` reports `PHASE_FENCE_STATUS` instead of
  carrying a dormant role registry. Infra protection (`config.guardInfra`)
  applies to every caller.
- Unit tests must compare against the Python reference decision for the upstream captured
  payload fixture `repo/scripts/fixtures/write_scope_guard/captured_payloads.json`.

## `lib/tools.js` + `lib/status.js` (runtime-tools owns)

```js
registerTools(ctx, { paths, config, env, adapter, inventory?, report?, warnings? }) -> void
buildStatus({ paths, config, env, ctx, agent, adapter, inventory?, report? }) -> Promise<object>
```

Three tools (plain ToolDefinition objects, no `defineTool` helper):

1. `ars_status` — no args. Returns counts, payload provenance, python readiness, guard config,
   registered ARS skills/commands (verify with `ctx.commands.find(agent, name)`), and lint warnings.
2. `ars_script` — `{ script: string, args?: string[], cwd?: string, timeoutMs?: number }`.
   Runs one script under `paths.payloadRoot` (reject paths escaping it), through
   `env.wrapperPath()` (same resolver as a model-issued shell wrapper), `cwd` default
   `paths.payloadRoot`, `env.scriptEnv()`, captures
   stdout/stderr up to `maxScriptOutputBytes`, returns `{exitCode, stdout, stderr, truncated, script, python}`.
3. `ars_env_setup` — `{ force?: boolean }`. Calls `env.ensure`, returns its result.

Every tool needs an `output.schema` (JSON Schema object) and `output.render(args, value)`
returning `[{type:'text', text}]`. Raw JSON Schema rules: `required` is a top-level array,
`additionalProperties: false`, per-property `required` is rejected by DSH.

## `lib/announce.js` (compat-adapter owns, wired by Lead)

```js
registerAnnounce(ctx, { paths, adapter, config, inventory?, report? }) -> boolean
```

Registers one `ctx.systemPrompt.section({ name, order, text })` (order 40) with the short
ARS availability block: inventory-derived 5 skill names, 4 agent-role skill names, 16
`/ars-*` command names, the DeepSeek Flash + native `web_search` default, the "academic
requests only" routing sentence, and the payload root. Must be disabled by
`config.announce === false`.

## `lib/skills.js`, `lib/agents.js`, `lib/commands.js`, `index.js` (Lead owns)

- Skills: 5 runtime skill registrations via `ctx.skills.register({ name, description, content, source: 'bundled', resourceBase, metadata, invocation })`.
  `resourceBase` is the skill directory inside the payload. `content` is the adapted body.
- Agent skills: 4 (`ars-agent-synthesis`, `ars-agent-research-architect`,
  `ars-agent-report-compiler`, `ars-agent-screening-reviewer`) built from `payload/agents/*.md`;
  `invocation: { modelInvocable: true, userInvocable: false }`. The four root agent files are
  byte-identical mirrors of one skill's `agents/` copy (synthesis/research_architect/report_compiler
  → `deep-research`; screening_reviewer → `sr-screener`). Their `resourceBase` is that mirror skill
  directory and `adaptAgentBody` is called with `{ agent, skill: mirrorSkill }`, so bare
  `references/`/`templates/` paths resolve correctly.
- Commands: 16 `ctx.commands.register({ name, description, input: { hint }, handler })`.
  The handler adapts the command body with the invocation's raw input and submits it as one
  plain user message through `invocation.agent.followup(message)`:
  `{ id: randomUUID(), role: 'user', content: [{type:'text',text}], source: {kind:'user'} }`.
  It returns `{ kind: 'success', text }`.
- `index.js` wires everything and guards each optional section with the config flags.

## Module ownership map

| Path | Owner |
|---|---|
| `package.json`, `cordis.patch.yml`, `index.js`, `lib/paths.js`, `lib/config.js`, `lib/skills.js`, `lib/agents.js`, `lib/commands.js`, `locale/*`, `icon.svg`, `README.md`, `NOTICE.md`, `LICENSE` | Lead |
| `payload/**`, `tools/build-payload.mjs`, `tools/check-payload.mjs`, `requirements-runtime.txt`, `payload/PROVENANCE.json`, `payload/REFERENCE-INDEX.json` | payload-porter |
| `lib/frontmatter.js`, `lib/adapt.js`, `lib/announce.js`, `test/frontmatter.test.mjs`, `test/adapt.test.mjs`, `docs/compat-report.md` | compat-adapter |
| `lib/env.js`, `lib/tools.js`, `lib/status.js`, `lib/guard.js`, `bin/ars-python`, `test/env.test.mjs`, `test/tools.test.mjs`, `test/guard.test.mjs` | runtime-tools |
| `test/e2e.test.mjs`, `test/payload.test.mjs`, `test/register.test.mjs`, `tools/verify-install.mjs`, `docs/verification.md` | verifier |

Do not edit another owner's files. Report interface gaps in the task thread instead.


## Refactor additions (2026-10-26)

New shipped modules and their single responsibilities:

```js
// lib/inventory.js
SKILL_NAMES, AGENT_ROLE_SPECS, AGENT_NAME_TO_SKILL, COMMAND_FALLBACK_NAMES
createInventory({ paths, strict? }) -> { skills, commands, agentRoles,
  skillNames, commandNames, agentRoleNames, skill(), command(), agentRole(), errors }
readCommandEntry(paths, file) -> command entry

// lib/reference-rules.js (pure, no I/O)
classifyReference(raw, { skill? }) -> { scope, path }
resolveReference(raw, { skill, payloadRoot, skillDir }) -> string|null
resolveScriptPath(raw, { skill, payloadRoot }) -> string
skillScriptDirectory(skill, payloadRoot) -> string

// lib/reference-policy.js
createReferencePolicy({ paths, inventory }) -> { wrapperPath, phaseManifest,
  guardScript, skillDirectory, skillFile, commandFile, agentMirror,
  scriptDirectory, classify, resolveReference, resolveScriptPath, conventionsText }

// lib/intake.js
createIntake({ paths, adapter, inventory }) -> { skill(entry), agentRole(entry),
  command(entry) } // each returns a prepared definition + lint warnings

// lib/registration.js
createRegistrationReport() -> { warnings, failures, warn(), fail(), snapshot() }
hostCapabilities(ctx) -> { skills, commands, tools, toolGuard, systemPrompt, missing }
own(ctx, factory, label?) -> disposer
registerSurface({ ctx, report, logger?, warnings?, entries, failLabel, effectLabel,
  prepare, register }) -> { registered, report }

// lib/model-profile.js
DEEPSEEK_FLASH, MODEL_PROFILE_LABEL
deepseekGuidance({ webSearch? }) -> string
deepseekAnnouncement({ webSearch? }) -> string

// lib/payload-contract.js
PAYLOAD_SNAPSHOT, PAYLOAD_CONTRACT, RUNTIME_REQUIREMENTS, SKILL_NAMES,
exclusionReason(), parseRequirementLines(), formatBytes()
```

Ownership consequences:

- `inventory` owns the surface lists; `skills/agents/commands/status/announce/adapt`
  re-export or consume it. Adding a skill/agent role/command touches one declaration
  (role mirrors are derived by byte equality).
- `intake` owns read → parse → validate → adapt → lint; the three registrars only
  register prepared definitions and record warnings.
- `registration` owns the warning/failure collector; `ars_status` reads that report
  instead of re-linting every registered skill.
- `reference-policy` owns path conventions; the payload builder keeps its own
  resolution walk but `test/inventory.test.mjs` checks runtime/build agreement for
  every skill-local reference.
- `python-contract` owns interpreter policy; `env`, the generated wrapper, and
  `ars_script` consume it.
- `payload-contract` owns the snapshot pins/include rules; builder, checker,
  verify-install, payload tests, and `ars_status` report against it.
