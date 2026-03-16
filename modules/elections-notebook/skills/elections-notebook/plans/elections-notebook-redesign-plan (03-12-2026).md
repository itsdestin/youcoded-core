# Elections Notebook Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slow, fragile subagent-driven elections notebook pipeline with deterministic Node.js scripts, keeping the LLM only for interactive review steps.

**Architecture:** Five scripts (`config.json` loader, `collect-data.js`, improved `extract-pdf.js`, improved `download-pdfs.js`/`run-extraction.js`, `update-docx.js`) do all deterministic work. A slim `SKILL.md` orchestrates them, with the LLM handling Playwright scraping, flag review, accuracy review, and retrospective.

**Tech Stack:** Node.js, cheerio, jszip, @xmldom/xmldom, pdftotext (existing)

**Spec:** `~/.claude/skills/elections-notebook/specs\2026-03-12-elections-notebook-redesign.md`

**Base directory:** `~/.claude/skills/elections-notebook/`

**Testing approach:** These scripts interact with external APIs and local files, so formal unit tests aren't practical. Each task includes verification steps using sample/mock data and manual output inspection. The real integration test is running the full pipeline (covered in Task 8).

---

## Chunk 1: Foundation + Data Collection

### Task 1: Setup — config.json, package.json, npm install

**Files:**
- Create: `scripts/config.json`
- Create: `scripts/package.json`

- [ ] **Step 1: Create config.json**

Write `scripts/config.json` with the full configuration from the spec:

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

- [ ] **Step 2: Create package.json and install dependencies**

Run:
```bash
cd "~/.claude/skills/elections-notebook/scripts"
npm init -y
npm install cheerio jszip @xmldom/xmldom
```

Expected: `node_modules/` created with all three packages. Verify:
```bash
node -e "require('cheerio'); require('jszip'); require('@xmldom/xmldom'); console.log('All deps OK')"
```

- [ ] **Step 3: Create shared config loader**

Create a small helper at the top of each script (not a separate file — just a pattern). Each script will load config like:
```javascript
const path = require('path');
const config = require(path.join(__dirname, 'config.json'));
```
This is a pattern to apply in each script, not a separate file.

---

### Task 2: collect-data.js — Candidate parsing + roster fetching

**Files:**
- Create: `scripts/collect-data.js`

This is the largest new script. Build it incrementally — this task covers argument parsing, candidate parsing, and roster fetching. Tasks 3 and 4 add the remaining functionality.

- [ ] **Step 1: Write script skeleton with arg parsing**

Write `scripts/collect-data.js` with:
- `--candidates <path>` and `--output <path>` argument parsing (using `process.argv` — no arg parsing library needed)
- Config loading from `config.json`
- Read and parse the candidates JSON file
- Candidate parsing logic: extract `chamber` ("house"/"senate" from office text), `district` (number from office text), `party`, `suspended` (from campaignInfo containing "Suspended"/"Terminated")
- Print `[1/6] Parsing {N} candidates...` progress line
- Main async wrapper

```javascript
#!/usr/bin/env node
// collect-data.js — Collects candidate, roster, and finance data for Elections Notebook
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const cheerio = require('cheerio');
const config = require(path.join(__dirname, 'config.json'));

// ... arg parsing, candidate parsing, etc.
```

- [ ] **Step 2: Add roster fetching and parsing**

Add functions to:
- Fetch HTML from `config.roster_house_url` and `config.roster_senate_url` using `https.get` with User-Agent header
- Parse with cheerio to extract member names and district numbers
- Build lookup object keyed by `{district}_{chamber}` → array of member name strings (e.g., `{ "1_house": ["Selina Bliss", "Quang Nguyen"], "1_senate": ["Mark Finchem"] }`)
- Store names as they appear on the page — no normalization at this stage (normalization happens during incumbent detection in Task 3)
- Handle vacant seats gracefully: if a district has fewer members than expected (0 or 1 house members instead of 2), that's valid — just store what's there
- Print `[2/6] Fetching rosters from azleg.gov...` with member counts

To determine the correct cheerio selectors, first fetch one roster page and inspect the structure. The rosters use a table or card layout — selectors should be determined from the actual HTML.

- [ ] **Step 3: Verify with mock data**

Create a small test candidates JSON at `{NOTEBOOK_DIR}/test_soi_candidates.json`:
```json
[
  {"office": "State Representative - District No. 1", "name": "Selina Bliss", "party": "Republican", "campaignInfo": "", "filedDate": "01/15/2025"},
  {"office": "State Senator - District No. 1", "name": "Mark Finchem", "party": "Republican", "campaignInfo": "Suspended", "filedDate": "02/01/2025"}
]
```

Run:
```bash
node scripts/collect-data.js --candidates "~/Desktop/Elections Notebook/test_soi_candidates.json" --output "~/Desktop/Elections Notebook/test_output.json"
```

Expected: Script parses candidates (Bliss → house/1/Republican/not suspended, Finchem → senate/1/Republican/suspended), fetches rosters successfully, and prints progress. It will fail at later steps (finance API) which is expected — verify the parsing and roster steps complete.

---

### Task 3: collect-data.js — Finance entity matching

**Files:**
- Modify: `scripts/collect-data.js`

- [ ] **Step 1: Add finance entity API calls**

Add function to fetch entities from seethemoney.az.gov:
- Two POST requests: active entities (`IsLessActive=false`) and less-active (`IsLessActive=true`)
- Use the exact URL, headers, and POST body from the spec (lines 196-209 of existing SKILL.md)
- Merge results by `EntityID` (if duplicate, keep active-list version)
- Tag each with `source: "active"` or `source: "less_active"`
- Print `[3/6] Fetching finance entities...` with counts

- [ ] **Step 2: Add candidate-to-entity matching**

Add matching function:
- Normalize names: lowercase, strip common suffixes (Jr, Sr, II, III, IV), strip middle initials (single letter followed by period)
- Extract last name from both candidate name and entity `EntityLastName`
- Match on: normalized last name + district number (from `OfficeName`) + chamber (from `OfficeName`)
- If multiple matches: fetch `https://seethemoney.az.gov/Reporting/Details/{EntityID}` for each (HTTP GET, parse HTML with cheerio — look for "Demographic Information" section and the "Status:" field within it), pick the one with `Status: Active`
- If still ambiguous after detail page check: flag as `multiple_active`
- If zero matches: flag as `no_match`
- If match found but none Active: flag as `no_active`. Still read `EntityTypeName` from the matched (inactive) entity to determine financing — if determinable, set to "Public" or "Private"; only default to "-" if EntityTypeName is missing/ambiguous
- Set `financing`: "Public" if EntityTypeName contains "Clean Elections" or "participating", else "Private", else "-" for no match
- Print `[4/6] Matching candidates to entities...` with match/no-match counts

- [ ] **Step 3: Add incumbent detection**

Add incumbent detection function:
- Pass 1 (exact): normalize both names to lowercase, check if candidate full name appears in roster for their `{district}_{chamber}` key → set `incumbent: true`
- Pass 2 (fuzzy): for unmatched candidates, try:
  - Last-name match: extract and compare last names only
  - First-initial + last-name: compare first letter of first name + full last name
  - Substring containment: check if one name contains the other
- Exact matches → auto-apply `incumbent: true`
- Fuzzy matches → add to flags: `{ type: "fuzzy_incumbent_match", candidate_name, roster_name, district, chamber, match_method }`
- Print `[5/6] Detecting incumbents...` with exact/fuzzy counts

- [ ] **Step 4: Add suspended/terminated detection**

Apply suspended detection rules:
- Already parsed from `campaignInfo` in Task 2
- If incumbent AND suspended → set `suspended: true`
- If non-incumbent AND suspended/terminated → add to flags: `{ type: "suspended_nonincumbent", name, district, chamber }`

---

### Task 4: collect-data.js — Report fetching + JSON output

**Files:**
- Modify: `scripts/collect-data.js`

- [ ] **Step 1: Add report list fetching**

For each candidate with a matched Active entity, fetch report list:
```
GET https://seethemoney.az.gov/Reporting/GetTableData?Name=1~{ENTITY_ID}&ChartName=11&ShowAllYears=true
```
- Filter to `CycleYear == config.election_cycle_year`
- Sort by `FilingDate` descending, take first (most recent)
- Record: `pdf_url` (ReportFileURL), `filing_date` (FilingDate), `pdf_filename` (generated as `{Last}, {First} - {MM-DD-YY}.pdf` — sanitize for Windows)
- If no current-cycle report: leave finance fields as null, preserve financing value
- Use `config.api_delay_ms` between calls
- Print `[6/6] Fetching report lists...` with per-candidate progress

- [ ] **Step 2: Write elections_data.json output**

Assemble the full output structure:
```json
{
  "run_date": "YYYY-MM-DD",
  "districts": {
    "1": {
      "house": [{ name, party, incumbent, suspended, financing, entity_id, pdf_url, pdf_filename, filing_date, cash_balance: null, income_this_period: null, income_total: null, expenses_total: null, low_confidence_fields: [] }],
      "senate": [...]
    }
  },
  "flags": [...]
}
```

Write to the `--output` path with `JSON.stringify(data, null, 2)`.
**Data overwrite behavior:** Each run produces a complete, fresh file. No merging with previous run data.
Print summary: candidates found, matched, unmatched, PDFs to download.

- [ ] **Step 3: Full verification run**

Run with the test candidates file from Task 2 Step 3:
```bash
node scripts/collect-data.js --candidates "~/Desktop/Elections Notebook/test_soi_candidates.json" --output "~/Desktop/Elections Notebook/test_output.json"
```

Verify:
- All 6 progress steps print
- Output JSON has correct structure
- Flags array contains expected entries (if any no-match or fuzzy matches)
- Finance data populated where matches found
- No unhandled errors

Clean up test file after verification.

---

## Chunk 2: PDF Pipeline Improvements

### Task 5: Improve extract-pdf.js — Label-anchored extraction

**Files:**
- Modify: `scripts/extract-pdf.js`

- [ ] **Step 1: Add label-anchored extraction for page 1 (cash_balance)**

Refactor page 1 extraction:
- Primary method: search for "Cash Balance at End of Reporting Period" label text, extract the next dollar amount after it
- If label not found, fall back to existing "Summary of Finances" positional approach
- Track whether label-anchored or positional was used

- [ ] **Step 2: Add label-anchored extraction for page 2 (income + expenses)**

Refactor page 2 extraction:
- Primary: search for "Total Income" label in the pdftotext output. The page has two columns (This Period / Total to Date), so look for the pattern of dollar amounts near "Total Income" and "Total Expenditures" labels
- For `income_this_period`: find "Total Income" in This Period section → next dollar amount
- For `income_total`: find "Total Income" in Total to Date section → next dollar amount
- For `expenses_total`: find "Total Expenditures" in Total to Date section → next dollar amount
- If label-anchored fails for any field, fall back to existing positional approach for that field only

- [ ] **Step 3: Add confidence scoring and updated output schema**

- Add `low_confidence_fields` array to output
- For each field: if extracted by label → high confidence (not in array); if by positional fallback → add field name to `low_confidence_fields`
- Update dollar amount regex to also match `-$1,234.56` format (in addition to existing `($1,234.56)` format). **Important:** enforce paired parentheses — the old regex allows mismatched `($1,234.56` or `$1,234.56)`. Use:
```javascript
/(?:\(\$[\d,]+\.\d{2}\)|\$[\d,]+\.\d{2}|-\$[\d,]+\.\d{2})/g
```
This matches: `($1,234.56)` (paired parens), `$1,234.56` (no parens), or `-$1,234.56` (dash prefix).
- Output schema:
```json
{
  "cash_balance": "$12,345.67",
  "income_this_period": "$5,678.90",
  "income_total": "$23,456.78",
  "expenses_total": "$18,901.23",
  "low_confidence_fields": [],
  "errors": []
}
```
- Omit `low_confidence_fields` and `errors` if both empty (backward compat)
- **Critical:** low-confidence info goes ONLY in `low_confidence_fields`, NEVER in `errors`. The `errors` array is reserved for actual failures (missing pages, parse crashes). This is important because the existing `run-extraction.js` treats any non-empty `errors` array as total failure — until Task 6 updates it, mixing confidence warnings into `errors` would cause false failures.

**Windows compatibility — do NOT change:** The script uses `pdftotext [args] <file> -` (output to stdout). This pattern works on Windows and MUST be preserved. Do not use `/dev/stdin`, pipe through stdin, or use shell redirection.

- [ ] **Step 4: Verify with existing PDFs**

If any PDFs exist from prior runs in `Campaign Finance PDFs/`:
```bash
node scripts/extract-pdf.js "~/Desktop/Elections Notebook/Campaign Finance PDFs/LD1/some-existing.pdf"
```

Verify output JSON has all four values populated and `low_confidence_fields` is empty (label-anchored worked). If no existing PDFs, skip this step — will be verified during integration test.

---

### Task 6: Improve download-pdfs.js + run-extraction.js

**Files:**
- Modify: `scripts/download-pdfs.js`
- Modify: `scripts/run-extraction.js`

- [ ] **Step 1: Update download-pdfs.js to use config + parallel downloads**

Refactor `download-pdfs.js`:
- Replace hardcoded `DATA_FILE` and `PDF_BASE_DIR` with config reads:
```javascript
const config = require(path.join(__dirname, 'config.json'));
const DATA_FILE = config.data_file;
const PDF_BASE_DIR = config.pdf_dir;
```
- Add batch-parallel downloading: process PDFs in batches of `config.download_batch_size` concurrently, with `config.download_batch_delay_ms` between batches
- Add one retry on failure per PDF
- Add progress output: `[{n}/{total}] Downloading {filename}...`
- Add PDF integrity check after download: read first 5 bytes, verify starts with `%PDF-`. If not, delete file and flag as corrupted

- [ ] **Step 2: Update run-extraction.js to use config + parallel extraction + confidence**

Refactor `run-extraction.js`:
- Replace hardcoded paths with config reads
- Add parallel extraction: process up to `config.extraction_concurrency` PDFs concurrently using a simple semaphore/queue pattern
- Update extraction result handling:
  - If `extracted.errors && extracted.errors.length > 0` BUT values are still present → use the values (partial success), don't set all to `-`
  - Pass through `low_confidence_fields` from extract-pdf.js into the candidate entry in elections_data.json
  - Only set values to `-` if extraction failed entirely (exception thrown or all values null)
- Update summary to include low-confidence count:
```
Done. Processed: 94, Succeeded: 87, Low-confidence: 4, Failed: 3
```

- [ ] **Step 3: Verify config loading**

Quick smoke test:
```bash
node -e "const p=require('path'); const c=require(p.join('~/.claude/skills/elections-notebook/scripts','config.json')); console.log('data_file:', c.data_file); console.log('pdf_dir:', c.pdf_dir)"
```
Expected: prints correct paths from config.json.

---

## Chunk 3: Document Update + Orchestrator

### Task 7: update-docx.js — Full docx update script

**Files:**
- Create: `scripts/update-docx.js`

This is the second-largest new script. It replaces the Phase 3 subagent with deterministic XML DOM manipulation.

- [ ] **Step 1: Write script skeleton with arg parsing and zip handling**

Write `scripts/update-docx.js`:
- Parse `--data <path>`, `--notebook <path>`, `--output <path>` arguments
- Load config
- Read notebook .docx using jszip
- Extract `word/document.xml` as text
- Parse into DOM using `@xmldom/xmldom`'s `DOMParser`
- Skeleton for district processing loop
- Serialize DOM back using `XMLSerializer`
- Replace document.xml in zip and write output .docx

```javascript
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const config = require(path.join(__dirname, 'config.json'));

// Parse args
// Read and unzip notebook
// Parse document.xml into DOM
// Process districts 1-30
// Serialize and repack
```

- [ ] **Step 2: Add district and table location logic**

Implement the navigation functions:
- `findDistrictSections(doc)`: walk all `<w:p>` elements, find those whose text content matches `/Legislative District (\d+)/`, return an array of `{ district: N, paragraphNode }` sorted by district number
- `findCandidateTables(districtParagraph, doc)`: from the district paragraph's position in the document body, iterate through subsequent body-level child nodes (NOT siblings of the paragraph — `<w:tbl>` elements are siblings at the body level, not children of the paragraph). Walk forward from the paragraph's index in `doc.documentElement.childNodes` until two `<w:tbl>` nodes are found, stopping if another district heading is encountered. First `<w:tbl>` = House, second = Senate. Return `{ house: tblNode, senate: tblNode }`
- `identifyCandidateRows(tblNode)`: within a table, identify candidate data rows:
  - Primary: rows containing a `<w:color>` element in any `<w:rPr>`
  - Fallback: all `<w:tr>` elements after row index 1 (row 0 = spanning header, row 1 = column headers)
  - Return array of `<w:tr>` nodes
- `getCandidateName(trNode)`: extract text from first `<w:tc>` cell's `<w:t>` elements, concatenated

- [ ] **Step 3: Add row update logic**

Implement functions to modify existing candidate rows:
- `updateRowValues(trNode, candidate, partyColors)`:
  - Cell 0 (Name): update `<w:t>` text to `candidate.name`
  - Cell 1 (Financing): update to `candidate.financing` or `-`
  - Cell 2 (Income Total): update to `candidate.income_total` or `-`
  - Cell 3 (Income This Period): update to `candidate.income_this_period` or `-`
  - Cell 4 (Expenses Total): update to `candidate.expenses_total` or `-`
  - Cell 5 (Cash Balance): update to `candidate.cash_balance` or `-`
- `updateRowFormatting(trNode, candidate, partyColors)`:
  - Find all `<w:color>` elements in the row, set `w:val` attribute to the party color hex
  - If `candidate.incumbent`: ensure `<w:b/>` and `<w:bCs/>` exist in every `<w:rPr>` in the row
  - If not incumbent: remove `<w:b/>` and `<w:bCs/>` from every `<w:rPr>`
  - If `candidate.suspended`: ensure `<w:strike/>` exists in every `<w:rPr>`
  - If not suspended: remove `<w:strike/>` from every `<w:rPr>`

- [ ] **Step 4: Add new row creation (clone-based)**

Implement:
- `createNewRow(existingRow, candidate, partyColors)`:
  - Deep-clone `existingRow` node
  - Call `updateRowValues` and `updateRowFormatting` on the clone
  - Return the clone
- For insertion: find the last `<w:tr>` in the table, insert the new row after it (before `</w:tbl>`)
- **Edge case — empty table:** If a table has zero existing candidate rows to clone from (all were removed in a prior run), the script cannot create a new row by cloning. In this case: log a warning, flag the district+chamber as `empty_table_no_clone_source` in the validation report, and skip row additions for that table. The orchestrator's accuracy review will catch this and escalate to the user.

- [ ] **Step 5: Add row removal logic**

Implement:
- `removeRow(tblNode, trNode)`: simply call `tblNode.removeChild(trNode)`
- Only called when candidate has flag `suspended_nonincumbent` with `approved: true` in the flags array
- Cross-reference: match candidate by name + district + chamber against flags

- [ ] **Step 6: Add main processing loop and validation**

Wire everything together:
- Read `elections_data.json`
- Read flags array for removal approvals
- For each district 1-30:
  - Find district section
  - Find House and Senate tables
  - For each table/chamber:
    - Get existing candidate rows
    - Get candidates from JSON for this district+chamber
    - Match by name (normalized)
    - Update existing rows
    - Add new candidates not in existing rows
    - Remove approved-for-removal candidates
- Validation before writing:
  - Assert document is well-formed (XMLSerializer doesn't throw)
  - Assert all 30 districts still present
  - Assert no table has zero candidate rows
- Write output .docx
- Print validation report (districts processed, candidates updated/added/removed, formatting stats, file size comparison)

- [ ] **Step 7: Verify with the actual notebook**

Run against the most recent completed notebook (read-only — output to a temp location):
```bash
node scripts/update-docx.js --data "~/Desktop/Elections Notebook/elections_data.json" --notebook "~/Desktop/Elections Notebook/Completed Notebooks/[MOST_RECENT].docx" --output "~/Desktop/Elections Notebook/test_output.docx"
```

This will only work after a full data collection run. If `elections_data.json` doesn't exist yet, create minimal mock data for 2-3 districts to verify the XML parsing and manipulation logic works without corrupting the document. Open the output in Word to verify formatting is intact.

---

### Task 8: Write the new SKILL.md orchestrator

**Files:**
- Modify: `SKILL.md` (complete rewrite — save old version as `SKILL.md.bak` first)

- [ ] **Step 1: Back up existing SKILL.md**

```bash
cp "~/.claude/skills/elections-notebook/SKILL.md" "~/.claude/skills/elections-notebook/SKILL.md.bak"
```

- [ ] **Step 2: Write new SKILL.md**

Write the new orchestrator. Target ~80-100 lines. Structure:

```markdown
---
name: elections-notebook
description: >
  Updates the Arizona Legislative Elections Notebook (.docx) for DeMenna & Associates...
  [same trigger description as current]
---

# Elections Notebook Updater

## Constants
[paths derived from scripts/config.json — list NOTEBOOK_DIR, DATA_FILE, OUTPUT_DIR, PDF_DIR, SCRIPTS_DIR]

## Execution Steps

### Step 1 — Pre-flight
[verify notebook, pdftotext, node, npm deps]

### Step 2 — Scrape Candidates (Playwright)
[navigate to SOI_URL, wait for Cloudflare, run JS snippet, save to NOTEBOOK_DIR/soi_candidates.json, close browser]
[include the exact JS snippet from current SKILL.md]

### Step 3 — Collect Data
[run: node collect-data.js --candidates ... --output ...]

### Step 4 — Flag Review
[read flags, present grouped by type, record decisions]

### Step 5 — Download PDFs
[run: node download-pdfs.js]

### Step 6 — Extract Finance Data
[run: node run-extraction.js]

### Step 7 — Update Document
[run: node update-docx.js --data ... --notebook ... --output ...]

### Step 8 — Accuracy & Format Review
[unpack output docx, spot-check 5 random candidates, check low-confidence, structural check, edge cases]

### Step 9 — Retrospective
[collect issues, categorize, draft updates to pending-updates.md, present to user, apply approved after run]

### Step 10 — Report
[output location, summary, warnings]
```

Key differences from current SKILL.md:
- No Phase 1/2/3 subagent dispatch instructions
- No algorithmic prose (matching algorithms, XML templates, etc.)
- Each step says what command to run and what to check — the scripts contain the logic
- Playwright snippet for Step 2 is the ONLY code in the skill file

- [ ] **Step 3: Verify SKILL.md is complete and self-contained**

Read the new SKILL.md and verify:
- All 10 steps are present
- All script paths are correct
- The Playwright JS snippet is included
- Flag types and their handling are documented
- Accuracy review criteria are documented
- Retrospective process is documented
- No references to old Phase 1/2/3 subagent patterns

---

## Chunk 4: Integration Test + Final Verification

### Task 9: Full integration test

**Files:** None (testing only)

This task runs the complete pipeline end-to-end to verify everything works together.

- [ ] **Step 1: Run the skill manually, step by step**

Follow the new SKILL.md as the orchestrator would. Execute each step manually:

1. Pre-flight checks: `pdftotext -v && node -v && ls "~/.claude/skills/elections-notebook/scripts/node_modules"`
2. Playwright scrape: use Playwright MCP tools to scrape arizona.vote, save to `{NOTEBOOK_DIR}/soi_candidates.json`
3. Collect data: `node scripts/collect-data.js --candidates "..." --output "..."`
4. Flag review: read and inspect `elections_data.json` flags
5. Download PDFs: `node scripts/download-pdfs.js`
6. Extract finance: `node scripts/run-extraction.js`
7. Update docx: `node scripts/update-docx.js --data "..." --notebook "..." --output "..."`

- [ ] **Step 2: Verify output quality**

After step 7 completes:
- Open the output .docx in Word
- Spot-check 3 districts: verify candidate names, finance values, colors, bold/strikethrough
- Verify no formatting corruption
- Verify all 30 districts present with House + Senate tables
- Compare file size with input (should be within ±10%)

- [ ] **Step 3: Perform accuracy review (Step 8 from SKILL.md)**

Do the LLM-powered accuracy review:
- Unpack the output docx
- Pick 5 random candidates from elections_data.json
- Verify their values in the XML match
- Check all low-confidence candidates
- Structural check: 30 districts, 60 tables

- [ ] **Step 4: Document any issues found**

If issues are found during integration testing:
- Fix the relevant script
- Re-run the affected step
- Document what was fixed (this feeds into the retrospective pattern)

---

### Task 10: Cleanup

**Files:**
- Delete: `SKILL.md.bak` (after verifying new SKILL.md works)
- Delete: test files (`test_soi_candidates.json`, `test_output.json`, `test_output.docx`)

- [ ] **Step 1: Clean up test artifacts**

Remove any test files created during development:
```bash
rm -f "~/Desktop/Elections Notebook/test_soi_candidates.json"
rm -f "~/Desktop/Elections Notebook/test_output.json"
rm -f "~/Desktop/Elections Notebook/test_output.docx"
```

- [ ] **Step 2: Remove SKILL.md backup**

After confirming the new SKILL.md works correctly in the integration test:
```bash
rm "~/.claude/skills/elections-notebook/SKILL.md.bak"
```

- [ ] **Step 3: Final file structure verification**

Verify the final directory matches the spec:
```bash
ls -la "~/.claude/skills/elections-notebook/"
ls -la "~/.claude/skills/elections-notebook/scripts/"
```

Expected:
```
elections-notebook/
├── SKILL.md
├── specs/
│   ├── 2026-03-12-elections-notebook-redesign.md
│   └── 2026-03-12-elections-notebook-implementation-plan.md
└── scripts/
    ├── config.json
    ├── package.json
    ├── package-lock.json
    ├── node_modules/
    ├── collect-data.js
    ├── update-docx.js
    ├── download-pdfs.js
    ├── run-extraction.js
    └── extract-pdf.js
```

Note: `scripts/pending-updates.md` will appear after the first run that triggers the retrospective step — it is a generated artifact, not a source file.

---

## Execution Notes

**Task dependencies:**
- Task 1 must complete first (all other tasks depend on config + deps)
- Tasks 2-4 are sequential (building collect-data.js incrementally)
- Task 5 is independent of Tasks 2-4 (can run in parallel)
- Task 6 depends on Task 5 (run-extraction.js calls extract-pdf.js)
- Task 7 is independent of Tasks 2-6 (can be built against mock data)
- Task 8 depends on Tasks 2-7 (SKILL.md references all scripts)
- Task 9 depends on all prior tasks
- Task 10 depends on Task 9

**Parallelization opportunities:**
- After Task 1: Tasks 2+5+7 can start in parallel (collect-data, extract-pdf, update-docx are independent scripts)
- Task 6 starts after Task 5 completes
- Tasks 3-4 continue sequentially after Task 2

**Estimated effort:** Tasks 1-8 are the implementation work. Task 9 is the integration test. Task 10 is cleanup. The bulk of the work is in Tasks 2-4 (collect-data.js) and Task 7 (update-docx.js).
