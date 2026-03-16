// run-extraction.js — Extracts finance data from downloaded campaign finance PDFs
// Usage: node run-extraction.js
//
// Reads elections_data.json, runs extract-pdf.js on each candidate's PDF,
// updates the JSON with extracted values, and writes it back to disk.

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const DATA_FILE = '~/Desktop/Elections Notebook/elections_data.json';
const EXTRACT_SCRIPT = '~/.claude/skills/elections-notebook/scripts/extract-pdf.js';
const PDF_BASE_DIR = '~/Desktop/Elections Notebook/Campaign Finance PDFs';

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

let processed = 0, succeeded = 0, failed = 0;
const errors = [];

for (const [dist, chambers] of Object.entries(data.districts)) {
  for (const [chamber, candidates] of Object.entries(chambers)) {
    for (const c of candidates) {
      if (!c.pdf_filename) continue;

      const pdfPath = path.join(PDF_BASE_DIR, 'LD' + dist, c.pdf_filename);
      if (!fs.existsSync(pdfPath)) {
        console.log(`MISSING: ${pdfPath}`);
        c.cash_balance = '-';
        c.income_this_period = '-';
        c.income_total = '-';
        c.expenses_total = '-';
        failed++;
        errors.push({ name: c.name, district: dist, chamber, error: 'PDF file not found' });
        processed++;
        continue;
      }

      try {
        const result = execSync(`node "${EXTRACT_SCRIPT}" "${pdfPath}"`, { encoding: 'utf8', timeout: 30000 });
        const extracted = JSON.parse(result.trim());

        if (extracted.errors && extracted.errors.length > 0) {
          console.log(`EXTRACT_ERROR: ${c.name} (LD${dist} ${chamber}): ${extracted.errors.join(', ')}`);
          c.cash_balance = '-';
          c.income_this_period = '-';
          c.income_total = '-';
          c.expenses_total = '-';
          failed++;
          errors.push({ name: c.name, district: dist, chamber, error: extracted.errors.join(', ') });
        } else {
          c.cash_balance = extracted.cash_balance || '-';
          c.income_this_period = extracted.income_this_period || '-';
          c.income_total = extracted.income_total || '-';
          c.expenses_total = extracted.expenses_total || '-';
          succeeded++;
        }
      } catch (e) {
        console.log(`FAIL: ${c.name} (LD${dist} ${chamber}): ${e.message.split('\n')[0]}`);
        c.cash_balance = '-';
        c.income_this_period = '-';
        c.income_total = '-';
        c.expenses_total = '-';
        failed++;
        errors.push({ name: c.name, district: dist, chamber, error: e.message.split('\n')[0] });
      }
      processed++;
    }
  }
}

// Add extraction errors to flags
for (const err of errors) {
  data.flags.push({ type: 'extraction_error', name: err.name, district: parseInt(err.district), chamber: err.chamber, error: err.error });
}

fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
console.log(`\nDone. Processed: ${processed}, Succeeded: ${succeeded}, Failed: ${failed}`);

// Spot check — print 3 candidates with extracted values
const spotCheck = [];
for (const [dist, chambers] of Object.entries(data.districts)) {
  for (const [chamber, candidates] of Object.entries(chambers)) {
    for (const c of candidates) {
      if (c.cash_balance && c.cash_balance !== '-' && c.cash_balance !== null) {
        spotCheck.push({ name: c.name, district: dist, cash_balance: c.cash_balance, income_total: c.income_total });
        if (spotCheck.length >= 3) break;
      }
    }
    if (spotCheck.length >= 3) break;
  }
  if (spotCheck.length >= 3) break;
}
console.log('\nSpot check:');
spotCheck.forEach(s => console.log(`  ${s.name} (LD${s.district}): cash=${s.cash_balance}, income=${s.income_total}`));
