# Academic Research Skills for DeepSeek Harness

[![CI](https://github.com/guoqinchen/academic-research-skills-dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/guoqinchen/academic-research-skills-dsh/actions/workflows/ci.yml)
[![Upstream check](https://github.com/guoqinchen/academic-research-skills-dsh/actions/workflows/upstream-check.yml/badge.svg)](https://github.com/guoqinchen/academic-research-skills-dsh/actions/workflows/upstream-check.yml)

A complete DeepSeek Harness (DSH) port of
[`academic-research-skills`](https://github.com/Imbad0202/academic-research-skills):
contract-audited academic research, paper writing, simulated peer review,
systematic-review screening, and an end-to-end research → write → review →
revise → finalize pipeline.

The upstream repository content is shipped in [`payload/`](payload/): 1,199 included
files copied byte-for-byte from the pinned commit. Four full-page third-party
web-page mirrors (IEEE, Springer Nature, ICMJE, and one CC BY article) are
deliberately **not** distributed because their rights holders' terms are not
covered by the upstream CC-BY-NC grant; the manifest that records their URLs,
Wayback IDs, and SHA-256 is kept.
Everything outside `payload/` is the DSH adapter: skill/command registration,
DeepSeek Harness tool and path adaptation, deterministic Python tooling, and the
write-scope guard.

## Runtime and search defaults

- **Model:** DeepSeek Flash through DeepSeek Harness. No Claude model, Claude
  CLI, or Claude API is required at runtime; upstream `sonnet`/`opus` labels are
  treated as quality tiers and rewritten to `deepseek-flash`.
- **Context:** DeepSeek Flash's 1,048,576-token context is used directly: the
  adapter tells the model to load complete references, keep one evidence ledger,
  and parallelize independent work with `subagent`/`workflow` instead of
  serializing it.
- **Tools:** deterministic ARS gates run through `ars_script`; the model is told
  to prefer scripts over model adjudication where a script can decide.
- **Images:** DeepSeek Flash accepts image input; figure/table/scan checks use
  `read_image`.
- **Web search:** the default source-discovery path is DeepSeek native
  `web_search` (provider `deepseek-official`), batched 1–4 queries per call.
  `web_fetch` handles known URLs. No Claude web tool is needed.

## What the port exposes

| Surface | Count | Names |
|---|---|---|
| Skills | 5 | `deep-research`, `academic-paper`, `academic-paper-reviewer`, `academic-pipeline`, `sr-screener` |
| Agent-role skills | 4 | `ars-agent-synthesis`, `ars-agent-research-architect`, `ars-agent-report-compiler`, `ars-agent-screening-reviewer` |
| Slash commands | 16 | `/ars-full`, `/ars-plan`, `/ars-outline`, `/ars-revision`, `/ars-revision-coach`, `/ars-rebuttal-audit`, `/ars-abstract`, `/ars-lit-review`, `/ars-3w`, `/ars-reviewer`, `/ars-format-convert`, `/ars-citation-check`, `/ars-disclosure`, `/ars-mark-read`, `/ars-unmark-read`, `/ars-cache-invalidate` |
| Tools | 3 | `ars_status`, `ars_script`, `ars_env_setup` |
| Hook layers | 2 | Session-start announce section; write-scope guard (infrastructure protection; the upstream phase fence is reported `unavailable` because DSH exposes no agent type) |
| Modes | 35 | Defined by the upstream skills; see `payload/MODE_REGISTRY.md` |
| Agent role files | 47 | 4 plugin-exposed agent-role skills + 43 inline role prompts read from the skill directories |

The port is faithful: the upstream instructions, mode protocols, templates,
references, quality gates, Material Passport, citation verification scripts, and
SR screening scripts are all included and reachable.

## Install

**Requirements:** DSH `>= 0.2.1-rc.3` (Node ships with DSH), Python
`>= 3.11` on `PATH`, and network access for the first `ars_env_setup`
(PyPI). Supported platforms: **macOS and Linux**; Windows is not supported yet
because the interpreter wrapper is POSIX `sh`.

1. Open the **Plugins** page in the DSH sidebar.
2. Choose **Add plugin** and enter the absolute path to this checkout
   (a Git URL or a tarball also works).
3. Install, then click **Enable now**. Closing the dialog leaves the plugin
   installed but disabled.
4. In a session, call `ars_env_setup` once (or ask the model to), then confirm
   with `ars_status` that `python.ready` is `true`.

The bundle patch inserts one Host row (`academic-research-skills`) that
registers everything. The row is enabled by default; disable it to switch the
whole feature off.

Creator-mode agents can also run
`plugin_manager install_bundle target=<absolute path>`; the default presets
disable that tool, so the Plugins page is the normal path. The package has
**no npm dependencies** and is a plain ESM host bundle.

## Use

### Slash commands

Type `/ars-plan`, `/ars-full`, `/ars-citation-check`, etc. in the composer.
A command submits the adapted upstream command prompt as one user message, so
the next model step runs the workflow. Command output stays in the command plane
and does not enter model requests.

### Skills

Ask naturally, or invoke a skill by name. The model loads the skill body with
the `skill` tool. The skill's `resourceBase` is its payload directory, and its
compatibility prelude tells the model which relative prefixes resolve to the
skill directory versus the payload root.

### Agent roles

The four upstream plugin-exposed agents are model-invocable agent-role skills.
The model loads one and passes its instructions to the `subagent` tool when a
separate agent is wanted. The other 43 role files are read inline by the skill
workflows, exactly as upstream.

### Tools

- `ars_status` — plugin/payload provenance, counts, Python readiness, guard
  config, and runtime verification of every registered `/ars-*` command.
- `ars_script` — run one upstream Python or shell script under the payload root
  with the managed interpreter, argument array (no shell), timeout, and bounded
  output. Use it for deterministic gates such as citation verification, pipeline
  integrity checks, revision patches, and SR screening builds.
- `ars_env_setup` — create/refresh the managed virtualenv and install
  `requirements-runtime.txt`. Requires network access to PyPI.

## Python environment

The deterministic upstream scripts need Python packages that are not part of the
base system. The plugin never installs them silently:

1. Call the `ars_env_setup` tool (preferred), or ask the model to do so.
   It creates a virtualenv at `~/.cache/ars-dsh/venv` (configurable) and installs
   `requirements-runtime.txt`, preferring `uv` when available.
2. `ars_status` reports `ready`, the missing packages, and the interpreter in
   use.

The model is told to run ARS scripts through the plugin's `bin/ars-python`
wrapper, which resolves `ARS_DSH_VENV` → the runtime-state file (so a custom
`envDir` works from a model-issued shell too) → the default managed venv →
`python3`. `ars_script` uses that same wrapper, so tool and shell can never
disagree about the interpreter.

## Configuration

The plugin row accepts these fields in `cordis.patch.yml` (all optional):

| Field | Default | Meaning |
|---|---|---|
| `announce` | `true` | Add the short ARS availability section to the system prompt. |
| `commands` | `true` | Register the 16 `/ars-*` commands. |
| `tools` | `true` | Register `ars_status`, `ars_script`, `ars_env_setup`. |
| `guard` | `true` | Register the write-scope guard. |
| `guardInfra` | `true` | Protect plugin enforcement files from writes. |
| `pythonPath` | `null` | Base interpreter used to create the virtualenv or run scripts. |
| `cacheRoot` | `~/.cache/ars-dsh` | Parent directory for the virtualenv. |
| `envDir` | `<cacheRoot>/venv` | Managed virtualenv path. |
| `scriptTimeoutMs` | `120000` | Default timeout for `ars_script`. |
| `maxScriptOutputBytes` | `200000` | Per-stream output cap for `ars_script`. |
| `modelProfile` | `deepseek-flash` | Runtime profile label and prelude guidance target. |
| `webSearch` | `true` | Include the DeepSeek native `web_search` default in the prelude/announce text. |

## DeepSeek Harness compatibility layer

The adapter rewrites, at registration time only (payload files stay untouched):

- `${CLAUDE_PLUGIN_ROOT}` → the payload root;
- `academic-research-skills:<skill>` → the plain DSH skill name;
- Claude Code tool names → DSH tool names (`Read`→`read`, `Write`→`write`,
  `Edit`→`edit`, `Bash`→`bash`, `Grep`→`grep`, `Glob`→`glob`,
  `WebSearch`→`web_search`, `WebFetch`→`web_fetch`, `TodoWrite`→`todo_write`,
  `AskUserQuestion`→`ask_user_question`, `Task`→`subagent`);
- Python and shell script invocations → absolute payload paths through
  `bin/ars-python`;
- legacy model labels (`sonnet`/`opus`/`haiku`) → `deepseek-flash`; `Claude Code` → `DeepSeek Harness`; `.claude/...` runtime paths → the plugin layout;
- `$ARGUMENTS` in command bodies → the raw user input.

See [`docs/compat-report.md`](docs/compat-report.md) for the counted token
inventory and the residual-pattern audit.

## Write-scope guard

Upstream's `PreToolUse` hook is ported to a DSH `ctx.tools.guard`:

- **Infrastructure protection** applies to every caller and denies writes to the
  plugin's enforcement files (guard script, phase-scope manifest, agent
  definitions, hook/config files) anchored on the plugin root.
- **Phase fencing** keeps upstream `evaluate_decision`'s Bucket A logic for
  parity, but the registered guard never supplies an agent type: DSH tool
  executions have no `agent_type` field and the plugin keeps no role registry.
  `ars_status` reports `guard.phaseFence: "unavailable"` with the reason rather
  than implying a working fence. Normal sessions are unconstrained exactly like
  upstream's main session; infrastructure protection and schema-drift denial
  still apply to every caller.
- Schema-drift and workspace-escape denials match upstream behaviour.

## Verification

```sh
node --test test/*.test.mjs          # 214 tests, all pass
node tools/verify-install.mjs        # 46 PASS, 0 FAIL, 3 WARN, 1 SKIP*
node tools/check-payload.mjs         # 0 errors, 4 upstream-doc warnings
```

\* The SKIP is upstream-clone parity. Check out the pinned upstream commit as a
sibling `../repo` to run that check too (51 PASS / 0 SKIP); a bare clone still
reports 0 FAIL.

Verification (see [`docs/verification.md`](docs/verification.md) for the dated record):

- **214/214** tests pass across frontmatter, adaptation, inventory/reference policy,
  model profile, environment, guard, tools, registration, payload, and end-to-end suites.
- **`verify-install`**: 46 PASS / 0 FAIL / 3 WARN / 1 SKIP — package manifest,
  locales, icon, registration surfaces, raw JSON Schemas validated by the
  installed DSH validator, command dispatch message shape, guard parity **29/29**
  decisions and advisory flags against the upstream Python guard, payload
  provenance and digests, byte- and mode-identical included payload (1,199 files),
  and import hygiene. Four third-party page mirrors are excluded from the
  distribution (see [`NOTICE.md`](NOTICE.md)).
- **Live installed plugin**: all 5 skills, 4 agent-role skills, and 16 `/ars-*`
  commands report `registered: true` through `ars_status`; the skill catalog
  shows the same names; a subagent loaded `ars-agent-synthesis` and read both
  skill-relative and payload-root-relative references; real deterministic gates
  (`check_acronyms.py`, `check_pipeline_integrity.py`) ran through `ars_script`
  with the managed Python 3.12 venv; the write-scope guard denied a live write
  to `cordis.patch.yml`; and the plain `agent.followup` message shape used by
  command dispatch was delivered as real user turns.
- **Payload immutability**: `PYTHONDONTWRITEBYTECODE=1` is set in both
  `lib/env.js` and `bin/ars-python`, so running the Python gates cannot create
  `__pycache__` inside the read-only payload. If the payload is ever mutated,
  `node tools/check-payload.mjs` fails against the pinned digests and
  `node tools/build-payload.mjs` restores the committed snapshot.

The `/ars-*` composer interaction itself is a host/UI path and was not typed
into the Web composer during verification; the handler code and the live
follow-up message delivery were verified separately.

## Upgrading the upstream payload

The payload is pinned; upgrades are deliberate and read-only until you rebuild.
Check a target checkout or ref first:

```sh
node tools/check-upstream.mjs --upstream ../repo
node tools/check-upstream.mjs --ref <branch-or-commit> --json
```

A scheduled `Upstream check` workflow runs weekly and files an `upstream-drift`
issue when the pinned payload no longer matches upstream.

Exit codes are `0` clean, `1` drift, `2` error. `--print-snapshot` prints the
`PAYLOAD_SNAPSHOT` / `BY_TOP_LEVEL` values needed before rebuilding. See
[`UPGRADING.md`](UPGRADING.md) for the full procedure (identity, pins,
distribution exclusions, rebuild, gates, release).

## Known limitations

- **Command UI execution**: `/ars-*` handlers are unit-tested with a fake
  invocation, and their registration is verified at runtime through
  `ars_status`; the plugin does not drive the Web composer itself.
- **Guard phase fence**: unavailable by design. DSH does not expose an
  `agent_type` on tool executions; `ars_status` reports the mode and reason
  instead of pretending the fence is active.
- **Update checker**: upstream's `/plugin update` reminder is not ported; the
  pinned payload is upgraded with `tools/check-upstream.mjs` and a rebuild (see
  [`UPGRADING.md`](UPGRADING.md)), not in place.
- **Claude Code hooks file**: `payload/hooks/hooks.json` is kept for provenance
  but not executed; its two behaviors are replaced by the announce section and
  the tool guard.
- **Non-commercial license**: CC-BY-NC-4.0 applies to the whole package.

## Layout

```text
index.js                 plugin entry (wiring only)
lib/paths.js             payload path resolution
lib/config.js            row config normalization
lib/frontmatter.js       dependency-free frontmatter parser
lib/adapt.js             DSH compatibility transformations
lib/skills.js            5 skill registrations
lib/agents.js            4 agent-role skill registrations
lib/commands.js          16 /ars-* command registrations
lib/announce.js          system-prompt section
lib/env.js               managed Python virtualenv
lib/python-contract.js   interpreter/venv/wrapper contract
lib/payload-contract.js  one payload snapshot contract
lib/inventory.js         one ARS surface inventory (skills/commands/agents)
lib/intake.js            one document intake pipeline
lib/registration.js      registration report + effect ownership
lib/reference-rules.js   pure reference conventions
lib/reference-policy.js  reference policy bound to payload + inventory
lib/model-profile.js     DeepSeek Flash + web-search guidance
lib/tools.js             ars_status / ars_script / ars_env_setup
lib/status.js            status assembly
lib/guard.js             write-scope guard port
bin/ars-python           interpreter wrapper
payload/                 1,199 included upstream files, byte-for-byte
                         (4 third-party page mirrors withheld; see NOTICE.md)
tools/build-payload.mjs  deterministic payload builder
tools/check-payload.mjs  payload integrity checker
tools/build-python-wrapper.mjs  wrapper generator/checker
tools/check-upstream.mjs upstream payload diff checker
test/                    node:test suites

UPGRADING.md             upgrade procedure
ASSET-LICENSES.md        PDF/font asset inventory
CITATION.cff             citation metadata
```

## Provenance and license

Upstream: https://github.com/Imbad0202/academic-research-skills
(commit `1ec249df98728682dfbbdfb940a658338bfd6f80`, version `3.23.2`),
by Cheng-I Wu, CC-BY-NC-4.0. The DSH adapter is copyright (c) 2026 Guoqin Chen.
See [`NOTICE.md`](NOTICE.md), [`LICENSE`](LICENSE), and [`CITATION.cff`](CITATION.cff),
plus `payload/PROVENANCE.json`.

GitHub's license detector reports `NOASSERTION` for CC-BY-NC-4.0; the SPDX
identifier is declared in [`package.json`](package.json) and [`NOTICE.md`](NOTICE.md).
PDF/font asset coverage is listed in [`ASSET-LICENSES.md`](ASSET-LICENSES.md).
