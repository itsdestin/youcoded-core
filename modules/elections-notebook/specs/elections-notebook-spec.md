# Elections Notebook -- Spec

**Version:** 1.0
**Last updated:** 2026-03-13
**Feature location:** `~/.claude/skills/elections-notebook/`

## Purpose

The Elections Notebook skill automates the production of a DeMenna & Associates legislative elections reference document (.docx) covering all 30 Arizona State Legislative Districts. It scrapes candidate filings from arizona.vote, matches candidates to campaign finance entities on seethemoney.az.gov, downloads and parses campaign finance PDF reports, and writes the results into a formatted Word document with party-colored text, incumbent bolding, suspended-candidate strikethrough, and per-candidate financial data (cash balance, income this period, income total, expenses total). The pipeline is structured as a two-pass Node.js script with an interactive flag-review step between passes, enabling human oversight of fuzzy name matches, incumbent detection, and edge-case decisions before the final document is generated.

## User Mandates

- (2026-03-13) The SOI page on arizona.vote is the sole authoritative source for candidate party affiliation and color coding. Do NOT use the `PartyName` field from the finance API.
- (2026-03-13) The `EntityTypeName` field from the `GetNEWTableData` search API is the sole source of truth for filer type (Public/Private financing). Do NOT infer from any other field.
- (2026-03-13) Flag decisions require user review. The pipeline must pause after Phase B (data collection) when `--pause-for-flags` is used, presenting all flags for interactive decision before proceeding to the docx update.
- (2026-03-13) Previously decided flags are cached in `flag_decisions_cache.json` and auto-applied on subsequent runs. Only new/unseen flags need manual decisions.
- (2026-03-13) Candidates with `low_confidence_fields` (extracted via positional fallback rather than label-anchored extraction) must be manually scrutinized during the accuracy review step.
- (2026-03-13) Every run must include an automated spot-check verification (`--verify`) and a retrospective to categorize issues as one-off or systemic.
- (2026-03-13) The output document must contain exactly 30 district headings, each with House and Senate candidate tables. The pipeline validates this before writing and exits with an error if the count is wrong.

## Design Decisions

| Decision | Rationale | Alternatives considered |
|----------|-----------|------------------------|
| Single monolithic `pipeline.js` (~2400 lines) with all logic inlined | Eliminates inter-module coordination bugs; self-contained execution with a single `node pipeline.js` command | Separate scripts per phase; modular ES modules |
| Two-pass execution (A+B then C) with `--pause-for-flags` | Allows human review of fuzzy matches and edge cases before writing the docx, preventing bad data from entering the document | Single-pass with post-hoc corrections; fully automated with no human review |
| Label-anchored PDF extraction as primary, positional fallback as secondary | Label search is more reliable across varying PDF layouts; positional fallback catches non-standard formats but flags them as `low_confidence_fields` | Positional-only (original approach); tabula-based table extraction |
| Playwright MCP for SOI scraping (not direct HTTP) | arizona.vote is behind Cloudflare Turnstile which blocks headless HTTP requests; Playwright with a real browser session accumulates Turnstile signals and passes on retry | Puppeteer; direct HTTP with cookie replay; manual CSV export |
| Name normalization via a single `normalizeName()` function used everywhere | Prevents mismatches between SOI names, API entity names, incumbent roster names, and docx row names caused by inconsistent normalization | Separate normalization per context; raw string comparison |
| Direct OOXML manipulation via JSZip + xmldom (no pandoc) | Full control over Word formatting (run-level color, bold, strikethrough, section breaks, table layout); pandoc cannot preserve or apply these granular formatting properties | pandoc-based conversion; python-docx; docx templating libraries |
| Flag decision caching keyed by candidate+entity name pairs | Avoids re-asking the same fuzzy match questions across runs when the candidate pool is stable | No caching (re-ask every time); caching by flag index (fragile across runs) |
| Concurrent per-candidate processing with configurable pool size (default 10) | Parallelizes HTTP requests to the finance API and PDF downloads; batch delay of 50ms prevents rate limiting | Sequential processing; unbounded parallelism |
| Nickname dictionary for fuzzy entity matching (Tier 1) before Levenshtein (Tier 2) | Common nickname variants (Bill/William, Mike/Michael) are certain matches that should not require Levenshtein distance thresholds | Levenshtein only; phonetic matching (Soundex/Metaphone) |
| Section breaks with "Different First Page" headers between districts | Each district starts on a new page with the header visible only on the first page; overflow pages get an empty header to avoid visual clutter | No section breaks (continuous); manual page breaks without header control |

## Current Implementation

### File Structure

```
~/.claude/skills/elections-notebook/
  SKILL.md                    # Skill definition and execution steps
  scripts/
    pipeline.js               # Main pipeline (~2400 lines, all phases)
    extract-pdf.js             # Standalone PDF extraction (same logic as inlined in pipeline.js)
    parse-playwright.js        # Parses Playwright browser_evaluate output into clean JSON
    config.json                # All configurable paths, URLs, colors, and concurrency settings
    node_modules/              # npm dependencies (cheerio, jszip, @xmldom/xmldom)
  specs/
    2026-03-12-elections-notebook-redesign.md
    2026-03-12-elections-notebook-implementation-plan.md
    2026-03-12-pipeline-optimization-design.md
    spec.md                    # This file
```

### Data Sources

| Source | URL | Purpose | Access Method |
|--------|-----|---------|---------------|
| AZ Statements of Interest | `https://apps.arizona.vote/electioninfo/SOI/68` | Candidate names, parties, offices, filing dates, suspension status | Playwright MCP (Cloudflare Turnstile protected) |
| AZ Campaign Finance Search | `https://seethemoney.az.gov/Reporting/GetNEWTableData/` | Entity IDs, entity type (Public/Private), committee names | HTTP POST (DataTables server-side API) |
| AZ Campaign Finance Reports | `https://seethemoney.az.gov/Reporting/GetTableData` | Per-entity report listings, PDF URLs, filing dates | HTTP GET with entity ID parameter |
| AZ Campaign Finance PDFs | URLs from reports API | Cash balance, income, expenses | PDF download + pdftotext extraction |
| AZ House Roster | `https://www.azleg.gov/MemberRoster/?body=H` | Current House members for incumbent detection | HTTP GET + cheerio HTML parsing |
| AZ Senate Roster | `https://www.azleg.gov/MemberRoster/?body=S` | Current Senate members for incumbent detection | HTTP GET + cheerio HTML parsing |
| Entity Detail API | `https://seethemoney.az.gov/Reporting/GetDetailedInformation` | Per-entity Active/Terminated/Suspended status for disambiguation | HTTP POST with entity ID |

### Pipeline Architecture (pipeline.js)

The pipeline has three phases plus four utility modes:

**Phase A -- Bulk Setup**
1. Parse SOI candidates JSON (deduplicate, extract chamber/district from office name)
2. Fetch House and Senate rosters from azleg.gov (cheerio HTML parsing with table and fallback div-based layout)
3. Fetch all finance entities from seethemoney.az.gov (both active and less-active pools via `GetNEWTableData`, merged into a single Map keyed by EntityID)
4. Match candidates to finance entities using a three-tier strategy:
   - Exact: normalized last name + district + chamber index lookup
   - Tier 1 (Nickname): expand first name via a ~60-entry nickname dictionary, require single match
   - Tier 2 (Levenshtein): last-name edit distance <= 2 within same district+chamber, require single match
   - Multiple matches: disambiguate via per-entity `GetDetailedInformation` status (Active preferred)
5. Detect incumbents by comparing candidates against roster names:
   - Exact: full normalized name match
   - Fuzzy: first-initial + last-name match or substring containment (auto-set incumbent)
   - Last-name-only: flagged but NOT auto-set (requires user confirmation)
6. Generate flags for all fuzzy matches, no-matches, suspended non-incumbents, multiple actives, and errors

**Phase B -- Per-Candidate Streaming**
1. For each candidate with an entity ID (concurrent, pool size from config):
   - Fetch report listing from `GetTableData` for the entity
   - Filter to current election cycle year (2026)
   - Sort by filing date, take latest report
   - Download PDF to `Campaign Finance PDFs/LD{N}/` directory (skip if already cached)
   - Validate PDF header (`%PDF-`)
   - Extract finance data via `extractFinanceFromPdf()`:
     - Page 1: Cash balance at end of reporting period (label-anchored, then positional fallback from Summary of Finances section)
     - Page 2: Income this period, income total, expenses total (label-anchored via "Total Income"/"Total Expenditures" labels within "Total to Date" column sections, then positional fallback by dollar-amount counting)
   - Flag low-confidence fields (those extracted via positional fallback)
2. Write `elections_data.json` with all district/candidate/finance data and flags
3. Auto-apply cached flag decisions from `flag_decisions_cache.json`

**Interactive Flag Review (between Phase B and Phase C)**
- `--review-flags`: Display all flags grouped by type with cached decision status
- `--apply-flag <index> --action confirm|reject`: Apply single decision
- `--apply-flags <decisions.json>`: Batch apply decisions from JSON file
- Flag types requiring decisions:
  - `fuzzy_incumbent_match`: confirm/reject incumbent status (auto_set vs. last_name_only)
  - `fuzzy_entity_match`: confirm/reject entity match (nickname or Levenshtein)
  - `suspended_nonincumbent`: keep/remove from document
  - `multiple_active`: choose which entity ID to use
- Informational flag types (no action needed): `no_match`, `no_active`, `pipeline_error`, `parse_error`

**Phase C -- Docx Update**
1. Load source `.docx` via JSZip, parse `word/document.xml` with xmldom DOMParser
2. Update "Last Edited" date field (searches document.xml then header1.xml)
3. Locate all 30 "Legislative District N" heading paragraphs in the document body
4. For each district, find House and Senate candidate tables by header row text
5. Match existing table rows to candidate data using normalized names (three passes: exact, reversed-name, fuzzy with last-name + word/prefix similarity)
6. For each matched row:
   - Update all 6 cells: Name, Financing, Income Total, Income This Period, Expenses Total, Cash Balance
   - Set run-level and paragraph-level font color based on party (see Party Color Map)
   - Set bold on all runs if incumbent
   - Set strikethrough on all runs if suspended
7. Remove rows for candidates rejected via `suspended_nonincumbent` flags
8. Add new rows by cloning an existing candidate row, filling cells, and applying formatting
9. Apply table layout fixes:
   - `cantSplit` on all table rows (prevent row splitting across pages)
   - `tblHeader` on first rows (repeat header on page breaks)
   - Minimize spacing on empty inter-table paragraphs
10. Insert section breaks between districts (districts 2-30) with "Different First Page" header configuration:
    - First page of each district: real header (header1.xml)
    - Overflow pages: empty header (header2.xml, created by pipeline)
    - Updates `[Content_Types].xml` and `word/_rels/document.xml.rels` for the new header
11. Remove trailing empty paragraphs before section breaks and collapse consecutive empty paragraphs
12. Validate output XML is well-formed and contains all 30 district headings
13. Write compressed `.docx` to output directory

**Verification Mode (`--verify`)**
- Randomly samples N candidates (default 5) with finance data
- For each, verifies in the output docx: name presence, all 4 finance values, party color hex, bold=incumbent, strikethrough=suspended
- Checks "Last Edited" date in document and header files

### Party Color Map

| Party | Hex Code |
|-------|----------|
| Republican | `FF0000` (red) |
| Democrat / Democratic | `0432FF` (blue) |
| Libertarian | `FFC000` (gold) |
| Green / Other | `008000` (green) |
| No Labels / Independent / Arizona Independent | `E36C0A` (orange) |
| Unknown / Unaffiliated / default | `000000` (black) |

### No-Data Rules

| Situation | Financing Column | Finance Fields | PDF Downloaded |
|-----------|-----------------|----------------|----------------|
| Not found in finance API | `-` | `-` for all | No |
| Found but no Active entity | `-` | `-` for all | No |
| Active entity, no 2026 cycle report | Public or Private | `-` for all | No |
| Active entity + valid 2026 report | Public or Private | Extracted from PDF | Yes |

### Key Algorithms

**Name Normalization (`normalizeName`)**
- Lowercase, NFD unicode normalization, strip diacritics
- Handle "Last, First" comma format
- Strip quotes, periods, parenthetical suffixes, generational suffixes (Jr., Sr., II, III, IV)
- Convert hyphens to spaces
- Collapse whitespace
- Filter middle initials (single-character non-first/last parts)
- Return: `{ full, last, first, firstInitial, raw }`

**PDF Finance Extraction (`extractFinanceFromPdf`)**
- Uses `pdftotext` (Xpdf/Poppler) to extract text from specific pages
- Page 1: Searches for "Cash Balance at End of Reporting Period" label, verifies not preceded by "Beginning", takes first dollar amount after label. Fallback: last dollar amount in "Summary of Finances" section.
- Page 2: Splits text by "Covers MM/DD/YYYY to MM/DD/YYYY" divider and "Total to Date" markers into 3 sections. Label-anchored search for "Total Income" and "Total Expenditures" within each section. Positional fallback: section 0 index 11 (income this period), section 1 index 11 (income total), section 2 second-to-last (expenses total).
- Dollar amount regex: `(\$[\d,]+\.\d{2})` with support for accounting-style parenthetical negatives `($X)` and explicit negatives `-$X`.

### Execution Flow (SKILL.md Steps)

1. **Pre-flight**: Find latest `.docx` in output dir, verify `pdftotext`, `node`, and `node_modules`
2. **Scrape Candidates**: Playwright MCP navigates to SOI page with Cloudflare retry loop (up to 3 navigation attempts), extracts `#myTable` rows, saves to `soi_candidates.json`
3. **Pipeline Pass 1**: `pipeline.js --pause-for-flags` runs Phases A + B, writes `elections_data.json`
4. **Flag Review**: Display flags via `--review-flags`, collect user decisions, apply via `--apply-flag` or `--apply-flags`
5. **Pipeline Pass 2**: `pipeline.js --resume` runs Phase C only, produces dated output `.docx`
6. **Accuracy Review**: `--verify` spot-check + manual review of low-confidence fields + structural validation
7. **Retrospective**: Categorize run issues, draft code changes to `pending-updates.md`
8. **Report**: Output location, summary stats, warnings, total execution time

### Configuration (config.json)

| Key | Value | Purpose |
|-----|-------|---------|
| `notebook_dir` | `~/Desktop/Elections Notebook` | Root working directory |
| `output_dir` | `{notebook_dir}/Completed Notebooks` | Where dated output docx files go |
| `data_file` | `{notebook_dir}/Pipeline Data/elections_data.json` | Intermediate data file |
| `flag_cache_file` | `{notebook_dir}/Pipeline Data/flag_decisions_cache.json` | Persistent flag decision cache |
| `pdf_dir` | `{notebook_dir}/Campaign Finance PDFs` | Downloaded PDFs organized by `LD{N}/` |
| `soi_url` | `https://apps.arizona.vote/electioninfo/SOI/68` | SOI page URL |
| `roster_house_url` | `https://www.azleg.gov/MemberRoster/?body=H` | House roster page |
| `roster_senate_url` | `https://www.azleg.gov/MemberRoster/?body=S` | Senate roster page |
| `finance_api_url` | `https://seethemoney.az.gov/Reporting/GetNEWTableData/` | Finance entity search API |
| `reports_api_url` | `https://seethemoney.az.gov/Reporting/GetTableData` | Per-entity report listing API |
| `extraction_concurrency` | `10` | Max parallel candidate processing |
| `election_cycle_year` | `2026` | Current election cycle filter |
| `party_colors` | `{...}` | Party-to-hex color mapping |

## Dependencies

### External Tools
- **pdftotext** (Xpdf or Poppler): Extracts text from campaign finance PDF reports, called per-page via `execFileSync`
- **Node.js**: Runtime for pipeline.js, extract-pdf.js, parse-playwright.js
- **Playwright MCP**: Browser automation for scraping the Cloudflare-protected SOI page on arizona.vote

### npm Packages (in `scripts/node_modules/`)
- **cheerio**: HTML parsing for azleg.gov roster pages
- **jszip**: Read/write `.docx` files (which are ZIP archives of OOXML)
- **@xmldom/xmldom**: DOM parsing and serialization of `word/document.xml` and related OOXML files

### Skill Dependencies
- Depends on: **Playwright MCP** (for SOI candidate scraping in Step 2)
- Depended on by: None

### Data Dependencies
- Requires a source `.docx` template in the Completed Notebooks directory (the most recent file is used as the base for each run)
- Requires network access to arizona.vote, seethemoney.az.gov, and azleg.gov

## Known Bugs / Issues

*None currently tracked.*

## Planned Updates

*(None currently)*

## Change Log

| Date | Version | What changed | Type | Approved by |
|------|---------|-------------|------|-------------|
| 2026-03-13 | 1.0 | Initial spec | New | the user |
