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

### Non-affiliation

This is an unofficial port. It is not affiliated with, sponsored by, or endorsed
by Cheng-I Wu or the upstream project. No patent or trademark license is
granted; the upstream name is used descriptively to identify the source.

### Commercial use

The package is licensed under CC-BY-NC-4.0. Project policy (2026-10-28):
non-commercial only. The adapter author does not offer or pursue a commercial
license, and this project does not grant one. Commercial use requires permission
from the upstream author; contact the upstream repository independently
(https://github.com/Imbad0202/academic-research-skills). CC-BY-NC-4.0 is not
OSI open source.

The package is provided **as-is**, without warranty of any kind; see Section 5
of `LICENSE`.

### Third-party content in the payload

The payload also contains condensed reporting-guideline checklists and short
attributed policy quotations whose rights are separate from the upstream
CC-BY-NC-4.0 grant. `docs/third-party-audit.md` records each item, its licence,
and the action required for commercial distribution. In particular, the COREQ
and STROBE checklists have no documented licence permitting redistribution
without permission, and the Semantic Scholar API used by the default citation
gate is licensed for non-commercial research/education only.

The optional commercial-build helper is retained as an archived technical utility for downstream users with independent permissions. It is not an offered commercial path and does not grant any permission.

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
