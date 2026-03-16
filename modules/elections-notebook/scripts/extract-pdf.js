#!/usr/bin/env node
// extract-pdf.js — Extracts campaign finance data from AZ seethemoney.az.gov PDF reports
// Usage: node extract-pdf.js <path-to-pdf>
// Output: JSON with { cash_balance, income_this_period, income_total, expenses_total }
//
// Extraction strategy:
//   Page 1 (cash_balance): Use -layout mode for ordered amounts from Summary of Finances.
//     The 4 amounts in order are: beginning, receipts, disbursements, end balance.
//     If only 3 amounts (end balance missing), compute it from the other three.
//   Page 2 (income/expenses): Positional extraction from post-Covers sections split by
//     "Total to Date". Section 0 = income this period (12 amounts, last = Total Income),
//     Section 1 = income totals (12), Section 2 = expense totals (9).
//     High confidence when section has expected count; low confidence otherwise.

const { execFileSync } = require('child_process');
const fs = require('fs');

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error(JSON.stringify({ error: 'Usage: node extract-pdf.js <path-to-pdf>' }));
  process.exit(1);
}
if (!fs.existsSync(pdfPath)) {
  console.error(JSON.stringify({ error: `File not found: ${pdfPath}` }));
  process.exit(1);
}

const result = {
  cash_balance: null,
  income_this_period: null,
  income_total: null,
  expenses_total: null
};
const lowConfidenceFields = [];
const errors = [];

/**
 * Find all dollar amounts in text.
 * Matches: ($1,234.56) | $1,234.56 | -$1,234.56
 * Converts accounting-style ($X) to -$X.
 */
function findDollarAmounts(text) {
  return [...text.matchAll(/(?:\(\$[\d,]+\.\d{2}\)|\$[\d,]+\.\d{2}|-\$[\d,]+\.\d{2})/g)].map(m => {
    const raw = m[0];
    if (raw.startsWith('(') && raw.endsWith(')')) {
      return '-' + raw.slice(1, -1);
    }
    return raw;
  });
}

// =============================================================================
// Page 1: Cash Balance at End of Reporting Period
// =============================================================================
try {
  const page1 = execFileSync('pdftotext', ['-layout', '-f', '1', '-l', '1', pdfPath, '-'], { encoding: 'utf8' });

  const summaryIdx = page1.indexOf('Summary of Finances');
  if (summaryIdx !== -1) {
    const afterSummary = page1.substring(summaryIdx);
    const amounts = findDollarAmounts(afterSummary);
    // Layout mode preserves order: [beginning, receipts, disbursements, end]
    if (amounts.length >= 4) {
      result.cash_balance = amounts[3];
    } else if (amounts.length === 3) {
      // End balance missing from PDF — compute: end = beginning + receipts - disbursements
      const parse = (s) => parseFloat(s.replace(/[$,]/g, ''));
      const beginning = parse(amounts[0]);
      const receipts = parse(amounts[1]);
      const disbursements = parse(amounts[2]);
      if (!isNaN(beginning) && !isNaN(receipts) && !isNaN(disbursements)) {
        const end = beginning + receipts - disbursements;
        result.cash_balance = (end < 0 ? '-' : '') + '$' + Math.abs(end).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        lowConfidenceFields.push('cash_balance');
      } else {
        result.cash_balance = amounts[amounts.length - 1];
        lowConfidenceFields.push('cash_balance');
      }
    } else if (amounts.length > 0) {
      result.cash_balance = amounts[amounts.length - 1];
      lowConfidenceFields.push('cash_balance');
    } else {
      errors.push('Page 1: No dollar amounts found after "Summary of Finances"');
    }
  } else {
    errors.push('Page 1: Could not find "Summary of Finances"');
  }
} catch (e) {
  errors.push(`Page 1 extraction failed: ${e.message}`);
}

// =============================================================================
// Page 2: Income and Expenses from Summary of Activity
// =============================================================================
try {
  const page2 = execFileSync('pdftotext', ['-f', '2', '-l', '2', pdfPath, '-'], { encoding: 'utf8' });

  const coversMatch = page2.match(/Covers \d{2}\/\d{2}\/\d{4} to \d{2}\/\d{2}\/\d{4}/);
  const coversIdx = coversMatch ? page2.indexOf(coversMatch[0]) : -1;
  const afterCovers = coversIdx !== -1 ? page2.substring(coversIdx) : page2;
  const sections = afterCovers.split('Total to Date');

  // Section 0 (before 1st "Total to Date"): income this-period amounts
  // Standard layout has 12 amounts; the 12th (index 11) = Total Income this period
  if (sections.length >= 1) {
    const section0Amounts = findDollarAmounts(sections[0]);
    if (section0Amounts.length >= 12) {
      result.income_this_period = section0Amounts[11];
    } else if (section0Amounts.length > 0) {
      result.income_this_period = section0Amounts[section0Amounts.length - 1];
      lowConfidenceFields.push('income_this_period');
    }
  }

  // Section 1 (1st "Total to Date" block): first 12 amounts = income totals
  if (sections.length >= 2) {
    const section1Amounts = findDollarAmounts(sections[1]);
    if (section1Amounts.length >= 12) {
      result.income_total = section1Amounts[11];
    } else if (section1Amounts.length > 0) {
      result.income_total = section1Amounts[section1Amounts.length - 1];
      lowConfidenceFields.push('income_total');
    }
  }
  if (!result.income_total) {
    errors.push('Page 2: Failed to extract income_total');
  }

  // Section 2 (2nd "Total to Date" block): expense totals
  // Standard layout has 9 amounts; second-to-last (index length-2) = Total Expenditures
  if (sections.length >= 3) {
    const section2Amounts = findDollarAmounts(sections[2]);
    if (section2Amounts.length >= 9) {
      result.expenses_total = section2Amounts[section2Amounts.length - 2];
    } else if (section2Amounts.length >= 2) {
      result.expenses_total = section2Amounts[section2Amounts.length - 2];
      lowConfidenceFields.push('expenses_total');
    } else if (section2Amounts.length === 1) {
      result.expenses_total = section2Amounts[0];
      lowConfidenceFields.push('expenses_total');
    }
  }
  if (!result.expenses_total) {
    errors.push('Page 2: Failed to extract expenses_total');
  }

  if (sections.length < 2 && !result.income_this_period) {
    errors.push('Page 2: Could not find "Total to Date" sections');
  }
  if (sections.length < 3 && !result.expenses_total) {
    errors.push('Page 2: No expense "Total to Date" section found');
  }
} catch (e) {
  errors.push(`Page 2 extraction failed: ${e.message}`);
}

// =============================================================================
// Output
// =============================================================================
if (lowConfidenceFields.length > 0) result.low_confidence_fields = lowConfidenceFields;
if (errors.length > 0) result.errors = errors;
console.log(JSON.stringify(result, null, 2));
