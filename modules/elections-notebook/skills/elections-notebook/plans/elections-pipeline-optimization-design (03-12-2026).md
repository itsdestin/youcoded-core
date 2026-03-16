# Elections Notebook Pipeline Optimization — Spec (EXPERIMENTAL)

**Date:** 2026-03-12
**Status:** Approved by user — ready for implementation
**Label:** EXPERIMENTAL — does not replace existing scripts

## Problem

The current pipeline runs 4 sequential scripts with no concurrency within or between phases:
- `collect-data.js` fetches ~140 report lists one-at-a-time (200ms delay each = ~56s in delays alone)
- `download-pdfs.js` downloads PDFs sequentially (300ms delay each = ~50s)
- `run-extraction.js` runs `pdftotext` synchronously via `execSync` (~50s)
- `update-docx.js` is already fast (~2s) but waits for all prior phases

Total script time: ~3+ minutes. With LLM overhead (Playwright, flag review, accuracy review), full runs take 15+ minutes.

## Solution

Merge all four scripts into a single streaming pipeline (`pipeline (EXPERIMENTAL).js`) that:
1. Does bulk setup once (rosters, finance entities, matching, incumbents) — ~2-4 seconds
2. Streams each candidate through fetch-report → download-PDF → extract-data using a concurrency pool of 10 workers — ~10-15 seconds for ~140 candidates
3. Updates the docx in a single pass after all data is collected — ~2 seconds

**Estimated total script time: 15-20 seconds** (vs ~3+ minutes sequential).

## Architecture

```
pipeline (EXPERIMENTAL).js
│
├─ Phase A: Bulk Setup (sequential, fast)
│   ├─ Parse candidates from input JSON
│   ├─ Fetch rosters (2 parallel GETs)
│   ├─ Fetch finance entities (2 parallel POSTs)
│   ├─ Match candidates to entities (CPU, instant)
│   └─ Detect incumbents (CPU, instant)
│
├─ Phase B: Per-Candidate Pipeline (10 concurrent workers)
│   │  For each candidate with a matched entity:
│   ├─ Fetch report list (GET)
│   ├─ Download PDF (GET, with retry)
│   ├─ Verify PDF integrity (%PDF header)
│   └─ Extract finance data (pdftotext → parse)
│
├─ Phase C: Docx Update (single pass)
│   ├─ Read source notebook via JSZip
│   ├─ Parse document.xml via @xmldom/xmldom
│   ├─ Update/add/remove candidate rows
│   ├─ Validate XML well-formedness
│   └─ Write output .docx
│
└─ Output: elections_data.json + updated .docx
```

## Concurrency Model

- **Phase A:** 2 parallel roster GETs + 2 parallel entity POSTs = 4 concurrent HTTP calls
- **Phase B:** Pool of N workers (configurable, default 10). Each worker takes one candidate from the queue and runs fetch→download→extract sequentially for that candidate. Workers run concurrently with each other. A 50ms stagger between worker launches prevents thundering herd on the API.
- **Phase C:** Single-threaded (DOM manipulation is inherently sequential)

### Rate Limiting

The pool size itself acts as the rate limiter. With 10 concurrent workers, each doing ~700ms of work per candidate, the effective request rate is ~14 requests/second — well below any reasonable rate limit for these government APIs. No additional per-request delays needed within a worker.

A small inter-batch delay (50ms between launching workers) prevents all 10 workers from hitting the same API endpoint simultaneously.

## Interface

```
node "pipeline (EXPERIMENTAL).js" \
  --candidates <path-to-soi-candidates.json> \
  --notebook <path-to-source.docx> \
  --output <path-for-output.docx> \
  --data <path-for-elections-data.json>
```

All paths are absolute, passed by the orchestrator. The script:
1. Writes `elections_data.json` (with flags) after Phase B
2. Pauses and exits with code 0 if `--pause-for-flags` is passed and flags exist
3. Resumes from existing `elections_data.json` if `--resume` is passed (skips Phases A+B)
4. Writes the output .docx after Phase C

### Flag Review Integration

The pipeline supports a two-pass execution model for flag review:

**Pass 1:** `--pause-for-flags`
- Runs Phases A + B
- Writes `elections_data.json` with all flags
- Prints flag summary to stdout
- Exits with code 0 (the orchestrator reads flags and does interactive review)

**Pass 2:** `--resume`
- Reads the (possibly modified) `elections_data.json`
- Skips Phases A + B entirely
- Runs Phase C only (docx update)
- Writes output .docx

This keeps the LLM in control of flag review without the pipeline needing interactive I/O.

## Code Reuse

The script consolidates logic from all four existing scripts. Key functions are copied and adapted (not imported, to keep the experimental script self-contained):

| Source | Functions reused |
|---|---|
| `collect-data.js` | `httpGet`, `httpPost`, `normalizeName`, `parseCandidates`, `fetchRosters`, `fetchFinanceEntities`, `matchCandidates`, `detectIncumbents`, `fetchReports`, `batchParallel` |
| `download-pdfs.js` | `downloadFile` (adapted for concurrency + retry + integrity check) |
| `extract-pdf.js` | All extraction logic (label-anchored + positional fallback) |
| `update-docx.js` | All XML DOM helpers, district/table location, row update/create/remove, validation |

## Progress Output

```
=== Elections Notebook Pipeline (EXPERIMENTAL) ===
[Phase A] Bulk setup...
  Parsed 147 candidates (0 unparseable, 2 duplicates removed)
  Rosters: 60 house + 30 senate members
  Finance entities: 234 active + 89 less-active = 298 unique
  Matched: 139/147 (8 no-match)
  Incumbents: 72 exact + 3 fuzzy
[Phase B] Processing 112 candidates (10 concurrent)...
  [  10/112] ██░░░░░░░░  9%   Smith, John (LD12 house)
  [  50/112] █████░░░░░ 45%   Garcia, Maria (LD7 senate)
  [ 112/112] ██████████ 100%  Done.
  Reports: 112, PDFs: 94 downloaded (18 skipped), Extracted: 91 (3 failed)
[Phase C] Updating docx...
  Districts: 30/30, Updated: 87, Added: 4, Removed: 1
  Output: 245KB (original: 241KB, +1.6%)
  Validation: PASS

Flags: 14 (8 no_match, 3 fuzzy_incumbent, 2 suspended_nonincumbent, 1 extraction_error)
Total time: 18.4 seconds
```

## Files Created

```
elections-notebook/
├── scripts/
│   ├── pipeline (EXPERIMENTAL).js    ← NEW: single streaming pipeline
│   └── ... (all existing scripts untouched)
├── SKILL (EXPERIMENTAL).md           ← NEW: slim orchestrator
└── specs/
    └── 2026-03-12-pipeline-optimization-design.md  ← NEW: this file
```

## Success Criteria

1. **Speed:** Full script execution in under 30 seconds (vs ~3+ minutes)
2. **Correctness:** Produces identical `elections_data.json` and equivalent `.docx` output as the sequential scripts
3. **Isolation:** Zero changes to existing files — can be deleted without side effects
4. **Transparency:** Real-time progress output with timing
