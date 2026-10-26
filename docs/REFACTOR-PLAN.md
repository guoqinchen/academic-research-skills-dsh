# Refactor plan — architecture review 2026-10-26

> **Historical record (v1.0.0 baseline).** This plan was completed before the
> 1.0.1–1.0.3 fixes. Current numbers: 214 tests; payload 1,199 files /
> 24,118,122 bytes. Keep this file as history; README and `UPGRADING.md` describe
> the current state.

Status: **complete** (2026-10-26). Baseline copy: `<temp-baseline>` (payload excluded; PROVENANCE copied).

## Hard constraints

- `payload/` is byte-immutable: 1,203 files / 24,815,025 B, pinned by `PROVENANCE.json`.
- No npm dependencies and no `@deepseek-ai/*` imports.
- Installed-row guard protects `index.js`, `lib/**`, `bin/**`, `cordis.patch.yml`, `package.json`; the row is removed while refactoring and reinstalled at the end.
- DSH raw JSON Schema only; schemas hand-written.
- Every candidate ends green: `node --test test/*.test.mjs`, `node tools/check-payload.mjs`, `node tools/verify-install.mjs`.
- No Claude model, Claude CLI, or Claude API is required at runtime.
- DeepSeek Flash is the target model; DeepSeek native `web_search` is the default search path.

## Candidate order and owners

1. **Inventory owner** (Lead) — `lib/inventory.js`; skills/commands/agent roles derived/centralized; consumers no longer carry copies.
2. **Intake + registration collector** (Lead) — `lib/intake.js`, `lib/registration.js`; three document adapters, one warning/failure collector, index owns flags/host negotiation.
3. **Test host adapter** (Lead, after 1–2) — `test/support/host.mjs`; six host builders collapse to one, payload fixtures stay per-suite.
4. **Python interpreter contract** (teammate python-guard) — `lib/python-contract.js`, `lib/env.js`, `bin/ars-python`, generated wrapper check; state file makes custom `envDir` work for model-issued wrapper; `ars_script` uses the wrapper.
5. **Guard phase-fence seam** (teammate python-guard) — remove hypothetical `roles`/`resolveAgentType`/`setAgentRole`; expose honest `phaseFence` status/reason; keep evaluator parity.
6. **Payload contract** (teammate payload-contract) — `lib/payload-contract.js`; builder/checker/verify-install/payload tests consume one pin set; export and reuse `checkPayload`; fix circular requirements check.
7. **Reference policy** (Lead) — `lib/reference-rules.js` + `lib/reference-policy.js`; paths owns every read path; adapt/agents/guard/status/build share conventions.

## Cross-cutting requirements

- **No Claude runtime dependency**: adapt `sonnet`/`opus`/`haiku`, `Claude Code`, `.claude/...` runtime prose; ignore `model:` frontmatter; lint for residuals; document no Claude model/CLI/API needed.
- **DeepSeek Flash optimization**: `lib/model-profile.js` guidance in every skill/command/agent prelude and the announce section: 1,048,576-token context, text+image input, reasoning effort, native tool use, parallel subagents, deterministic scripts, batching web searches.
- **DeepSeek web search default**: `web_search` is the default source-discovery tool (DeepSeek native provider), `web_fetch` for known URLs; batch 1–4 queries; announce/status expose the default.
- Config: `modelProfile: "deepseek-flash"`, `webSearch: true` (documented; no dependency on a Claude model selector).

## Verification

Per candidate: run the full suite and fix regressions immediately. Final: reinstall bundle, run `ars_status`, load a skill in a subagent, execute `ars_script`, confirm zero Claude/legacy model tokens in adapted docs, confirm DeepSeek search guidance, update README/compat/verification docs.


## Outcome (2026-10-26)

All seven candidates are implemented:

1. `lib/inventory.js` is the one surface owner; skills/commands/agent roles are derived, agent mirrors by byte equality.
2. `lib/intake.js` + `lib/registration.js` own intake and one warning/failure collector; `index.js` owns host negotiation.
3. `test/support/host.mjs` is the one fake Host contract for six suites and `tools/verify-install.mjs`.
4. `lib/python-contract.js` owns interpreter policy; `bin/ars-python` is generated; `ars_script` uses the wrapper; a runtime-state file makes a custom `envDir` work from a model-issued shell.
5. The dormant guard role seam is removed; `PhaseFence` is reported as `unavailable` with a reason, while `evaluateDecision` keeps upstream parity.
6. `lib/payload-contract.js` owns pins/include rules; builder/checker/verify-install/payload tests/`ars_status` consume it; `verify-install` reuses the exported checker.
7. `lib/reference-rules.js` + `lib/reference-policy.js` own conventions; `REFERENCE-INDEX` agreement is tested.

DeepSeek requirements:

- No Claude model, CLI, or API is required at runtime. Adapted documents contain zero Claude/model-alias tokens; legacy labels map to `deepseek-flash`.
- `lib/model-profile.js` injects DeepSeek Flash guidance (1,048,576-token context, text+image, parallel subagents, deterministic scripts, native tools) into every document prelude and the announce section.
- `web_search` (DeepSeek native, `deepseek-official`) is the default search path, batched 1–4 queries; `ars_status` reports it and the live session resolves it (`toolAvailable: true`).

Final gates: 196/196 tests; `verify-install` 51 PASS / 0 FAIL / 3 WARN; `check-payload` 0 errors / 4 warnings; `build-python-wrapper --check` up to date; live `ars_status` 5+4+16 registered, payload contract matches, Python ready, web search available.
