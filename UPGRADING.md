# Upgrading the bundled upstream payload

The plugin ships a pinned, byte-preserving snapshot of
[academic-research-skills](https://github.com/Imbad0202/academic-research-skills).
Upgrades are deliberate: fetch one upstream ref, inspect the diff, update the
pins, rebuild, and re-run the gates.

Current pin: commit `1ec249df98728682dfbbdfb940a658338bfd6f80`, plugin `3.23.2`,
CC-BY-NC-4.0 (see `lib/payload-contract.js`).

## 0. Prerequisites

- Node.js 24 and a git checkout of the upstream repository (a full checkout is
  needed; the builder reads `.git/HEAD`).
- The plugin's own tests pass before you start: `npm test`.

## 1. Pick the target ref and review it

Read the upstream `CHANGELOG.md` and the commits between the current pin and
the target. Pay attention to renamed skills/commands, frontmatter changes, and
new third-party assets.

## 2. Check the diff (read-only)

```sh
# existing checkout
node tools/check-upstream.mjs --upstream ../repo

# or let it fetch a tag/commit into a temp checkout
node tools/check-upstream.mjs --ref <branch-or-commit>
```

Exit codes: `0` clean, `1` drift, `2` error. `--json` gives a machine-readable
report. The report lists added/removed/changed files, contract drift, and the
registered documents (`*/SKILL.md`, `commands/*.md`, `agents/*.md`) that need
adapter review.

A scheduled workflow
([`.github/workflows/upstream-check.yml`](https://github.com/guoqinchen/academic-research-skills-dsh/blob/main/.github/workflows/upstream-check.yml))
runs every Monday: it tracks upstream `main` by default (override with a `ref`
input), runs this check, and files or updates an `upstream-drift` issue when
the payload differs, and closes that issue when it is clean again. Run it manually with a specific ref from the
Actions tab (or `gh workflow run upstream-check.yml -f ref=<ref>`).

For a real bump, print the pins the new upstream requires:

```sh
node tools/check-upstream.mjs --upstream ../repo --print-snapshot
```

## 3. Update the upstream identity

In `lib/payload-contract.js`, update `UPSTREAM`:

- `commit`, `commitDate`, `pluginVersion`, `license`
- keep `checkout: '../repo'` unless you use a different local convention

## 4. Update the payload pins

Before rebuilding, copy the `PAYLOAD_SNAPSHOT` and `BY_TOP_LEVEL` values from
`--print-snapshot` into `lib/payload-contract.js`. The builder refuses to write
a payload that does not match these pins.

Also review `DISTRIBUTION_EXCLUDED_FILES`: if the new upstream adds full-page
mirrors of third-party pages whose rights are not covered by the upstream
license, add them there (the builder records each exclusion in
`PROVENANCE.json`).

## 5. Rebuild the payload

```sh
ARS_UPSTREAM_ROOT=/path/to/upstream node tools/build-payload.mjs
```

This rewrites `payload/`, `PROVENANCE.json`, and `REFERENCE-INDEX.json`
deterministically. Review the builder report (file counts, per-top-level
digests, reference summary).

Then update the `REFERENCE_INDEX` pin in `lib/payload-contract.js` from the
generated `payload/REFERENCE-INDEX.json` `summary` object.

## 6. Run the gates

```sh
node tools/check-payload.mjs          # must be 0 errors
npm test                              # all suites, including parser/adaptation
ARS_UPSTREAM_ROOT=/path/to/upstream node tools/verify-install.mjs
```

If the new upstream changes frontmatter shapes, add cases to
`test/frontmatter.test.mjs`. If it changes skill/command/agent prose, review
`test/adapt.test.mjs` failures and update the expected transformation.

## 7. Update the release surface

- README counts (payload files/bytes, tests, verification numbers)
- `docs/verification.md` status block
- `CITATION.cff` and `package.json` versions
- `ASSET-LICENSES.md` if the PDF/font inventory changed

Commit the bump as its own change, tag a patch/minor release, and let CI run.

## Rollback

The payload is committed: `git revert` the bump commit, or restore
`payload/`, `PROVENANCE.json`, and `REFERENCE-INDEX.json` from the previous
release and re-run `node tools/check-payload.mjs`.
