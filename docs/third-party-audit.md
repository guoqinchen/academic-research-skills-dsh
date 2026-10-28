# Third-Party Content and API Terms Audit

**Scope**: the 1,199-file payload of `academic-research-skills-dsh` v2.0.0
(upstream commit `1ec249df98728682dfbbdfb940a658338bfd6f80`, plugin `3.23.2`):
16 PDFs, 4 HTML fixtures, 5 bibliographic API clients, the policy-quotation
references, and the reporting-guideline checklists.
**Date**: 2026-10-27
**Method**: file inventory; `pdffonts` / `pdfimages`; `pypdf` 6.21.2 inspection of
`/FontDescriptor` and the embedded TrueType `OS/2.fsType`; Markdown table quote
extraction; endpoint scan; the rights-holder terms pages cited below.
**Status**: this is a risk audit, not a legal opinion. Short quotations may be
covered by fair use / fair dealing even where no licence exists; the risk labels
below are engineering/compliance judgements, not infringement findings.

## 0. Executive summary

| Category | Finding | Non-commercial | Commercial | Required action |
|---|---|---|---|---|
| Fonts | 12 real PDFs embed font subsets; no standalone font files; no images; TrueType `fsType` is 0 or 8; CFF fonts carry no `fsType` | Low | Medium | Distribute complete PDFs only; never extract fonts; replace PingFang HK before a commercial release |
| Quotations | 4 full-page mirrors are excluded; 4 HTML fixtures are synthetic; 12 showcase PDFs are upstream-generated | Low | Low | Keep the four mirrors excluded |
| Policy quotes | 22 policy quotes (≤50 words each) in the design doc, 22 quoted cells in the policy anchor table, 5 venue quotes | Low–medium | High for IEEE; medium for ICMJE | Paraphrase or license the IEEE quotes; keep attribution and locators |
| Reporting guidelines | PRISMA, PRISMA-P, SQUIRE, CARE, STARD, TRIPOD+AI have clear licences; CONSORT has version-dependent terms; STROBE requires permission to re-publish; COREQ is OUP standard-publication content | Medium | **Blocked** by COREQ and STROBE | Obtain permission or replace the condensed COREQ/STROBE sections with pointers; pin the CONSORT source |
| APIs | arXiv, Crossref, OpenAlex, DOI, Handle are open for the metadata the gate uses; Semantic Scholar is non-commercial only; NCBI has attribution/rate conditions; OpenReview is optional and credential-gated | Low–medium | **Blocked** by Semantic Scholar | Disable Semantic Scholar or obtain an extended licence before any commercial release |

**Bottom line**: the CC BY-NC 4.0 grant from the upstream author does not cure
third-party rights. For non-commercial distribution the remaining exposure is
concentrated in COREQ/STROBE and the IEEE quotations. `tools/build-commercial.mjs`
produces the technical clearance (Semantic Scholar skipped, COREQ/STROBE
pointers, IEEE paraphrased to 42 words); the permissions, font replacement, and
legal review remain external.

### 0.1 中文摘要

| 类别 | 复核结果 | 非商业 | 商业 |
|---|---|---|---|
| 字体 | 12 个真实 PDF 全部为嵌入子集；无独立字体文件、无图片；TrueType `fsType` 为 0/8；PingFang/Latin Modern 为 CFF、无 `fsType` | 低 | 中：PingFang/Times/Courier 的提取或商用复用有风险；商业版建议替换 PingFang |
| 引文 | 4 个网页镜像已排除；4 个 HTML 为合成夹具；49 条政策引文均 ≤50 词；IEEE 93 词（81 唯一）约占短文 54% | 低–中 | 高：IEEE 引文需改写或取得许可 |
| 报告指南 | PRISMA/PRISMA-P/SQUIRE/CARE/STARD/TRIPOD+AI 有明确许可；CONSORT 版本歧义；STROBE 需许可；COREQ 为 OUP 标准出版内容 | 中 | 阻塞：COREQ、STROBE |
| API | arXiv/Crossref/OpenAlex/DOI/Handle 对元数据开放；S2 仅限非商业；NCBI 需 `tool`/`email` 与免责声明；OpenReview 可选；无 CNKI/Wanfang 抓取 | 低–中 | 阻塞：Semantic Scholar |

**四项商用阻塞**：Semantic Scholar 扩展许可或禁用；COREQ 许可或改为链接；STROBE 许可或改为链接；IEEE 引文改写或取得许可。`tools/build-commercial.mjs` 已在独立副本中自动处理这四项；仍需上游/第三方许可、PingFang 替换与法律审查。

## 1. Fonts

### 1.1 Inventory

- 16 PDFs: 12 real documents under `payload/examples/showcase/`, plus 4
  zero-byte placeholders under
  `payload/scripts/adapters/examples/folder_scan/input_fixture/`.
- No standalone font files (`.ttf`, `.otf`, `.ttc`, `.woff`, `.woff2`, `.eot`)
  anywhere in `payload/`.
- No raster or vector image files anywhere in `payload/`; `pdfimages -list`
  reports no images in the 12 real PDFs.
- Every real PDF embeds subset fonts. No PDF references an external font.

### 1.2 Embedded font permissions

| Font family | PDFs | Embedded as | `OS/2.fsType` | Embedding permission | Redistribution view |
|---|---|---|---|---|---|
| Times New Roman (Regular/Bold/Italic/BoldItalic) | 11 | TrueType (`FontFile2`) | `8` (editable embedding) | Allowed for document embedding | Complete PDF redistribution is the normal case; extracting the font is not licensed |
| Courier New | 4 | TrueType (`FontFile2`) | `8` (editable embedding) | Allowed for document embedding | Same as above |
| PingFang HK (Regular/Semibold) | 7 | CFF (`FontFile3`, CIDFontType0C) | absent | No PDF-level restriction encoded; Apple system-font licence governs | Complete PDF redistribution is common; extraction/reuse of the font is not permitted; commercial release should replace it with an OFL font |
| Source Han Serif TC ExtraLight | 3 | TrueType (`FontFile2`) | `0` (installable) | Allowed | SIL OFL 1.1; embedding and font redistribution are permitted with the OFL notice |
| STSong | 1 | TrueType (`FontFile2`) | `8` (editable embedding) | Allowed for document embedding | Complete PDF redistribution is the normal case; extracting the font is not licensed |
| Latin Modern Mono 10 | 3 | CFF (`FontFile3`, CIDFontType0C) | absent | GUST Font Licence governs | Document embedding is permitted; font-software redistribution follows the GFL |

The `fsType` values above were read from the embedded TrueType `OS/2` table, not
from the PDF `/FontDescriptor` (the descriptors omit `/FSType`). `fsType=8`
permits editable embedding; `fsType=0` is installable embedding; no font carries
`fsType=2` (restricted licence, embedding not allowed).

### 1.3 Risk and action

- **Non-commercial distribution**: low. The PDFs are complete documents with
  embedded subsets; no font file is distributed separately; no image is embedded.
- **Commercial distribution**: medium. PingFang HK (Apple) and the Monotype
  families (Times New Roman, Courier New) are the weak points if a recipient
  extracts or reuses the fonts. Replacing PingFang HK with Source Han Sans/Serif
  (OFL) and re-rendering the seven affected PDFs removes the ambiguity; the
  Monotype families have `fsType=8`, so complete-document redistribution is
  within the embedding bits.
- **Never** extract a font subset from the PDFs or ship it as a font file.

## 2. Quotations and third-party text

### 2.1 Page mirrors and HTML fixtures

- The four full-page mirrors captured for design research are **not** in the
  payload: `docs/design/snapshots/2026-05-13-ai-disclosure-discovery/{icmje,ieee,nature,prisma-trAIce}.html`.
  Only `manifest.yaml` (URLs, Wayback IDs, SHA-256) ships.
- The four remaining HTML files are synthetic transport fixtures: three error
  pages (111–183 bytes) and a 473-byte CNKI “multiple resolution” page whose
  comment says it is a synthetic reproduction and is deliberately not parsed.
  They carry no third-party article content.

### 2.2 Showcase PDFs

The 12 real PDFs are upstream-generated examples (sample paper, integrity
reports, review reports, response letter, process documents). The sample paper’s
author line is “Claude (Anthropic)”, confirming it is a generated artifact, not a
republished third-party paper. No images or third-party figures are embedded.
This category is low risk.

### 2.3 Policy quotations

The AI-disclosure design and policy-anchor files quote short passages from four
policy sources. Extraction of quoted table cells gives:

| Source | Quotes | Quoted words | Longest quote | Source length | Risk |
|---|---|---|---|---|---|
| PRISMA-trAIce (Holst et al. 2025) | 10 | 254 | 40 | Full article/checklist | Low: JMIR AI is CC BY 4.0; attribution required |
| IEEE author guidelines (2024-04-16) | 4 | 93 (81 unique) | 34 | Two substantive paragraphs, ~150 words | **High**: ~54% unique coverage (62% counting a repeated cell phrase) of the short normative text |
| ICMJE Recommendations §V.A | 4 | 73 | 26 | Two-paragraph section | Medium: short page, substantial fraction; ICMJE asks organisations not to reprint and to link instead |
| Nature Portfolio AI policy (snapshot 2026-05-13) | 4 | 84 | 28 | Longer policy page | Low–medium: small fraction, but the live page has changed since the snapshot |

All 49 quoted table cells (22 in the design doc, 22 in the anchor table, 5 in
the venue file) are ≤50 words, and each carries a locator (table/item or
paragraph) or a source URL/access date, and, for the anchor table, a snapshot ID
and truncated SHA-256. The design doc’s own rule is “≤50 words verbatim from
primary source”; the extraction confirms the rule is met.

**Action**:

- Keep the locators and snapshot IDs.
- Before a commercial release, paraphrase the IEEE quotations and reduce the
  ICMJE quotations to the minimum needed; or obtain permission from IEEE/ICMJE.
- Treat the Nature quotes as a historical snapshot; the live policy changed by
  2026-10-27. Do not present them as current policy without re-verification.
- PRISMA-trAIce quotes are covered by CC BY 4.0; keep the citation and licence
  notice.

### 2.4 Reporting-guideline checklists

`deep-research/references/equator_reporting_guidelines.md` contains condensed,
paraphrased checklists for nine guidelines. Only CARE, STARD, and TRIPOD+AI carry
an explicit licence note; PRISMA, CONSORT, STROBE, COREQ, and SQUIRE do not.
PRISMA-P lives in its own template and also lacks a licence line.

| Guideline | Where | Rights status | Note in payload | Risk / action |
|---|---|---|---|---|
| PRISMA 2020 | EQUATOR §2; `systematic_review_toolkit.md` §2; `templates/prisma_report_template.md` | CC BY 4.0 (BMJ article; commercial reuse allowed with citation) | Reference only, no licence line | Low; add “CC BY 4.0, Page et al. 2021” |
| PRISMA-P 2015 | `templates/prisma_protocol_template.md` | CC BY 4.0 (PRISMA-P Group; checklist explicitly CC BY 4.0) | Reference only, no licence line | Low; add the PRISMA-P Group licence note |
| CONSORT 2010 | EQUATOR §3 | Version-dependent: BMC Medicine version CC BY 2.0; BMJ version CC BY-NC 2.0; Elsevier version CC BY-NC-ND 4.0 | No source version or licence line | Medium; pin the BMC Medicine CC BY 2.0 version and add its note; avoid the ND version |
| STROBE | EQUATOR §4 | STROBE Initiative: authors hold copyright; the site asks users to contact the coordinating group before re-publishing STROBE material in other media; documents are open-access downloads | No licence line | **High for commercial**; obtain permission or replace with a pointer to the official checklist |
| COREQ | EQUATOR §5 | OUP standard publication model; no open licence; reuse/permission controlled by OUP | No licence line | **High**; obtain OUP permission or replace the condensed table with a citation + link |
| SQUIRE 2.0 | EQUATOR §6 | CC BY-NC 4.0 (BMJ Quality & Safety) | No licence line | Low–medium; add the CC BY-NC 4.0 note; commercial use needs permission |
| CARE 2013 | EQUATOR §7 | CC BY 2.0 (Journal of Medical Case Reports version) | Explicit licence + modification note | Low; compliant |
| STARD 2015 | EQUATOR §8 | CC BY-NC 4.0 (EQUATOR-hosted artifact) | Explicit licence + modification note | Low; compliant for non-commercial |
| TRIPOD+AI 2024 | EQUATOR §9 | CC BY 4.0 (BMJ statement) | Explicit licence + modification note | Low; compliant |

The COREQ and STROBE sections are condensed paraphrases, not verbatim copies, so
the exposure is lower than a full reproduction. They are still derivatives of
the selection and structure of the originals, and neither has a documented
licence that permits redistribution. Treat them as permission-required for any
commercial release.

### 2.5 Other adaptations

- `academic-paper/references/anti_leakage_protocol.md` says it is “Adapted from
  PaperOrchestra (Song et al., 2026, Appendix D.4)”. arXiv metadata for
  `2604.05018` indicates CC BY 4.0; the file already cites the source but does
  not state the licence. Add “CC BY 4.0” to the source line. Low risk.
- The APA-7 “Adapted from …” lines in `apa7_style_guide.md`,
  `apa7_extended_guide.md`, and `visualization_agent.md` are citation-format
  examples, not reproduced third-party prose. No action.
- `THIRD_PARTY.md` lists projects and mechanisms, not licensed assets; the
  acknowledgements are attribution, not redistribution.

## 3. API terms

The default citation-verification gate uses four bibliographic indexes. The
Chinese-literature resolver is callable but not wired into that gate; the
cross-model transports are opt-in and consent-gated.

| Service | Used by | Data sent | Terms relevant to this port | Commercial use | Rate/attribution conditions | Assessment |
|---|---|---|---|---|---|---|
| arXiv (`export.arxiv.org`) | `arxiv_client.py` | arXiv IDs, title queries | Metadata is CC0; e-print content is for personal/research use; no bulk PDF redistribution; no endorsement | Metadata use is fine under CC0 | ≤1 request/3 s; one connection; no circumvention | Low; the client paces at 3 s and uses metadata only |
| Crossref (`api.crossref.org`) | `crossref_client.py`, `bootstrap_timeline_yaml.py` | DOIs, title queries | “Almost none of the metadata is subject to copyright, and you may use it for any purpose”; abstracts may be publisher/author copyright | Metadata use is fine | Polite pool via `mailto` in User-Agent; ~5–10 req/s | Low; do not redistribute copyrighted abstracts |
| OpenAlex (`api.openalex.org`) | `openalex_client.py` | DOIs, title queries | Data is CC0; “no license worries, ever”; free tier with optional key | Fine under CC0 | Daily budget; burst cap; client paces 1–10 req/s | Low |
| Semantic Scholar (`api.semanticscholar.org`) | `semantic_scholar_client.py` | DOIs, title queries | API License Agreement §2(a): internal use only for “legitimate, non-commercial, research and/or educational purposes”; public use must point back to Semantic Scholar with `utm_source=api`; commercial use needs an expanded licence | **Not permitted without an extended licence** | Unauthenticated ~1 req/s; API key raises limits | **High for commercial**; disable S2 or obtain a licence |
| NCBI E-utilities (`eutils.ncbi.nlm.nih.gov`) | `chinese_literature_client.py` | DOI/ISSN, journal/volume/page, author/year, `tool`, `email` | 3 req/s without a key, 10 with a key; `tool` and `email` required; large jobs off-peak; NCBI disclaimer/copyright notice must be evident; PubMed abstracts may be publisher/author copyright | No explicit prohibition, but attribution/disclaimer conditions apply | Client sends `tool=academic-research-skills` and `ncbi_email`; 0.34 s pacing | Low–medium; add the NCBI disclaimer if PubMed data is displayed |
| DOI (`doi.org`) | `chinese_literature_client.py` | DOI prefix / DOI | Free resolution for anyone; the DOI system is an ISO identifier service | Fine | Resolve, don’t bulk-harvest | Low |
| Handle System (`hdl.handle.net`) | `chinese_literature_client.py` | Handle/DOI | Public resolution query; the Handle System software licence governs running a resolution service, not querying one | Fine | Query only | Low |
| OpenReview (`api2.openreview.net`) | `fetch_calibration_corpus.py` (optional, account-gated) | Paper IDs; downloads PDFs to a local cache | Terms require respecting each submission’s licence and access controls; no flooding; PDFs are not committed | Depends on each paper’s licence | Credentials required; no CI path | Low–medium; keep PDFs out of the package and respect article licences |
| GitHub (`raw.githubusercontent.com`) | `ars_update_check.sh` | No user data; fetches a public `plugin.json` | GitHub ToS API terms; no abuse; no token sharing | Fine | At most one successful check per 24 h; 3 s ceiling | Low |
| OpenAI / Google / Anthropic / DeepSeek | `cross_model_*`, `dispatch_calibration_panel.py` (opt-in) | Up to manuscript content, only with consent | Provider API terms and data-use policies bind the user’s own key; the plugin does not supply credentials | Depends on the user’s provider account | Consent-gated; `ARS_CROSS_MODEL` unset means zero calls | Medium; privacy/terms are the user’s responsibility |
| Codex CLI | `run_codex_audit.sh`, `cross_model_codex_transport.py` (opt-in) | Audit prompts/deliverable content | OpenAI terms, via the user’s Codex login | Depends on the user’s account | Human/CI invocation only; `--dry-run` sends nothing | Low–medium |

**No CNKI / Wanfang / VIP scraping.** `chinese_literature_client.py` explicitly
documents a “zero-scraping red line” and uses `doi.org`, `hdl.handle.net`, and
NCBI E-utilities instead. The CNKI HTML fixture is synthetic and is never parsed.

**Key commercial finding**: the default citation gate includes Semantic Scholar,
whose API licence is limited to non-commercial research/education. A commercial
release must either obtain an extended S2 licence or run the gate without S2
(arXiv + Crossref + OpenAlex remain available). This constraint is independent
of the CC BY-NC 4.0 permission from the upstream author.

## 4. Risk matrix

| Severity | Item | Why it matters | Action |
|---|---|---|---|
| High (commercial blocker) | Semantic Scholar API licence | Default citation gate calls S2; licence excludes commercial use | Disable S2 in commercial mode or obtain an extended licence |
| High (commercial blocker) | COREQ condensed checklist | OUP standard-publication content; no open licence | Obtain permission or replace with a citation + link |
| High (commercial blocker) | STROBE condensed checklist | STROBE Initiative asks users to contact it before re-publishing STROBE material | Obtain permission or replace with a citation + link |
| High (commercial) | IEEE quotations | 93 quoted words (81 unique), ~54% unique coverage of the short normative page | Paraphrase or obtain permission; keep locators |
| Medium | CONSORT version ambiguity | BMC CC BY 2.0 vs BMJ CC BY-NC 2.0 vs Elsevier CC BY-NC-ND 4.0 | Pin the BMC CC BY 2.0 source and add its licence note |
| Medium | PingFang HK / Monotype fonts | Document embedding is allowed; extraction and commercial font reuse are not | Distribute complete PDFs; replace PingFang for a commercial release |
| Medium | ICMJE quotations | Short page; ICMJE prefers links/commentary over reprinting | Reduce or paraphrase for a commercial release |
| Medium | NCBI abstracts/disclaimer | PubMed abstracts may be copyrighted; NCBI disclaimer must be evident | Add the disclaimer if PubMed data is displayed; do not redistribute abstracts |
| Low | PRISMA, PRISMA-P, SQUIRE, CARE, STARD, TRIPOD+AI | Clear CC licences, but some notes are missing | Add licence/attribution lines |
| Low | PRISMA-trAIce, PaperOrchestra | CC BY 4.0 with attribution | Keep citations; add licence notes |
| Low | arXiv, Crossref, OpenAlex, DOI, Handle, GitHub | Open metadata / public resolution / update check | Keep current pacing and attribution |
| Monitor | Upstream policy drift, API terms, guideline licences | Terms change; the Nature page already changed after the snapshot | Re-audit on each payload upgrade and annually |

## 5. Required actions

`tools/build-commercial.mjs` automates the deterministic part of this list on a
copy: it skips Semantic Scholar, replaces the COREQ/STROBE derivatives with
pointers, paraphrases the IEEE quotations to a 50-word budget, adds the missing
licence notes, and recomputes the payload hashes. The permissions, the font
replacement, and the legal review remain external.

### Must fix before any commercial release

1. **Semantic Scholar**: automated in `tools/build-commercial.mjs` (skipped when
   `ARS_COMMERCIAL_MODE=1`); obtain an extended licence only if the commercial
   product must use S2.
2. **COREQ**: automated pointer in the commercial build; obtain OUP permission
   only if the condensed checklist must be restored.
3. **STROBE**: automated pointer in the commercial build; obtain permission from
   the STROBE coordinating group only if the condensed checklist must be
   restored.
4. **IEEE quotations**: automated paraphrase to 42 words; verify the wording
   with counsel, or obtain permission if the verbatim text must remain.
5. **CONSORT**: automated BMC Medicine CC BY 2.0 source pin in the commercial
   build.

### Should fix before redistributing the package

1. Add licence/attribution lines for PRISMA 2020, PRISMA-P 2015, SQUIRE 2.0,
   CONSORT, and PaperOrchestra.
2. Add the NCBI disclaimer/copyright notice wherever PubMed data is displayed.
3. Replace PingFang HK with an OFL font before a commercial release; never
   extract fonts from the PDFs.
4. Keep the four HTML mirrors excluded and keep OpenReview PDFs out of the
   package.
5. Done (2026-10-27): `NOTICE.md` now has a third-party-content section pointing
   at this audit.

### Monitor

- Re-run this audit on every upstream payload upgrade (the payload is pinned;
  see `UPGRADING.md`).
- Re-check the Semantic Scholar, NCBI, Crossref, OpenAlex, and arXiv terms at
  least annually.
- Re-check the reporting-guideline licences when their versions change.

### Automated build result (2026-10-27)

`node tools/build-commercial.mjs --out /tmp/ars-commercial-test --force --strict`
produced a copy with 6 patches. The copy passed `check-payload` with 0 errors,
`verify-install` with 44 PASS / 0 FAIL / 4 WARN / 2 SKIP, and 228 tests (226
pass, 0 fail, 2 skip); the IEEE quote budget fell from 100 to 42 words. The
upstream licence, COREQ/STROBE permissions, font replacement, and legal review
remain external. See [`commercial-build.md`](commercial-build.md).

## 6. Evidence

**Fonts**

- `pdffonts` on the 12 showcase PDFs: all fonts embedded, subset, with Unicode
  maps; no external references.
- `pdfimages -list`: no images in any PDF.
- `pypdf` 6.21.2: `/FontDescriptor` has no `/FSType`; the embedded TrueType
  `OS/2.fsType` is `8` for Times New Roman, Courier New, and STSong; `0` for
  Source Han Serif; the CFF fonts (PingFang HK, Latin Modern Mono) have no
  `OS/2` table.
- `find payload -iname '*.ttf' -o -iname '*.otf' ...`: no results.

**Quotations**

- `docs/design/2026-05-13-ai-disclosure-schema-discovery.md`: 22 quoted table
  cells, 513 words, longest 48 words.
- `academic-paper/references/policy_anchor_table.md`: 22 quoted cells, 504 words,
  longest 40; per anchor: ICMJE 73, IEEE 93, Nature 84, PRISMA-trAIce 254.
- `academic-paper/references/venue_disclosure_policies.md`: 5 quoted cells, 108
  words, longest 31.
- `docs/design/snapshots/2026-05-13-ai-disclosure-discovery/manifest.yaml`: four
  mirrors recorded, none shipped.

**API**

- `payload/docs/DATA_FLOWS.md` §Network touchpoints: the four-index gate, the
  Chinese resolver, the cross-model transports, and the update check.
- `payload/deep-research/references/{arxiv,openalex,crossref,semantic_scholar,chinese_literature}_api_protocol.md`:
  pacing, credentials, degradation behaviour.
- `payload/scripts/chinese_literature_client.py` header: “NO scraping of CNKI /
  Wanfang / VIP”; four open upstreams.
- `payload/scripts/fetch_calibration_corpus.py` header: authenticated OpenReview
  fetch; PDFs are a local cache, never committed.

**Terms pages consulted (2026-10-27)**

- arXiv API ToU: https://info.arxiv.org/help/api/tou.html
- Crossref REST API docs: https://www.crossref.org/documentation/retrieve-metadata/rest-api
- OpenAlex API docs: https://help.openalex.org/api/
- Semantic Scholar API License: https://api.semanticscholar.org/license
- NCBI policies: https://www.ncbi.nlm.nih.gov/home/about/policies/
- NCBI E-utilities manual: https://www.ncbi.nlm.nih.gov/books/NBK25497/
- DOI Handbook / free resolution: https://www.doi.org/
- Handle System licence: https://www.handle.net/HSj/hdlnet-2-LICENSE.pdf
- OpenReview terms: https://openreview.net/legal/terms
- GitHub ToS: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- PRISMA 2020: https://www.bmj.com/content/372/bmj.n71 (CC BY 4.0)
- PRISMA-P 2015 checklist: https://pmc.ncbi.nlm.nih.gov/articles/instance/7311044/bin/bmjopen-2019-036020supp001.pdf (CC BY 4.0)
- CONSORT 2010: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0320937 (BMC Medicine CC BY 2.0)
- STROBE: https://www.strobe-statement.org/ (authors hold copyright; contact before re-publishing)
- COREQ: https://academic.oup.com/intqhc/article/19/6/349/1791966 and OUP standard reuse rights
- SQUIRE 2.0: https://qualitysafety.bmj.com/content/early/2015/09/10/bmjqs-2015-004411.info (CC BY-NC 4.0)
- CARE: https://www.care-statement.org/checklist (CC BY 2.0 per the payload note)
- STARD 2015: EQUATOR-hosted artifact (CC BY-NC 4.0 per the payload note)
- TRIPOD+AI: https://www.bmj.com/content/385/bmj-2023-078378 (CC BY 4.0 per the payload note)
- PaperOrchestra: https://arxiv.org/abs/2604.05018 (arXiv metadata indicates CC BY 4.0)

## 7. Boundaries

- This audit covers the shipped payload, not the upstream repository’s excluded
  tests, evals, or page mirrors.
- It does not re-clear the third-party content with the rights holders. Where the
  table says “permission required”, only the rights holder can grant it.
- Quotation risk depends on jurisdiction and on whether the use is commentary,
  research, or commercial republication. The word counts and proportions above
  are the factual basis; the risk labels are not legal conclusions.
- The upstream payload is pinned; the licences and policy pages may change.
  Re-audit on upgrade.
