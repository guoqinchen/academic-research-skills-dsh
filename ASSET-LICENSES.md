# Asset license inventory

This inventory covers the non-text assets that ship inside `payload/`. The
upstream license (CC-BY-NC-4.0) applies to the payload as a whole, and `NOTICE.md`
records the upstream and adapter copyright holders. This file exists so a
redistributor can see what is embedded and which rights need a separate check.

## PDFs (16)

### Showcase examples (12, under `payload/examples/showcase/`)

- `full_paper_apa7.pdf`
- `full_paper_zh_apa7.pdf`
- `integrity_report_stage2.5.pdf`
- `integrity_report_stage4.5.pdf`
- `integrity_reverification_stage2.5.pdf`
- `paper_creation_process_en.pdf`
- `paper_creation_process_zh.pdf`
- `post_publication_audit_2026-03-09.pdf`
- `response_to_reviewers_r2.pdf`
- `stage3_review_report.pdf`
- `stage3_review_report_r2.pdf`
- `stage3prime_rereview_report.pdf`

These are upstream-generated examples. They contain **no raster images**; the
text is set in embedded font subsets.

### Folder-scan fixtures (4, zero bytes)

`payload/scripts/adapters/examples/folder_scan/input_fixture/` contains four
empty placeholder PDFs (`Chen2024_AIAssessment.pdf`,
`Wang_2023_formative_feedback.pdf`, `paper1.pdf`, `中文檔名_2024.pdf`). They exist
only to exercise the folder scanner and carry no content.

## Embedded fonts

`pdffonts` reports these subsets across the 12 showcase PDFs; no standalone font
files are distributed:

- Times New Roman (Regular, Bold, Italic, Bold Italic)
- PingFang HK (Regular, Semibold)
- STSong
- Source Han Serif TC (ExtraLight; SIL Open Font License family)
- Latin Modern Mono 10
- Courier New

Font **embedding** in the shipped PDFs is covered by the upstream distribution;
extracting and reusing a font subset may require the font's own license (for
example, the SIL Open Font License for Source Han Serif). No font license text is
shipped separately.

## Images and other binaries

- No standalone image files ship in `payload/`.
- The four full-page HTML mirrors captured for design research are **not**
  distributed; see the "Withheld third-party page mirrors" section in
  `NOTICE.md`. Their `manifest.yaml` (URLs, Wayback IDs, SHA-256) remains.
- `payload/THIRD_PARTY.md` lists third-party *projects*, not licensed assets.

## Scope

This inventory is a map, not a legal opinion. If you redistribute the package or
extract an embedded font, verify the relevant font and page licenses yourself.
