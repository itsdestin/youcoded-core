---
name: elections-notebook
description: >
  Updates the Arizona Legislative Elections Notebook (.docx) for DeMenna & Associates with current
  candidate and campaign finance data for all 30 State Legislative Districts. Use this skill whenever
  the user asks to update, refresh, or run the Elections Notebook, mentions candidates or campaign
  finance for legislative districts, or asks to pull data from arizona.vote or seethemoney.az.gov.
  Also trigger when the user says "run the notebook," "update the elections doc," or "pull campaign
  finance data."
---
<!-- SPEC: Read specs/elections-notebook-spec.md before modifying this file -->

# Elections Notebook Updater

Single-script streaming pipeline with concurrent per-candidate processing.

## Constants

```
NOTEBOOK_DIR    = ~/Desktop/Elections Notebook
OUTPUT_DIR      = {NOTEBOOK_DIR}/Completed Notebooks
PIPELINE_DIR    = {NOTEBOOK_DIR}/Pipeline Data
DATA_FILE       = {PIPELINE_DIR}/elections_data.json
FLAG_CACHE      = {PIPELINE_DIR}/flag_decisions_cache.json
PDF_DIR         = {NOTEBOOK_DIR}/Campaign Finance PDFs
PIPELINE_SCRIPT = ~/.claude/skills/elections-notebook/scripts/pipeline.js
SOI_URL         = https://apps.arizona.vote/electioninfo/SOI/68
```

## Execution Steps

### Step 1 — Pre-flight

1. Find the most recent `.docx` in `OUTPUT_DIR` → `{NOTEBOOK_FILE}`
2. Verify: `pdftotext -v` (bundled with Git for Windows — use bash, not PowerShell, to find it), `node -v`
3. Verify: `scripts/node_modules/` exists (if not, run `npm install` in scripts dir)
4. If any check fails, report and stop

### Step 2 — Scrape Candidates (Playwright)

Navigate to `SOI_URL` using Playwright MCP tools with Cloudflare retry handling:

1. Open browser, navigate to `https://apps.arizona.vote/electioninfo/SOI/68`
2. Wait 10 seconds, then check if page title contains "Statements of Interest" OR if `#myTable` is present
3. If the page loaded successfully → skip to step 4 (Extract candidates)
   If still on Cloudflare challenge page:
   a. Wait 5 more seconds
   b. Try clicking at approximate Turnstile checkbox coordinates (center of the challenge widget)
   c. Wait 5 seconds, check again for `#myTable`
   d. If still blocked: navigate to `SOI_URL` again (fresh `page.goto()` — the second navigation typically auto-resolves because the browser has accumulated enough Turnstile signals)
   e. Wait 10 seconds, check again
   f. Repeat up to 3 total navigation attempts
   g. If all attempts fail: report "Cloudflare is blocking access to apps.arizona.vote" and stop
4. Extract candidates:

```javascript
const rows = document.querySelectorAll('#myTable tbody tr');
const candidates = Array.from(rows).map(row => {
  const cells = row.querySelectorAll('td');
  return {
    office: cells[0]?.textContent.trim(),
    name: cells[1]?.textContent.trim(),
    party: cells[2]?.textContent.trim(),
    campaignInfo: cells[3]?.textContent.trim(),
    filedDate: cells[4]?.textContent.trim()
  };
}).filter(c =>
  c.office.includes('State Representative') || c.office.includes('State Senator')
);
candidates;
```

**Extracting evaluate results:** Playwright's `browser_evaluate` returns a JSON wrapper array with a `text` field containing `### Result\n` prefix and `### Ran Playwright code` suffix. For large outputs, results are persisted to a file. Use the helper script to parse it:

```bash
node "~/.claude/skills/elections-notebook/scripts/parse-playwright.js" \
  --input <persisted-file> --output "{PIPELINE_DIR}/soi_candidates.json"
```

This handles all wrapper formats (array with text field, raw text, direct JSON).

4. Parse each candidate:
   - **Party:** Record exactly as shown. **This is the authoritative source for candidate party affiliation and color coding.** The party from the SOI page determines the color applied to all of the candidate's text in the notebook (see Party Color Map). Do NOT use the `PartyName` field from the finance API — use only the SOI party.
5. Save result to `{PIPELINE_DIR}/soi_candidates.json`
6. Close browser
7. Report candidate count

### Step 3 — Run Pipeline (Pass 1: Data Collection)

```bash
node "~/.claude/skills/elections-notebook/scripts/pipeline.js" \
  --candidates "{PIPELINE_DIR}/soi_candidates.json" \
  --notebook "{NOTEBOOK_FILE}" \
  --output "{OUTPUT_DIR}/Elections_Notebook_{YYYY-MM-DD}.docx" \
  --data "{DATA_FILE}" \
  --pause-for-flags
```

This runs Phases A (bulk setup) + B (per-candidate fetch/download/extract) and writes `elections_data.json`. Let progress output stream to the user.

### elections_data.json Schema

```json
{
  "run_date": "YYYY-MM-DD",
  "districts": {
    "1": {
      "senate": [
        {
          "name": "string",
          "party": "string",
          "incumbent": "boolean",
          "suspended": "boolean",
          "financing": "Public|Private|-",
          "entity_id": "number|null",
          "pdf_url": "string|null",
          "pdf_filename": "string|null",
          "filing_date": "string|null",
          "cash_balance": "string (e.g. '$1,750.00') | '-'",
          "income_this_period": "string | '-'",
          "income_total": "string | '-'",
          "expenses_total": "string | '-'",
          "low_confidence_fields": ["string"]
        }
      ],
      "house": [/* same structure */]
    },
    "2": { "..." : "..." },
    "...": "...",
    "30": { "..." : "..." }
  },
  "flags": [/* see Flag Object Schemas */]
}
```

### Step 4 — Flag Review (Interactive)

**Flag Decision Cache:** The pipeline automatically caches flag decisions in `{FLAG_CACHE}`. On each run, previously decided flags are auto-applied and marked `(cached)` in the review output. Only new/unseen flags need manual decisions. New decisions are saved to the cache when applied via `--apply-flag` or `--apply-flags`.

First, display all flags grouped by type:

```bash
node "~/.claude/skills/elections-notebook/scripts/pipeline.js" \
  --data "{DATA_FILE}" --review-flags
```

Present the output to the user. For each actionable flag group, ask the user for decisions:

- **`no_match`**: Informational only — no action needed
- **`no_active`**: Informational only — no action needed
- **`suspended_nonincumbent`**: Informational only — suspended/terminated candidates are always kept in the notebook with strikethrough applied to the entire row. Do not ask the user.
- **`fuzzy_entity_match`**: Ask confirm/reject for each (shows candidate name, entity name, match method, distance)
- **`fuzzy_incumbent_match`**: Ask confirm/reject for each. Note `auto_set` status:
  - **`auto_set: true`** (first_initial_and_last_name, substring_containment): Incumbent already set. If rejected, Phase C will unset it.
  - **`auto_set: false`** (last_name_only): Incumbent NOT set. If confirmed, Phase C will set it.
- **`multiple_active`**: Ask which entity to use (requires direct JSON edit for `chosen_entity_id`)
- **`pipeline_error`**: Report any processing errors

Apply decisions using the pipeline's built-in flag tools:

```bash
# Single flag
node pipeline.js --data "{DATA_FILE}" --apply-flag <index> --action confirm|reject

# Batch (JSON file with [{index, action}])
node pipeline.js --data "{DATA_FILE}" --apply-flags <decisions.json>
```

#### Flag Object Schemas

```json
{
  "no_match": {
    "type": "no_match",
    "candidate_name": "string",
    "district": "number",
    "chamber": "house|senate",
    "party": "string"
  },
  "no_active": {
    "type": "no_active",
    "candidate_name": "string",
    "district": "number",
    "chamber": "house|senate",
    "entity_ids": ["number"]
  },
  "fuzzy_incumbent_match": {
    "type": "fuzzy_incumbent_match",
    "candidate_name": "string",
    "roster_name": "string",
    "district": "number",
    "chamber": "house|senate",
    "match_method": "first_initial_and_last_name|substring_containment|last_name_only",
    "auto_set": "boolean"
  },
  "fuzzy_entity_match": {
    "type": "fuzzy_entity_match",
    "candidate_name": "string",
    "district": "number",
    "chamber": "house|senate",
    "potential_entity_id": "number",
    "potential_entity_name": "string",
    "match_method": "nickname|levenshtein",
    "distance": "number (levenshtein only)",
    "auto_set": false
  },
  "suspended_nonincumbent": {
    "type": "suspended_nonincumbent",
    "candidate_name": "string",
    "district": "number",
    "chamber": "house|senate"
  },
  "multiple_active": {
    "type": "multiple_active",
    "candidate_name": "string",
    "district": "number",
    "chamber": "house|senate",
    "entity_ids": ["number"]
  },
  "pipeline_error": {
    "type": "pipeline_error",
    "candidate_name": "string",
    "district": "number",
    "chamber": "house|senate",
    "status": "string",
    "error": "string",
    "pdf_url": "string|null",
    "entity_id": "number|null"
  }
}
```

### Step 5 — Run Pipeline (Pass 2: Docx Update)

```bash
node "~/.claude/skills/elections-notebook/scripts/pipeline.js" \
  --notebook "{NOTEBOOK_FILE}" \
  --output "{OUTPUT_DIR}/Elections_Notebook_{YYYY-MM-DD}.docx" \
  --data "{DATA_FILE}" \
  --resume
```

This runs Phase C only (docx update + automated table spacing/layout fixes) using the reviewed data.

### Step 6 — Accuracy & Format Review

Run the automated spot-check:

```bash
node "~/.claude/skills/elections-notebook/scripts/pipeline.js" \
  --data "{DATA_FILE}" --verify "{OUTPUT_DIR}/Elections_Notebook_{YYYY-MM-DD}.docx" [--count 5]
```

This checks 5 random candidates (with finance data) for: name match, all finance values, party color, bold/incumbent, strikethrough/suspended, and "Last Edited" date.

Then manually verify:
1. Scrutinize all candidates with non-empty `low_confidence_fields` — these used positional fallback extraction and may have incorrect values. This is expected behavior for PDFs with non-standard layouts.
2. Structural check: 30 districts, each with House + Senate tables
3. Edge cases: no-match candidates show `-`, approved removals gone, confirmed fuzzy incumbents bolded
4. If issues found: fix and re-check
5. If unfixable: escalate to user

### Step 7 — Retrospective

1. Collect all issues from the run
2. Categorize as one-off or systemic
3. For systemic: draft concrete code changes to `scripts/pending-updates.md`
4. Present proposed updates to user
5. Apply approved updates after run is complete

### Step 8 — Report

- Output file location
- Summary stats
- Any remaining warnings
- Suggest opening in Word to verify
- **Report total pipeline execution time** (shown by the script itself)

---
**System rules:** If this skill or its supporting files are modified, follow the System Change Protocol in `CLAUDE.md` and the System Change Checklist in `~/.claude/docs/system.md`. All items are mandatory.

## Party Color Map

| Party | Hex |
|---|---|
| Republican | `FF0000` |
| Democrat | `0432FF` |
| Libertarian | `FFC000` |
| Green / Other | `008000` |
| No Labels / Independent / Arizona Independent | `E36C0A` |
| Unknown / Unaffiliated | `000000` |

## No-Data Rules

| Situation | Financing | Finance Fields | PDF |
|---|---|---|---|
| Not found in API | `-` | `-` for all | None |
| Found but no Active entry | `-` | `-` for all | None |
| Active entry, no 2026 report | Public/Private | `-` for all | None |
| Active entry + valid 2026 report | Public/Private | Extract from PDF | Download |

**Filer Type (Financing column):** "Candidate (not participating in Clean Elections)" = Private, "Candidate (participating in Clean Elections)" = Public. The `EntityTypeName` field from the search API (`GetNEWTableData`) is the sole source of truth. Do NOT infer Public/Private from any other field.

## Troubleshooting

### Cloudflare Turnstile Challenge on apps.arizona.vote
The SOI page at `apps.arizona.vote` is behind Cloudflare Turnstile. On first navigation, the browser may hit a "Verify you are human" challenge page instead of the SOI table. The Turnstile checkbox is inside a shadow DOM/iframe and is not directly clickable via standard Playwright selectors.

**What works:** Navigating a second time (`page.goto(SOI_URL)` again) after ~8-10 seconds usually causes Cloudflare to auto-resolve on the retry, because the browser session has accumulated enough Turnstile signals from the first visit. The Step 2 retry loop implements this pattern with up to 3 navigation attempts.

**If all retries fail:** Cloudflare may be in a heightened security mode. Try again after a few minutes, or use a different browser profile.
