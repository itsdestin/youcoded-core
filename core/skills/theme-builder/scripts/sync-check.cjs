#!/usr/bin/env node
/**
 * sync-check.cjs — Verifies theme-preview.css stays in sync with globals.css.
 *
 * Checks that critical CSS sections (glassmorphism, layout presets, scrollbar,
 * background layers) in theme-preview.css match the corresponding sections in
 * globals.css. Reports drift so developers can update the preview CSS.
 *
 * Usage: node core/skills/theme-builder/scripts/sync-check.cjs
 * Exit code: 0 = in sync, 1 = drift detected
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const GLOBALS = path.join(ROOT, 'desktop', 'src', 'renderer', 'styles', 'globals.css');
const PREVIEW = path.join(ROOT, 'core', 'skills', 'theme-builder', 'theme-preview.css');

function readFile(p) {
  if (!fs.existsSync(p)) {
    console.error(`File not found: ${p}`);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8');
}

/**
 * Extract all CSS rule blocks matching a selector pattern from a CSS string.
 * Returns an array of { selector, body } objects.
 */
function extractRules(css, selectorPattern) {
  const results = [];
  const regex = new RegExp(
    // Match the selector, then { ... }
    `(${selectorPattern}[^{]*)\\{([^}]+)\\}`,
    'g'
  );
  let match;
  while ((match = regex.exec(css)) !== null) {
    results.push({
      selector: match[1].trim(),
      body: match[2].trim().replace(/\s+/g, ' '),
    });
  }
  return results;
}

/**
 * Normalize a CSS property block for comparison:
 * - Remove comments
 * - Collapse whitespace
 * - Sort properties
 */
function normalizeBody(body) {
  return body
    .replace(/\/\*.*?\*\//g, '')
    .split(';')
    .map(p => p.trim())
    .filter(Boolean)
    .sort()
    .join('; ');
}

const globals = readFile(GLOBALS);
const preview = readFile(PREVIEW);

const CHECKS = [
  {
    name: 'Glassmorphism — header-bar',
    pattern: '\\[data-panels-blur\\]\\s+\\.header-bar',
  },
  {
    name: 'Glassmorphism — status-bar',
    pattern: '\\[data-panels-blur\\]\\s+\\.status-bar',
  },
  {
    name: 'Glassmorphism — bg-inset (assistant bubbles)',
    pattern: '\\[data-panels-blur\\]\\s+\\.bg-inset',
  },
  {
    name: 'Glassmorphism — bg-accent (user bubbles)',
    pattern: '\\[data-panels-blur\\]\\s+\\.bg-accent',
  },
  {
    name: 'Layout — floating input',
    pattern: '\\[data-input-style="floating"\\]',
  },
  {
    name: 'Layout — minimal input',
    pattern: '\\[data-input-style="minimal"\\]',
  },
  {
    name: 'Layout — terminal input',
    pattern: '\\[data-input-style="terminal"\\]',
  },
  {
    name: 'Layout — pill bubbles',
    pattern: '\\[data-bubble-style="pill"\\]',
  },
  {
    name: 'Layout — flat bubbles',
    pattern: '\\[data-bubble-style="flat"\\]',
  },
  {
    name: 'Layout — bordered bubbles',
    pattern: '\\[data-bubble-style="bordered"\\]',
  },
  {
    name: 'Layout — minimal header',
    pattern: '\\[data-header-style="minimal"\\]',
  },
  {
    name: 'Layout — hidden header',
    pattern: '\\[data-header-style="hidden"\\]',
  },
  {
    name: 'Layout — minimal statusbar',
    pattern: '\\[data-statusbar-style="minimal"\\]',
  },
  {
    name: 'Layout — floating statusbar',
    pattern: '\\[data-statusbar-style="floating"\\]',
  },
  {
    name: 'Background layer — #theme-bg',
    pattern: '#theme-bg',
  },
  {
    name: 'Background layer — #theme-pattern',
    pattern: '#theme-pattern',
  },
];

let driftCount = 0;

for (const check of CHECKS) {
  const globalsRules = extractRules(globals, check.pattern);
  const previewRules = extractRules(preview, check.pattern);

  if (globalsRules.length === 0) {
    // Not in globals — skip (might be preview-only like concept-card)
    continue;
  }

  if (previewRules.length === 0) {
    console.log(`❌ MISSING in preview: ${check.name}`);
    console.log(`   globals.css has ${globalsRules.length} rule(s) for: ${check.pattern}`);
    driftCount++;
    continue;
  }

  // Compare the first matching rule's properties
  const gBody = normalizeBody(globalsRules[0].body);
  const pBody = normalizeBody(previewRules[0].body);

  // Check key properties match (not exact — preview may have extra mockup styles)
  const gProps = new Set(gBody.split('; ').map(p => p.split(':')[0].trim()));
  const pProps = new Set(pBody.split('; ').map(p => p.split(':')[0].trim()));

  const missingInPreview = [...gProps].filter(p => !pProps.has(p) && p);
  if (missingInPreview.length > 0) {
    console.log(`⚠️  DRIFT in ${check.name}:`);
    console.log(`   Missing properties in preview: ${missingInPreview.join(', ')}`);
    driftCount++;
  }
}

// Check token variables exist in preview
const TOKEN_VARS = [
  '--canvas', '--panel', '--inset', '--well', '--accent', '--on-accent',
  '--fg', '--fg-2', '--fg-dim', '--fg-muted', '--fg-faint',
  '--edge', '--edge-dim', '--scrollbar-thumb', '--scrollbar-hover',
];

for (const token of TOKEN_VARS) {
  // Check that preview uses var(token) somewhere
  if (!preview.includes(`var(${token}`)) {
    console.log(`❌ Token not used in preview: ${token}`);
    driftCount++;
  }
}

if (driftCount === 0) {
  console.log('✅ theme-preview.css is in sync with globals.css');
  process.exit(0);
} else {
  console.log(`\n${driftCount} sync issue(s) found. Update theme-preview.css to match.`);
  process.exit(1);
}
