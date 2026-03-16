// update-docx.js — Updates Elections Notebook .docx with candidate finance data
// Usage: node update-docx.js --data <path> --notebook <path> --output <path>
//
// Reads elections_data.json and an existing .docx notebook, updates candidate
// rows in each of 30 district tables with current finance data and formatting,
// writes the updated .docx.

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const PARTY_COLORS = config.party_colors;

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    opts[key] = args[i + 1];
  }
  if (!opts.data || !opts.notebook || !opts.output) {
    console.error('Usage: node update-docx.js --data <path> --notebook <path> --output <path>');
    process.exit(1);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/** Get all descendant elements with a given local name. */
function getElementsByLocalName(node, localName) {
  const results = [];
  const children = node.childNodes;
  if (!children) return results;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1) { // ELEMENT_NODE
      if (child.localName === localName) results.push(child);
      results.push(...getElementsByLocalName(child, localName));
    }
  }
  return results;
}

/** Get direct child elements with a given local name and namespace. */
function getChildElements(parent, localName, ns) {
  const results = [];
  const children = parent.childNodes;
  if (!children) return results;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1 && child.localName === localName) {
      if (!ns || child.namespaceURI === ns) results.push(child);
    }
  }
  return results;
}

/** Get combined text content of a node by walking w:r > w:t elements. */
function getWordText(node) {
  const textEls = getElementsByLocalName(node, 't');
  let text = '';
  for (const t of textEls) {
    if (t.namespaceURI === W_NS || !t.namespaceURI) {
      text += t.textContent || '';
    }
  }
  return text;
}

/** Get combined text from the first cell of a row. */
function getCellText(row) {
  const cells = getChildElements(row, 'tc', W_NS);
  if (cells.length === 0) return '';
  return getWordText(cells[0]).trim();
}

/** Check if a row has any <w:color> elements in <w:rPr> nodes. */
function rowHasColor(row) {
  const rPrs = getElementsByLocalName(row, 'rPr');
  for (const rPr of rPrs) {
    if (rPr.namespaceURI !== W_NS && rPr.namespaceURI) continue;
    const colors = getChildElements(rPr, 'color', W_NS);
    if (colors.length > 0) return true;
  }
  return false;
}

/** Get all w:tr rows in a table. */
function getTableRows(tbl) {
  return getChildElements(tbl, 'tr', W_NS);
}

/** Set text in a cell (first w:t gets the value, extras are removed). */
function setCellText(cell, text, doc) {
  const runs = getElementsByLocalName(cell, 'r');
  if (runs.length === 0) {
    // Create a run with a text element
    const p = getElementsByLocalName(cell, 'p')[0];
    if (!p) return;
    const r = doc.createElementNS(W_NS, 'w:r');
    const t = doc.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = text;
    r.appendChild(t);
    p.appendChild(r);
    return;
  }

  let firstTextSet = false;
  for (const r of runs) {
    const tEls = getChildElements(r, 't', W_NS);
    for (const t of tEls) {
      if (!firstTextSet) {
        t.textContent = text;
        t.setAttribute('xml:space', 'preserve');
        firstTextSet = true;
      } else {
        t.textContent = '';
      }
    }
  }

  if (!firstTextSet) {
    // Runs exist but no <w:t> — add one to the first run
    const t = doc.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = text;
    runs[0].appendChild(t);
  }
}

/** Ensure an element exists as child of parent; create if missing. */
function ensureElement(parent, localName, doc) {
  const existing = getChildElements(parent, localName, W_NS);
  if (existing.length > 0) return existing[0];
  const el = doc.createElementNS(W_NS, 'w:' + localName);
  // Insert formatting elements before w:t elements — rPr should be first child of r
  // But since we call this on rPr children, just append
  parent.appendChild(el);
  return el;
}

/** Remove all child elements with given localName from parent. */
function removeElements(parent, localName) {
  const toRemove = getChildElements(parent, localName, W_NS);
  for (const el of toRemove) {
    parent.removeChild(el);
  }
}

/** Set the color on all w:rPr elements in a row. */
function setRowColor(row, hexColor, doc) {
  const rPrs = getAllRPrs(row, doc);
  for (const rPr of rPrs) {
    let colorEls = getChildElements(rPr, 'color', W_NS);
    if (colorEls.length > 0) {
      colorEls[0].setAttributeNS(W_NS, 'w:val', hexColor);
    } else {
      const colorEl = doc.createElementNS(W_NS, 'w:color');
      colorEl.setAttributeNS(W_NS, 'w:val', hexColor);
      rPr.appendChild(colorEl);
    }
  }
}

/** Get or create w:rPr for every w:r in the row. */
function getAllRPrs(row, doc) {
  const runs = getElementsByLocalName(row, 'r');
  const rPrs = [];
  for (const r of runs) {
    if (r.namespaceURI !== W_NS && r.namespaceURI) continue;
    let rPr = getChildElements(r, 'rPr', W_NS)[0];
    if (!rPr) {
      rPr = doc.createElementNS(W_NS, 'w:rPr');
      r.insertBefore(rPr, r.firstChild);
    }
    rPrs.push(rPr);
  }
  return rPrs;
}

/** Set bold on all rPr elements in a row. */
function setBold(row, bold, doc) {
  const rPrs = getAllRPrs(row, doc);
  for (const rPr of rPrs) {
    if (bold) {
      ensureElement(rPr, 'b', doc);
      ensureElement(rPr, 'bCs', doc);
    } else {
      removeElements(rPr, 'b');
      removeElements(rPr, 'bCs');
    }
  }
}

/** Set strikethrough on all rPr elements in a row. */
function setStrike(row, strike, doc) {
  const rPrs = getAllRPrs(row, doc);
  for (const rPr of rPrs) {
    if (strike) {
      ensureElement(rPr, 'strike', doc);
    } else {
      removeElements(rPr, 'strike');
    }
  }
}

/** Format a finance value for display. */
function fmtVal(val) {
  if (val === null || val === undefined || val === '') return '-';
  return String(val);
}

/** Get party color hex. */
function partyColor(party) {
  return PARTY_COLORS[party] || PARTY_COLORS['default'] || '000000';
}

/** Normalize a name for matching (lowercase, collapse whitespace, strip punctuation). */
function normalizeName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Strip floating table positioning (w:tblpPr) from a table's w:tblPr.
 * Converts a floating table to an inline table so it paginates naturally
 * and doesn't overflow into the page header.
 */
function stripFloatingPosition(tbl) {
  const tblPrs = getChildElements(tbl, 'tblPr', W_NS);
  for (const tblPr of tblPrs) {
    const tblpPrs = getChildElements(tblPr, 'tblpPr', W_NS);
    for (const tblpPr of tblpPrs) {
      tblPr.removeChild(tblpPr);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  // Load data
  const data = JSON.parse(fs.readFileSync(opts.data, 'utf8'));

  // Read notebook docx
  const docxBuffer = fs.readFileSync(opts.notebook);
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXmlText = await zip.file('word/document.xml').async('string');

  const domParser = new DOMParser();
  const doc = domParser.parseFromString(docXmlText, 'application/xml');

  // Stats
  const stats = {
    districtsProcessed: 0,
    candidatesUpdated: 0,
    candidatesAdded: 0,
    candidatesRemoved: 0,
    strikethroughApplied: 0,
    boldApplied: 0,
    addedDetails: [],
    removedDetails: [],
    warnings: []
  };

  // Build removal set from flags
  const removalSet = new Set();
  if (data.flags) {
    for (const flag of data.flags) {
      if (flag.type === 'suspended_nonincumbent' && flag.approved === true) {
        removalSet.add(`${flag.district}|${(flag.chamber || '').toLowerCase()}|${normalizeName(flag.name)}`);
      }
    }
  }

  // Get the document body
  const bodies = doc.getElementsByTagNameNS(W_NS, 'body');
  if (bodies.length === 0) {
    console.error('ERROR: No w:body found in document.xml');
    process.exit(1);
  }
  const body = bodies[0];
  const bodyChildren = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    if (body.childNodes[i].nodeType === 1) bodyChildren.push(body.childNodes[i]);
  }

  // Find all district heading positions
  // Map: district number -> index in bodyChildren
  const districtPositions = new Map();
  for (let i = 0; i < bodyChildren.length; i++) {
    const node = bodyChildren[i];
    if (node.localName === 'p') {
      const text = getWordText(node).trim();
      const match = text.match(/^Legislative\s+District\s+(\d+)$/i);
      if (match) {
        districtPositions.set(parseInt(match[1]), i);
      }
    }
  }

  // Process each district 1-30
  for (let distNum = 1; distNum <= 30; distNum++) {
    const headingIdx = districtPositions.get(distNum);
    if (headingIdx === undefined) {
      stats.warnings.push(`District ${distNum}: heading not found`);
      continue;
    }

    // Find next district heading to bound our search
    let nextDistIdx = bodyChildren.length;
    for (let d = distNum + 1; d <= 30; d++) {
      if (districtPositions.has(d)) {
        nextDistIdx = districtPositions.get(d);
        break;
      }
    }
    // Also check if any other district heading exists between our heading and nextDistIdx
    // (districts might not be in order)
    for (const [d, idx] of districtPositions) {
      if (d !== distNum && idx > headingIdx && idx < nextDistIdx) {
        nextDistIdx = idx;
      }
    }

    // Find House and Senate candidate tables by header text
    let houseTable = null;
    let senateTable = null;
    for (let i = headingIdx + 1; i < nextDistIdx; i++) {
      if (bodyChildren[i].localName !== 'tbl') continue;
      const tbl = bodyChildren[i];
      const tblRows = getTableRows(tbl);
      if (tblRows.length === 0) continue;
      const headerText = getWordText(tblRows[0]).trim().toLowerCase();
      if (!houseTable && headerText.includes('house candidates')) {
        houseTable = tbl;
      } else if (!senateTable && headerText.includes('senate candidates')) {
        senateTable = tbl;
      }
      if (houseTable && senateTable) break;
    }

    if (!houseTable || !senateTable) {
      stats.warnings.push(`District ${distNum}: missing ${!houseTable ? 'House' : ''}${!houseTable && !senateTable ? ' and ' : ''}${!senateTable ? 'Senate' : ''} candidate table`);
    }

    const chambers = [
      { name: 'house', table: houseTable },
      { name: 'senate', table: senateTable }
    ];

    for (const { name: chamber, table } of chambers) {
      if (!table) continue;

      const distData = data.districts[String(distNum)];
      if (!distData || !distData[chamber]) {
        stats.warnings.push(`District ${distNum} ${chamber}: no data in JSON`);
        continue;
      }

      const candidates = distData[chamber];
      const rows = getTableRows(table);

      // Identify candidate rows
      let candidateRows = [];
      let candidateRowIndices = [];

      // Primary method: rows with w:color in rPr
      for (let ri = 0; ri < rows.length; ri++) {
        if (rowHasColor(rows[ri])) {
          candidateRows.push(rows[ri]);
          candidateRowIndices.push(ri);
        }
      }

      // Fallback: rows after index 1
      if (candidateRows.length === 0 && rows.length > 2) {
        for (let ri = 2; ri < rows.length; ri++) {
          candidateRows.push(rows[ri]);
          candidateRowIndices.push(ri);
        }
      }

      // Build map of existing rows by normalized name
      const existingByName = new Map();
      for (let i = 0; i < candidateRows.length; i++) {
        const name = normalizeName(getCellText(candidateRows[i]));
        if (name) existingByName.set(name, { row: candidateRows[i], index: i });
      }

      // Track which candidates in data were matched
      const matchedDataIndices = new Set();

      // Update existing rows
      for (const [normName, { row }] of existingByName) {
        // Find matching candidate in data
        let matched = null;
        let matchedIdx = -1;
        for (let ci = 0; ci < candidates.length; ci++) {
          if (normalizeName(candidates[ci].name) === normName) {
            matched = candidates[ci];
            matchedIdx = ci;
            break;
          }
        }

        // Check for removal
        const removalKey = `${distNum}|${chamber}|${normName}`;
        if (removalSet.has(removalKey)) {
          // Remove this row from the table
          row.parentNode.removeChild(row);
          stats.candidatesRemoved++;
          const displayName = matched ? matched.name : getCellText(row);
          const displayParty = matched ? matched.party : 'Unknown';
          stats.removedDetails.push(`${displayName} (LD${distNum} ${chamber}, ${displayParty}) [suspended, approved]`);
          if (matchedIdx >= 0) matchedDataIndices.add(matchedIdx);
          continue;
        }

        if (!matched) {
          // Row exists in doc but not in data — leave it alone
          continue;
        }

        matchedDataIndices.add(matchedIdx);

        // Update the 6 cells: Name | Financing | Income Total | Income This Period | Expenses Total | Cash Balance
        const cells = getChildElements(row, 'tc', W_NS);
        const values = [
          matched.name,
          fmtVal(matched.financing),
          fmtVal(matched.income_total),
          fmtVal(matched.income_this_period),
          fmtVal(matched.expenses_total),
          fmtVal(matched.cash_balance)
        ];

        for (let ci = 0; ci < Math.min(cells.length, values.length); ci++) {
          setCellText(cells[ci], values[ci], doc);
        }

        // Update color
        const color = partyColor(matched.party);
        setRowColor(row, color, doc);

        // Bold for incumbents
        setBold(row, !!matched.incumbent, doc);
        if (matched.incumbent) stats.boldApplied++;

        // Strikethrough for suspended
        setStrike(row, !!matched.suspended, doc);
        if (matched.suspended) stats.strikethroughApplied++;

        stats.candidatesUpdated++;
      }

      // Add new candidates (those not matched to existing rows)
      const hasCloneSource = candidateRows.length > 0;
      if (!hasCloneSource && candidates.some((_, ci) => !matchedDataIndices.has(ci))) {
        stats.warnings.push(`District ${distNum} ${chamber}: empty_table_no_clone_source — skipping additions`);
      }

      for (let ci = 0; ci < candidates.length; ci++) {
        if (matchedDataIndices.has(ci)) continue;

        const cand = candidates[ci];

        // Check if this candidate should be removed rather than added
        const removalKey = `${distNum}|${chamber}|${normalizeName(cand.name)}`;
        if (removalSet.has(removalKey)) continue;

        if (!hasCloneSource) continue;

        // Clone an existing candidate row
        // Prefer a row that still exists in the table (not removed)
        let sourceRow = null;
        for (const cr of candidateRows) {
          if (cr.parentNode === table) {
            sourceRow = cr;
            break;
          }
        }
        // If all candidate rows were removed, try any still in table
        if (!sourceRow) {
          const currentRows = getTableRows(table);
          if (currentRows.length > 1) {
            sourceRow = currentRows[currentRows.length - 1];
          }
        }
        if (!sourceRow) {
          stats.warnings.push(`District ${distNum} ${chamber}: no viable clone source for ${cand.name}`);
          continue;
        }

        const newRow = sourceRow.cloneNode(true);

        // Set cell values
        const cells = getChildElements(newRow, 'tc', W_NS);
        const values = [
          cand.name,
          fmtVal(cand.financing),
          fmtVal(cand.income_total),
          fmtVal(cand.income_this_period),
          fmtVal(cand.expenses_total),
          fmtVal(cand.cash_balance)
        ];

        for (let cellIdx = 0; cellIdx < Math.min(cells.length, values.length); cellIdx++) {
          setCellText(cells[cellIdx], values[cellIdx], doc);
        }

        // Set formatting
        const color = partyColor(cand.party);
        setRowColor(newRow, color, doc);
        setBold(newRow, !!cand.incumbent, doc);
        if (cand.incumbent) stats.boldApplied++;
        setStrike(newRow, !!cand.suspended, doc);
        if (cand.suspended) stats.strikethroughApplied++;

        // Insert before the closing of the table (append as last child)
        table.appendChild(newRow);

        stats.candidatesAdded++;
        stats.addedDetails.push(`${cand.name} (LD${distNum} ${chamber}, ${cand.party})`);
      }

      // Fix 4: Strip floating table positioning (tblpPr) from modified
      // candidate tables so they paginate as inline tables and don't
      // overflow into the page header area.
      stripFloatingPosition(table);
    }

    stats.districtsProcessed++;
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  const serializer = new XMLSerializer();
  const outputXml = serializer.serializeToString(doc);

  // Verify well-formedness by re-parsing
  const verifyDoc = domParser.parseFromString(outputXml, 'application/xml');
  const parseErrors = getElementsByLocalName(verifyDoc, 'parsererror');
  if (parseErrors.length > 0) {
    console.error('ERROR: Output XML is not well-formed!');
    process.exit(1);
  }

  // Verify all 30 districts still present
  const verifyBodies = verifyDoc.getElementsByTagNameNS(W_NS, 'body');
  if (verifyBodies.length === 0) {
    console.error('ERROR: Output XML lost w:body!');
    process.exit(1);
  }
  let districtCount = 0;
  const verifyParagraphs = verifyDoc.getElementsByTagNameNS(W_NS, 'p');
  for (let i = 0; i < verifyParagraphs.length; i++) {
    const text = getWordText(verifyParagraphs[i]).trim();
    if (/^Legislative\s+District\s+\d+$/i.test(text)) districtCount++;
  }
  if (districtCount < 30) {
    console.error(`ERROR: Only ${districtCount}/30 district headings found in output!`);
    process.exit(1);
  }

  // Verify no table has zero rows (unless it started that way — we check candidate rows)
  // This is a soft check: we just warn
  const verifyTables = verifyDoc.getElementsByTagNameNS(W_NS, 'tbl');
  for (let i = 0; i < verifyTables.length; i++) {
    const tRows = getChildElements(verifyTables[i], 'tr', W_NS);
    if (tRows.length === 0) {
      stats.warnings.push(`Validation: Table ${i} has zero rows`);
    }
  }

  // ---------------------------------------------------------------------------
  // Write output
  // ---------------------------------------------------------------------------
  zip.file('word/document.xml', outputXml);
  const outputBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  fs.writeFileSync(opts.output, outputBuffer);

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------
  const originalSize = docxBuffer.length;
  const outputSize = outputBuffer.length;
  const deltaBytes = outputSize - originalSize;
  const deltaPct = ((deltaBytes / originalSize) * 100).toFixed(1);
  const deltaSign = deltaBytes >= 0 ? '+' : '';

  console.log(`Districts processed: ${stats.districtsProcessed}/30`);
  console.log(`Candidates updated: ${stats.candidatesUpdated}`);
  console.log(`Candidates added: ${stats.candidatesAdded}`);
  if (stats.addedDetails.length > 0) {
    for (const d of stats.addedDetails) console.log(`  - ${d}`);
  }
  console.log(`Candidates removed: ${stats.candidatesRemoved}`);
  if (stats.removedDetails.length > 0) {
    for (const d of stats.removedDetails) console.log(`  - ${d}`);
  }
  console.log(`Strikethrough applied: ${stats.strikethroughApplied}`);
  console.log(`Bold (incumbent): ${stats.boldApplied}`);
  console.log(`Output size: ${Math.round(outputSize / 1024)}KB (original: ${Math.round(originalSize / 1024)}KB, delta: ${deltaSign}${deltaPct}%)`);

  if (stats.warnings.length > 0) {
    console.log(`\nWarnings (${stats.warnings.length}):`);
    for (const w of stats.warnings) console.log(`  - ${w}`);
  }
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
