# NOTICE — Academic Research Skills for DeepSeek Harness

Copyright (c) 2026 Guoqin Chen (DeepSeek Harness adapter).
The vendored upstream content is copyright (c) 2026 Cheng-I Wu.

This package is a port of **Academic Research Skills** (`academic-research-skills`)
by Cheng-I Wu:

- Upstream: https://github.com/Imbad0202/academic-research-skills
- Upstream commit ported: `1ec249df98728682dfbbdfb940a658338bfd6f80`
- Upstream plugin version: `3.23.2`
- Upstream license: Creative Commons Attribution-NonCommercial 4.0 International
  (CC-BY-NC-4.0). The upstream text is reproduced in `payload/LICENSE`; the
  root `LICENSE` contains the same terms with both copyright holders.

The `payload/` directory contains 1,199 upstream files copied byte-for-byte
from the pinned commit; they are not modified. It is not a complete repository
mirror: 1,663 upstream files are excluded (the top-level entries and the four
withheld mirrors are recorded in `payload/PROVENANCE.json`). Attribution,
license terms, and the upstream notices apply to the included files.

### Withheld third-party page mirrors

Four full-page HTML mirrors captured for design research are **not distributed**:
`docs/design/snapshots/2026-05-13-ai-disclosure-discovery/{icmje,ieee,nature,prisma-trAIce}.html`.
The rights holders (International Committee of Medical Journal Editors, IEEE,
Springer Nature) reserve all rights, and the fourth page is CC BY 4.0 content
whose attribution notice is not part of this package. The upstream CC-BY-NC-4.0
grant does not cover them, so they are excluded from the release rather than
sublicensed. `manifest.yaml` in the same directory keeps each page's live URL,
Wayback Machine ID, and SHA-256 so the snapshot remains auditable and can be
re-fetched by the reader. `payload/PROVENANCE.json` records the exclusion and
its reason.

The DeepSeek Harness adapter (everything outside `payload/`: `index.js`,
`lib/`, `bin/`, `tools/`, `locale/`, `README.md`, tests) is an original
derivative work by Guoqin Chen (https://github.com/guoqinchen), copyright
(c) 2026, and is distributed under the same CC-BY-NC-4.0 terms to match the
upstream license. It may not be used for commercial purposes without permission
from both authors (Cheng-I Wu for the upstream content; Guoqin Chen for the
adapter).

Porting changes are confined to registration-time text adaptation (paths,
DeepSeek Harness tool names, skill names, and interpreter invocation). The
upstream instructions, workflows, modes, agent roles, thresholds, and
deterministic scripts are preserved. See `docs/compat-report.md` for the exact
token inventory and rules.

PDF/font asset coverage is listed in `ASSET-LICENSES.md`.

If you redistribute this plugin, keep `LICENSE`, this `NOTICE.md`,
`ASSET-LICENSES.md`, the `payload/PROVENANCE.json` provenance record, and the
upstream notice files under `payload/` intact.
