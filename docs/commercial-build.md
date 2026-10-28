# Commercial build (archived / optional)

> **Archived / optional (2026-10-28).** The project is source-public and
> non-commercial. This is **not an offered commercial path**; it is retained only
> as a technical utility for downstream users who independently obtain the
> necessary permissions. It does not grant a licence. CC-BY-NC-4.0 is not OSI
> open source.

The default checkout is a faithful, byte-identical port of the upstream payload
and is distributed under **CC BY-NC 4.0** (non-commercial). A commercial release
needs a separate artifact and a separate licence. `tools/build-commercial.mjs`
produces that artifact on a copy; it never modifies this checkout.

## What it does

1. Copies the plugin to `--out` (default `dist/commercial`).
2. Patches `payload/scripts/verification_gate/__init__.py` so Semantic Scholar
   is skipped when `ARS_COMMERCIAL_MODE=1` (the S2 API licence is
   non-commercial).
3. Replaces the condensed **COREQ** and **STROBE** checklists in
   `equator_reporting_guidelines.md` with citation + official-link pointers.
4. Paraphrases/shortens the **IEEE** policy quotations to a configurable budget
   (default 50 words; the source currently has 100) and adds licence notes for
   PRISMA, PRISMA-P, CONSORT, SQUIRE, and PaperOrchestra.
5. Recomputes the payload digests, `PROVENANCE.json`, `REFERENCE-INDEX.json`, and
   the pinned `lib/payload-contract.js` constants.
6. Marks the copy `private: true` with a `-commercial.1` version suffix, writes
   `COMMERCIAL-BUILD.md`, and runs `tools/check-payload.mjs`.

## Usage

```sh
node tools/build-commercial.mjs --out ../ars-commercial --strict
```

`--strict` fails if the IEEE quote budget is exceeded. Without it, the script
still builds but tells you the artifact is not releasable.

Options:

| Option | Default | Meaning |
|---|---|---|
| `--out <dir>` | `dist/commercial` | Output directory. |
| `--force` | off | Replace an existing output directory. |
| `--strict` | off | Fail when the IEEE quote budget is exceeded. |
| `--keep-ieee-quotes` | off | Do not paraphrase IEEE quotations; use only with permission. |
| `--ieee-budget <n>` | `50` | Maximum unique quoted words in the IEEE sections. |

## What it does not do

- It does **not** grant a commercial licence from the upstream author. Obtain
  that separately (CC BY-NC 4.0 Section 6(c) permits a separate agreement).
- It does **not** grant COREQ/STROBE permission. The script removes the
  condensed derivatives; if you obtain permission, restore the original
  sections from the non-commercial checkout.
- It does **not** replace PingFang HK in the showcase PDFs. Replace it with an
  OFL font and re-render the affected PDFs before release.
- It does **not** clear the licence field. The copy is `private: true`; replace
  `LICENSE` with the negotiated commercial terms after the permissions are in
  place.

## Verify

```sh
cd ../ars-commercial
node tools/check-payload.mjs
node --test test/*.test.mjs
node tools/verify-install.mjs
```

The 2026-10-27 dry run on a temp copy produced 228 tests (226 pass, 0 fail,
2 skipped), `check-payload` 0 errors / 4 warnings, `verify-install` 44 PASS /
0 FAIL / 4 WARN / 2 SKIP, and an IEEE quote budget of 42 words.

## Boundaries

This guide and the build script are engineering controls, not legal advice. The
commercial release is cleared only when the upstream author, and any third-party
rights holders whose material remains in the artifact, have granted the
necessary permissions.
