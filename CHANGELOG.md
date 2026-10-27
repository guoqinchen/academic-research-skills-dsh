# Changelog

All notable changes to the DeepSeek Harness adapter. The bundled upstream
payload has its own version (`payload/PROVENANCE.json`, upstream `3.23.2`) and
is not re-versioned by these entries.

## 2.0.0 — 2026-10-27

Breaking release from the 2026-10-27 code review (`docs/code-review-2026-10-27.md`).
The upstream payload is unchanged (commit `1ec249d`, plugin `3.23.2`).

### Breaking

- **`ars_status` output:** `payload.contract.matches` is renamed to
  `payload.contract.countsMatch`. The field only ever compared file count and
  byte count, never content integrity; the old name implied more than it did.
  Consumers parsing the old key must switch.
- **Write-scope guard scope:** `ars_script` is now inspected. A phase-scoped
  (Bucket A) agent may not run payload scripts at all, and any caller is denied
  when a declared output (`--out`, `--out-dir`, `--output`, `--output-dir`,
  `--dest`, `--destination`, `--target`, `--dir`, `-o`) resolves into the
  plugin's enforcement files. Scripts can still write wherever their positional
  arguments point and can still reach the network: this is infrastructure
  protection, not a sandbox.

### Added

- `ars_script` honours `config.pythonPath` when no managed virtualenv exists, so
  the tool, `ars_status`, and a model-issued `bash bin/ars-python` agree on the
  interpreter.
- Runtime-state file is keyed by plugin root
  (`<pluginRoot>\t<envDir>\t<python>`), so two profiles with different
  `envDir`/`pythonPath` no longer overwrite each other. Legacy single-line state
  files are ignored and degrade to the default venv.
- Stale env-setup locks are reclaimed: a lock whose owner process is gone, or
  which is older than 10 minutes, is stolen instead of blocking
  `ars_env_setup` for the full timeout.
- `test/support/host.mjs` models `ctx.tools.get`, so `ars_status.webSearch`
  availability is exercised.

### Fixed

- `ars_status.webSearch.toolAvailable` awaited the host registry (the previous
  expression was synchronous by accident of the implementation, and the field
  was never true in tests).
- `scriptTimeoutMs` and `maxScriptOutputBytes` are clamped
  (`1..2147483647`, `4096..8388608`); an oversized timeout previously made every
  script time out after 1 ms.
- `tools/check-payload.mjs` derives its forbidden home-directory marker from
  `os.homedir()` instead of a hard-coded author path.
- `tools/publish-github-package.mjs` writes its token-bearing `.npmrc` with mode
  `0600` and removes the temp directory on signals.

### Changed

- Command and skill ordering is bytewise everywhere (`compareNames`), so
  registration and report order no longer depend on the host locale.
- The three document registrars share one loop (`registerSurface`); lint
  ownership stays in `lib/intake.js`.
- Payload conventions, drift rules, and formatting helpers have one owner
  (`lib/reference-rules.js`, `lib/payload-contract.js`); the builder imports the
  runtime prefix constants and the payload walkers are merged.
- Adapted prose rewrites only Claude product names, so a person named Claude is
  preserved instead of being rewritten.
- `README` no longer carries pass/fail counts; `docs/verification.md` is the
  dated record. CI runs `verify-install` and archives its output in the job
  summary.

### Security / supply chain

- GitHub Actions are pinned to commit SHAs; the `upstream-check` workflow passes
  its `ref` input through the environment and validates it instead of
  interpolating `${{ }}` into shell scripts.
- CI installs the real DSH schema validator at the desktop runtime's own version
  (`@deepseek-ai/dsh-tools@0.2.1-rc.3`) and sets `ARS_REQUIRE_DSH_TOOLS=1`, so a
  missing validator fails instead of skipping.

### Verification

`docs/verification.md` §0 records the run: 224 tests (222 pass, 2 skipped
locally), `verify-install` 44 PASS / 0 FAIL / 4 WARN / 2 SKIP, `check-payload`
0 errors / 4 upstream-doc warnings, and e2e 17/17 with the real validator.

## 1.0.5 — 2026-10-26

Initial public release on npm: 5 skills, 4 agent-role skills, 16 `/ars-*`
commands, 3 tools, the write-scope guard, and the pinned upstream payload
(1,199 files). See the git history and `docs/verification.md` for that baseline.
