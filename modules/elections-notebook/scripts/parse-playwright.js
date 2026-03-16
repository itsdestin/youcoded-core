#!/usr/bin/env node
// parse-playwright.js — Parses Playwright browser_evaluate persisted output into clean JSON
// Usage: node parse-playwright.js --input <persisted-file> --output <soi_candidates.json>
//
// Playwright's browser_evaluate returns a JSON wrapper array with a `text` field containing
// "### Result\n" prefix and "### Ran Playwright code" suffix. For large outputs, results are
// persisted to a file. This script extracts the candidate array from that format.

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && args[i + 1]) {
      opts[args[i].slice(2)] = args[++i];
    }
  }
  if (!opts.input) { console.error('Missing --input <persisted-file>'); process.exit(1); }
  if (!opts.output) { console.error('Missing --output <output.json>'); process.exit(1); }
  return opts;
}

function extractCandidates(raw) {
  // The persisted file is a JSON array with one element that has a `text` field
  let wrapper;
  try {
    wrapper = JSON.parse(raw);
  } catch (e) {
    // Maybe it's already the raw text content
    return extractFromText(raw);
  }

  // Handle wrapper array format: [{ type: "text", text: "### Result\n..." }]
  if (Array.isArray(wrapper)) {
    const textItem = wrapper.find(item => item.text && typeof item.text === 'string');
    if (textItem) {
      return extractFromText(textItem.text);
    }
    // Maybe the array IS the candidates already
    if (wrapper.length > 0 && wrapper[0].name && wrapper[0].office) {
      return unwrapCandidates(wrapper);
    }
    throw new Error('Could not find text field in wrapper array');
  }

  // Handle single object with text field
  if (wrapper && typeof wrapper.text === 'string') {
    return extractFromText(wrapper.text);
  }

  throw new Error('Unrecognized format — expected wrapper array or object with text field');
}

function unwrapCandidates(parsed) {
  // If result is a {count, candidates} wrapper, extract the array
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.candidates)) {
    return parsed.candidates;
  }
  return parsed;
}

function extractFromText(text) {
  // Strip "### Result" prefix and "### Ran Playwright code" suffix if present
  const resultIdx = text.indexOf('### Result');
  let content = resultIdx >= 0 ? text.slice(resultIdx + '### Result'.length) : text;
  const ranIdx = content.indexOf('\n### Ran');
  if (ranIdx >= 0) content = content.slice(0, ranIdx);
  content = content.trim();

  // Handle multi-level encoded JSON strings: the result may be wrapped in quotes
  // (double or triple-encoded). Keep unwrapping until we get an array/object.
  if (content.startsWith('"')) {
    try {
      let unwrapped = content;
      let maxLevels = 5;
      while (typeof unwrapped === 'string' && maxLevels-- > 0) {
        unwrapped = JSON.parse(unwrapped);
      }
      if (typeof unwrapped !== 'string') return unwrapCandidates(unwrapped);
    } catch (e) {
      // Fall through to bracket-matching if JSON.parse fails
    }
  }

  // Direct parse attempt — content might be a plain JSON array/object
  if (content.startsWith('[') || content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      return unwrapCandidates(Array.isArray(parsed) ? parsed : parsed);
    } catch (e) {
      // Fall through to bracket-matching
    }
  }

  // Find the JSON array/object within text using bracket matching
  const openBracket = content.indexOf('[');
  const openBrace = content.indexOf('{');
  let startChar, endChar, startIdx;

  if (openBracket === -1 && openBrace === -1) {
    throw new Error('No JSON array or object found in text');
  } else if (openBrace >= 0 && (openBracket === -1 || openBrace < openBracket)) {
    startChar = '{'; endChar = '}'; startIdx = openBrace;
  } else {
    startChar = '['; endChar = ']'; startIdx = openBracket;
  }

  // Match the closing bracket/brace (respecting strings to avoid false matches)
  let depth = 0;
  let inString = false;
  let escape = false;
  let closeIdx = -1;
  for (let i = startIdx; i < content.length; i++) {
    const ch = content[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === startChar) depth++;
    else if (ch === endChar) {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx === -1) throw new Error('Unmatched brackets in JSON');

  const jsonStr = content.slice(startIdx, closeIdx + 1);
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse extracted JSON: ${e.message}`);
  }

  parsed = unwrapCandidates(parsed);
  if (!Array.isArray(parsed)) throw new Error('Extracted JSON is not an array');
  return parsed;
}

const opts = parseArgs();
const raw = fs.readFileSync(opts.input, 'utf8');
const candidates = extractCandidates(raw);

// Validate structure
const valid = candidates.filter(c => c.name && c.office);
const invalid = candidates.length - valid.length;

const outDir = path.dirname(opts.output);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(opts.output, JSON.stringify(candidates, null, 2), 'utf8');

console.log(`Parsed ${candidates.length} candidates from Playwright output`);
if (invalid > 0) console.log(`  Warning: ${invalid} entries missing name or office fields`);
console.log(`Output: ${opts.output}`);
