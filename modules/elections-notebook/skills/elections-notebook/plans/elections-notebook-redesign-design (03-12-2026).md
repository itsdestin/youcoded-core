# Elections Notebook Skill Redesign — Spec

**Date:** 2026-03-12
**Status:** Spec review passed — awaiting user review

## Problem

The elections notebook skill is slow, fragile, and opaque:
- Phase 1 and Phase 3 use LLM subagents to do deterministic work (API calls, XML editing), leading to misinterpretation, context exhaustion, and silent errors
- PDF extraction is positional rather than label-anchored, breaking on layout variants
- The docx update uses string replacement on raw XML, producing mangled output
- No final accuracy check — errors only discovered when opening in Word
- No learning loop — the same edge cases break things on every run

## Solution

Replace subagent-driven phases with deterministic Node.js scripts. Keep the LLM for what it's good at: interactive flag review and intelligent accuracy review. Add a retrospective step that converts every failure into a skill/script improvement.

## Architecture

```
SKILL.md (thin orchestrator, ~80-100 lines)
│
├─ 1. Pre-flight checks
├─ 2. Playwright: scrape candidates → {NOTEBOOK_DIR}/soi_candidates.json
├─ 3. node collect-data.js → elections_data.json
├─ 4. Flag review (interactive, LLM-powered)
├─ 5. node download-pdfs.js (existing, improved)
├─ 6. node run-extraction.js (existing, improved)
├─ 7. node update-docx.js → output .docx
├─ 8. Accuracy & format review (LLM-powered)
├─ 9. Retrospective — failures → skill updates
└─ 10. Report results
```

Scripts handle all deterministic work. The LLM handles flag review (step 4), accuracy review (step 8), and retrospective (step 9).

## New Scripts

### `collect-data.js`

**Purpose:** Replaces the entire Phase 1 subagent. Handles roster fetching, finance API calls, candidate matching, incumbent detection, report list fetching.

**Interface:**
```
node collect-data.js --candidates <path> --output <path>
```

All paths are passed as absolute paths by the orchestrator. The `--output` path is always `{DATA_FILE}` (resolved from `config.json`'s `data_file` field). The `--candidates` path is always `{NOTEBOOK_DIR}/soi_candidates.json`.

**Input:** JSON array of candidates scraped from arizona.vote SOI page:
```json
[
  {
    "office": "State Representative - District No. 1",
    "name": "Selina Bliss",
    "party": "Republican",
    "campaignInfo": "...",
    "filedDate": "..."
  }
]
```

**Processing steps:**
1. Parse candidates: extract chamber, district number, party, suspended/terminated status
2. Fetch House + Senate rosters from azleg.gov, parse with cheerio
3. Fetch finance entities from seethemoney.az.gov (active + less-active API calls), merge by EntityID
4. Match candidates to finance entities:
   - Normalize names (lowercase, strip Jr/Sr/III, strip middle initials)
   - Match on last name + district + chamber
   - Multiple matches: fetch each entity's detail page, check Status field, pick Active
   - Still ambiguous: flag as `multiple_active`
   - Zero matches: flag as `no_match`
   - Match found but no Active entity: flag as `no_active` (all finance fields = `-`, financing preserved if determinable)
5. Determine filer type: "Clean Elections" in EntityTypeName → Public, else → Private
6. Detect incumbents:
   - Pass 1: exact name match against roster for district+chamber
   - Pass 2: last-name match, first-initial+last-name, substring containment
   - Exact matches: auto-apply `incumbent: true`
   - Fuzzy matches: flag as `fuzzy_incumbent_match` (never auto-apply)
7. Detect suspended/terminated:
   - Incumbent + suspended: `suspended: true` (strikethrough in docx)
   - Non-incumbent + suspended: flag as `suspended_nonincumbent`
8. Fetch report lists for matched entities (200ms delay between calls)
   - Filter to current cycle (2026), sort by FilingDate desc, take most recent
   - Record pdf_url, filing_date, pdf_filename
   - No current-cycle report: finance fields stay null, financing preserved
9. Write elections_data.json

**Progress output:**
```
[1/6] Parsing 147 candidates...
[2/6] Fetching rosters from azleg.gov...
      House: 60 members across 30 districts
      Senate: 30 members across 30 districts
[3/6] Fetching finance entities...
      Active: 234 entities
      Less-active: 89 entities
      Merged: 298 unique entities
[4/6] Matching candidates to entities...
      Matched: 139/147
      No match: 8 (flagged)
[5/6] Detecting incumbents...
      Exact matches: 72
      Fuzzy matches: 3 (flagged for review)
[6/6] Fetching report lists...
      [47/139] Smith, John (LD12 house)...
      Reports found: 112/139
      No current-cycle report: 27
Done. Written to elections_data.json
```

**Error handling:** All errors produce structured flags in the `flags` array. The script never silently drops a candidate or guesses a value. Unexpected API responses are logged with full detail and flagged.

**Data overwrite behavior:** Each run produces a complete, fresh `elections_data.json`. The file is fully overwritten — no merging with previous run data. Previous versions are not preserved (the output docx is the durable artifact).

**Dependencies:** `cheerio` (HTML parsing), Node.js built-in `https` (API calls)

### `update-docx.js`

**Purpose:** Replaces the Phase 3 subagent. Reads elections_data.json and the source notebook, produces an updated notebook with correct values, colors, and formatting.

**Interface:**
```
node update-docx.js --data elections_data.json --notebook source.docx --output output.docx
```

**Processing steps:**
1. Read and unzip notebook using `jszip`
2. Parse `word/document.xml` into XML DOM using `@xmldom/xmldom` (the maintained fork — NOT the unmaintained `xmldom` package)
3. For each district 1-30:
   a. Find district section: walk `<w:p>` elements for text matching `Legislative District \d+`
   b. From that anchor, find the next two `<w:tbl>` elements (House, then Senate)
   c. Within each table, identify candidate rows: primary method is `<w:color>` in run properties; fallback is positional — all `<w:tr>` elements after the column header row (row 2) and before the table end are treated as candidate rows. This handles cases where Word omits `<w:color>` for black/default text.
   d. Parse existing candidate names from first cell text
   e. Match against elections_data.json candidates for this district+chamber
   f. **Update existing rows:** replace text content in each cell, update `<w:color>` val attribute, add/remove `<w:b/>`+`<w:bCs/>` for incumbent, add/remove `<w:strike/>` for suspended
   g. **Add new candidates:** clone an existing row node from the same table, replace all values and formatting, insert before `</w:tbl>`
   h. **Remove candidates:** only if flagged `suspended_nonincumbent` with `approved: true`
4. Serialize DOM back to XML string
5. Replace document.xml in the zip, write output .docx

**Guardrails (enforced in code, not prose):**
- The script only modifies nodes inside candidate data rows (identified by `<w:color>` in run properties)
- It never touches: voter registration tables, population stats, district metadata, table headers, column widths, page/section breaks
- Before writing, it asserts: output XML is well-formed, all 30 districts still present, no table has zero rows

**Row creation:** New rows are created by cloning an existing row from the same table (not from a hardcoded template). This guarantees inherited cell widths, spacing, and structure.

**Party color map (hardcoded):**
| Party | Hex |
|---|---|
| Republican | FF0000 |
| Democrat | 0432FF |
| Libertarian | FFC000 |
| Green / Other | 008000 |
| No Labels / Independent | E36C0A |
| Unknown / Unaffiliated | 000000 |

**Column order:** Name | Financing | Income Total | Income This Period | Expenses Total | Cash Balance

**Validation report (stdout):**
```
Districts processed: 30/30
Candidates updated: 87
Candidates added: 4
  - Jane Doe (LD5 house, Democrat)
  - Bob Jones (LD18 senate, Republican)
  - ...
Candidates removed: 1
  - Sam Smith (LD22 house, Libertarian) [suspended, approved]
Strikethrough applied: 2
Bold (incumbent): 74
Output size: 245KB (original: 241KB, delta: +1.6%)
```

**Dependencies:** `jszip` (zip/unzip), `@xmldom/xmldom` (XML DOM parsing/serialization — the actively maintained fork)

## Improvements to Existing Scripts

### `extract-pdf.js`

**Label-anchored extraction:** Instead of counting positional dollar amounts, search for label text and extract the associated value:
- "Cash Balance at End of Reporting Period" → next dollar amount = `cash_balance`
- "Total Income" (in This Period column) → `income_this_period`
- "Total Income" (in Total to Date column) → `income_total`
- "Total Expenditures" (in Total to Date column) → `expenses_total`

**Fallback:** If label-anchored extraction fails, fall back to the current positional approach but mark the result as low-confidence.

**Confidence scoring:** Each extracted value gets a confidence flag:
- `high`: label-anchored extraction succeeded
- `low`: positional fallback used
- Low-confidence values are flagged in the output for the accuracy review step to scrutinize

**Additional negative format:** Support `-$1,234.56` in addition to `($1,234.56)`.

**Windows compatibility:** The script uses `pdftotext [args] <file> -` (output to stdout) which works on Windows. This pattern MUST be preserved — do NOT use `/dev/stdin`, pipe through stdin, or use shell redirection.

**Output schema with confidence:**
```json
{
  "cash_balance": "$12,345.67",
  "income_this_period": "$5,678.90",
  "income_total": "$23,456.78",
  "expenses_total": "$18,901.23",
  "low_confidence_fields": ["income_this_period"],
  "errors": []
}
```
- `low_confidence_fields`: array of field names where label-anchored extraction failed and positional fallback was used. Empty array if all fields extracted by label. Omitted (along with `errors`) if both are empty.
- Values are always strings (dollar-formatted) or `null` if extraction failed entirely.
- `run-extraction.js` writes `low_confidence_fields` into each candidate's entry in `elections_data.json`. The accuracy review step (step 8) specifically scrutinizes candidates with non-empty `low_confidence_fields`.

### `download-pdfs.js`

- **Parallel downloads:** Batches of 5 concurrent, 200ms between batches (vs sequential with 300ms)
- **One retry on failure** before marking as failed
- **Progress output:** `[23/94] Downloading Smith, John - 01-15-26.pdf...`
- **PDF integrity check:** Verify `%PDF` header after download; delete and flag corrupted files

### `run-extraction.js`

- **Parallel extraction:** Up to 10 concurrent `pdftotext` calls
- **Pass through confidence flags** from extract-pdf.js
- **Better summary:** Include low-confidence count in output

## Orchestrator (SKILL.md)

~80-100 lines. No algorithmic prose. Each step is:
1. What to run (command or action)
2. What to check after (expected output shape)
3. What to present to the user (if interactive)

### Step-by-step detail

**Step 1 — Pre-flight:**
- Find most recent .docx in `Completed Notebooks/`
- Run `pdftotext -v`, `node -v`
- Check `scripts/node_modules/` exists; if not, run `npm install` in scripts dir
- Fail fast with clear error if anything missing

**Step 2 — Scrape candidates (Playwright):**
- Navigate to `https://apps.arizona.vote/electioninfo/SOI/68`
- Wait up to 30s for `#myTable` (Cloudflare challenge)
- Run JS extraction snippet (unchanged from current skill)
- Save result to `{NOTEBOOK_DIR}/soi_candidates.json` (not `/tmp/` — avoids Windows temp path ambiguity)
- Close browser
- Report candidate count

**Step 3 — Collect data (script):**
- Run `node collect-data.js --candidates "{NOTEBOOK_DIR}/soi_candidates.json" --output "{DATA_FILE}"`
- Let progress output stream to user
- After completion, read elections_data.json and report summary

**Step 4 — Flag review (interactive):**
- Read flags array from elections_data.json
- Group by type
- `no_match`: list names, informational only
- `no_active`: list names, informational only (candidate matched entities but none are Active)
- `suspended_nonincumbent`: present each, ask keep/remove, write decision to JSON
- `fuzzy_incumbent_match`: present each with candidate name, roster name, match method, ask confirm/reject, write decision to JSON
- `multiple_active`: present each, ask which entity to use, write decision to JSON

**Step 5 — Download PDFs:**
- Run `node download-pdfs.js`
- Report summary (downloaded/skipped/failed)

**Step 6 — Extract finance data:**
- Run `node run-extraction.js`
- Report summary + list any low-confidence extractions

**Step 7 — Update docx:**
- Run `node update-docx.js --data "{DATA_FILE}" --notebook "{NOTEBOOK_FILE}" --output "{OUTPUT_PATH}"`
- Report summary

**Step 8 — Accuracy & format review (LLM-powered):**
1. Unpack output docx, read document.xml
2. Pick 5 random candidates from elections_data.json. For each, find their row in XML and verify:
   - Name exact match
   - All finance values match
   - Color hex matches party
   - Bold iff incumbent
   - Strikethrough iff suspended
3. Additionally scrutinize all candidates with non-empty `low_confidence_fields` — verify their values look plausible (e.g., dollar amounts in expected ranges, not obviously misplaced values)
4. Structural check: all 30 districts present, each has House + Senate tables, no orphaned XML tags
5. Edge case check: verify no-match and no-active candidates show `-`, approved removals are gone, confirmed fuzzy incumbents are bolded
6. Report pass/fail with specifics
7. If issues found: fix the issue, then re-check the failing candidate(s) plus 5 NEW random candidates (to catch systematic problems, not just the one that was caught)
8. If unfixable: escalate to user

**Step 9 — Retrospective:**
1. Collect all issues from the entire run: script errors, extraction failures, low-confidence values, review failures, manual interventions
2. Categorize each as one-off (data anomaly) or systemic (code gap)
3. For systemic issues: draft a concrete code change or skill instruction update, written to `scripts/pending-updates.md` as a numbered list with proposed diffs
4. Present the numbered list of proposed updates to user
5. Apply approved updates as a separate action after the run is fully complete (not mid-run, to avoid introducing regressions during execution)
6. This is mandatory — runs after every execution whether successful or not

**Step 10 — Report:**
- Output file location
- Summary stats (candidates, districts, flags resolved)
- Any remaining warnings
- Suggest opening in Word to verify

## Config

All tunable parameters in `scripts/config.json`. **All scripts** (new and existing) will read paths from this file — the hardcoded `DATA_FILE` and `PDF_BASE_DIR` constants in `download-pdfs.js` and `run-extraction.js` will be replaced with config reads. This ensures a single source of truth for all paths.

Contents of `scripts/config.json`:
```json
{
  "notebook_dir": "~/Desktop/Elections Notebook",
  "data_file": "~/Desktop/Elections Notebook/elections_data.json",
  "pdf_dir": "~/Desktop/Elections Notebook/Campaign Finance PDFs",
  "output_dir": "~/Desktop/Elections Notebook/Completed Notebooks",
  "soi_url": "https://apps.arizona.vote/electioninfo/SOI/68",
  "roster_house_url": "https://www.azleg.gov/MemberRoster/?body=H",
  "roster_senate_url": "https://www.azleg.gov/MemberRoster/?body=S",
  "finance_api_url": "https://seethemoney.az.gov/Reporting/GetNEWTableData/",
  "reports_api_url": "https://seethemoney.az.gov/Reporting/GetTableData",
  "api_delay_ms": 200,
  "download_batch_size": 5,
  "download_batch_delay_ms": 200,
  "extraction_concurrency": 10,
  "election_cycle_year": 2026,
  "party_colors": {
    "Republican": "FF0000",
    "Democrat": "0432FF",
    "Democratic": "0432FF",
    "Libertarian": "FFC000",
    "Green": "008000",
    "No Labels": "E36C0A",
    "Independent": "E36C0A",
    "Other": "008000",
    "default": "000000"
  }
}
```

## Dependencies

One-time setup in `scripts/` directory:
```bash
cd ~/.claude/skills/elections-notebook/scripts
npm init -y
npm install cheerio jszip @xmldom/xmldom
```

No global installs needed. `pdftotext` (from poppler/xpdf) must already be on PATH (existing requirement).

## File Structure After Implementation

```
elections-notebook/
├── SKILL.md                    (~80-100 lines, orchestrator only)
├── specs/
│   └── 2026-03-12-elections-notebook-redesign.md
└── scripts/
    ├── config.json
    ├── package.json
    ├── node_modules/           (cheerio, jszip, @xmldom/xmldom)
    ├── collect-data.js         (NEW — replaces Phase 1 subagent)
    ├── update-docx.js          (NEW — replaces Phase 3 subagent)
    ├── download-pdfs.js        (existing, improved)
    ├── run-extraction.js       (existing, improved)
    ├── extract-pdf.js          (existing, improved)
    └── pending-updates.md      (generated by retrospective step — not checked in)
```

## Success Criteria

1. **Speed:** Full run completes in under 5 minutes (vs current 15-30+ minutes)
2. **Reliability:** No mangled docx output. Scripts either succeed or fail with clear error messages.
3. **Accuracy:** Final review step catches value mismatches before the user opens the file
4. **Transparency:** Progress reporting throughout — user always knows what's happening
5. **Self-improving:** Every run that encounters issues produces skill/script updates, so the same issue never happens twice
