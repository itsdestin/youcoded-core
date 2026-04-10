#!/usr/bin/env node
/**
 * Theme Contrast Validator
 *
 * Reads a theme manifest.json and checks all contrast/distinction rules.
 * Exit 0 = all hard rules pass, Exit 1 = at least one hard rule fails.
 * Soft-rule warnings are printed but don't fail the check.
 *
 * Usage:  node check-contrast.cjs <path-to-manifest.json>
 *
 * Three tiers:
 *   HARD   — UI breaks (text unreadable, elements invisible). Fails the check.
 *   SURFACE — Elements lose visual boundaries. Fails the check.
 *   SOFT   — Degraded but usable. Warns only.
 */

const fs = require('fs');
const path = require('path');

// ── Color math helpers ──────────────────────────────────────────────────────

/** Parse hex (#RGB, #RRGGBB, #RRGGBBAA) to { r, g, b, a } in 0-255 range */
function parseHex(hex) {
  if (!hex || typeof hex !== 'string') return null;
  hex = hex.replace(/^#/, '');
  // Strip alpha suffix if present (e.g. "#37373780")
  let a = 255;
  if (hex.length === 4) {
    // #RGBA
    a = parseInt(hex[3] + hex[3], 16);
    hex = hex.slice(0, 3);
  } else if (hex.length === 8) {
    // #RRGGBBAA
    a = parseInt(hex.slice(6, 8), 16);
    hex = hex.slice(0, 6);
  }
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length !== 6) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: a / 255,
  };
}

/** WCAG relative luminance (0-1) from sRGB channel 0-255 */
function luminance(rgb) {
  const [rs, gs, bs] = [rgb.r, rgb.g, rgb.b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** WCAG contrast ratio between two luminances (returns >= 1) */
function contrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Luminance ratio (non-WCAG, for surface distinction — just the raw ratio) */
function luminanceRatio(l1, l2) {
  if (l1 === 0 && l2 === 0) return 1;
  const a = Math.max(l1, l2);
  const b = Math.min(l1, l2);
  // For very dark surfaces, use absolute difference check instead
  if (a < 0.01) return 1 + Math.abs(l1 - l2) * 100;
  return a / (b || 0.0001);
}

/**
 * Apply alpha to a foreground color over a background color.
 * Returns composited { r, g, b } with a=1.
 */
function alphaComposite(fg, bg, alpha) {
  return {
    r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
    g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
    b: Math.round(fg.b * alpha + bg.b * (1 - alpha)),
    a: 1,
  };
}

// ── Rule definitions ────────────────────────────────────────────────────────

/**
 * Each rule: { name, tier, threshold, type, fg, bg, [fgAlpha], description }
 *   type: "contrast" = WCAG contrast ratio, "distinction" = luminance ratio
 *   fg/bg: token names from manifest.tokens
 *   fgAlpha: optional multiplier on the fg color's opacity (for timestamp rules)
 */
const RULES = [
  // ── HARD: UI breaks if these fail ──
  { name: 'fg on canvas',         tier: 'HARD',    type: 'contrast',    fg: 'fg',        bg: 'canvas',  threshold: 4.5,  description: 'Body text must be readable on main background' },
  { name: 'fg on inset',          tier: 'HARD',    type: 'contrast',    fg: 'fg',        bg: 'inset',   threshold: 4.5,  description: 'Text in assistant bubbles must be readable' },
  { name: 'fg on panel',          tier: 'HARD',    type: 'contrast',    fg: 'fg',        bg: 'panel',   threshold: 4.5,  description: 'Text on panels/header/status bar must be readable' },
  { name: 'on-accent on accent',  tier: 'HARD',    type: 'contrast',    fg: 'on-accent', bg: 'accent',  threshold: 4.5,  description: 'User bubble text and active button text must be readable' },
  { name: 'fg-2 on inset',        tier: 'HARD',    type: 'contrast',    fg: 'fg-2',      bg: 'inset',   threshold: 3.5,  description: 'Session pill labels and secondary text in bubbles' },
  { name: 'fg-dim on inset',      tier: 'HARD',    type: 'contrast',    fg: 'fg-dim',    bg: 'inset',   threshold: 2.5,  description: 'Tool card labels and collapsed group text inside bubbles' },

  // ── SURFACE: Elements disappear if these fail ──
  { name: 'inset vs panel',       tier: 'SURFACE', type: 'distinction', fg: 'inset',     bg: 'panel',   threshold: 1.2,  description: 'Session pills and toggle containers must be visible on header bar' },
  { name: 'canvas vs inset',      tier: 'SURFACE', type: 'distinction', fg: 'canvas',    bg: 'inset',   threshold: 1.3,  description: 'Code blocks must be visible inside assistant bubbles' },
  { name: 'well vs panel',        tier: 'SURFACE', type: 'distinction', fg: 'well',      bg: 'panel',   threshold: 1.15, description: 'Search bar must be visible in command drawer' },
  { name: 'edge on panel',        tier: 'SURFACE', type: 'contrast',    fg: 'edge',      bg: 'panel',   threshold: 1.5,  description: 'Borders must be visible on panel surfaces (session strip, tool cards)' },
  { name: 'edge-dim on panel',    tier: 'SURFACE', type: 'contrast',    fg: 'edge-dim',  bg: 'panel',   threshold: 1.3,  description: 'Dim borders must be visible (chips, code blocks rely on these)' },

  // ── SOFT: Degraded but usable, warn only ──
  { name: 'fg-2 on canvas',       tier: 'SOFT',    type: 'contrast',    fg: 'fg-2',      bg: 'canvas',  threshold: 3.5,  description: 'Secondary text should be comfortable to read' },
  { name: 'fg-dim on panel',      tier: 'SOFT',    type: 'contrast',    fg: 'fg-dim',    bg: 'panel',   threshold: 2.0,  description: 'Inactive toggle text and dropdown labels' },
  { name: 'accent vs inset',      tier: 'SOFT',    type: 'contrast',    fg: 'accent',    bg: 'inset',   threshold: 3.0,  description: 'Active toggle button should stand out from its container' },
  { name: 'fg-muted/60 on inset', tier: 'SOFT',    type: 'contrast',    fg: 'fg-muted',  bg: 'inset',   threshold: 2.0,  fgAlpha: 0.6, description: 'Timestamp text in assistant bubbles' },
  { name: 'on-accent/50 on accent', tier: 'SOFT',  type: 'contrast',    fg: 'on-accent', bg: 'accent',  threshold: 2.0,  fgAlpha: 0.5, description: 'Timestamp text in user bubbles' },
];

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error('Usage: node check-contrast.cjs <path-to-manifest.json>');
    process.exit(2);
  }

  let manifest;
  try {
    const raw = fs.readFileSync(path.resolve(manifestPath), 'utf-8');
    manifest = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to read manifest: ${err.message}`);
    process.exit(2);
  }

  const tokens = manifest.tokens;
  if (!tokens) {
    console.error('Manifest has no "tokens" object');
    process.exit(2);
  }

  // Parse all token colors
  const parsed = {};
  for (const [key, value] of Object.entries(tokens)) {
    parsed[key] = parseHex(value);
    if (!parsed[key]) {
      console.error(`  ⚠ Could not parse token "${key}": ${value}`);
    }
  }

  let hardFails = 0;
  let surfaceFails = 0;
  let softWarns = 0;

  const results = { HARD: [], SURFACE: [], SOFT: [] };

  for (const rule of RULES) {
    const fgColor = parsed[rule.fg];
    const bgColor = parsed[rule.bg];

    if (!fgColor || !bgColor) {
      // Missing token — skip but note it
      results[rule.tier].push({
        rule: rule.name,
        status: 'SKIP',
        reason: `missing token (${!fgColor ? rule.fg : rule.bg})`,
        description: rule.description,
      });
      continue;
    }

    let effectiveFg = fgColor;

    // Handle alpha on the fg token itself (e.g. edge-dim with embedded alpha)
    if (fgColor.a < 1) {
      effectiveFg = alphaComposite(fgColor, bgColor, fgColor.a);
    }

    // Handle rule-level alpha (e.g. fg-muted at 60% opacity)
    if (rule.fgAlpha) {
      effectiveFg = alphaComposite(effectiveFg, bgColor, rule.fgAlpha);
    }

    let actual;
    let pass;

    if (rule.type === 'contrast') {
      const fgLum = luminance(effectiveFg);
      const bgLum = luminance(bgColor);
      actual = contrastRatio(fgLum, bgLum);
      pass = actual >= rule.threshold;
    } else {
      // distinction — luminance ratio
      const fgLum = luminance(effectiveFg);
      const bgLum = luminance(bgColor);
      actual = luminanceRatio(fgLum, bgLum);
      pass = actual >= rule.threshold;
    }

    results[rule.tier].push({
      rule: rule.name,
      status: pass ? 'PASS' : 'FAIL',
      actual: actual.toFixed(2),
      threshold: rule.threshold,
      description: rule.description,
    });

    if (!pass) {
      if (rule.tier === 'HARD') hardFails++;
      else if (rule.tier === 'SURFACE') surfaceFails++;
      else softWarns++;
    }
  }

  // ── Print results ───────────────────────────────────────────────────────

  const themeName = manifest.name || manifest.slug || 'Unknown';
  console.log(`\n  Theme: ${themeName}`);
  console.log(`  ${'─'.repeat(50)}\n`);

  for (const tier of ['HARD', 'SURFACE', 'SOFT']) {
    const tierResults = results[tier];
    if (tierResults.length === 0) continue;

    const tierLabel = tier === 'HARD' ? '✖ HARD RULES (fail = broken UI)'
      : tier === 'SURFACE' ? '◼ SURFACE DISTINCTION (fail = elements disappear)'
      : '◦ SOFT RULES (warn only)';

    console.log(`  ${tierLabel}\n`);

    for (const r of tierResults) {
      if (r.status === 'SKIP') {
        console.log(`    ─ ${r.rule}: SKIPPED (${r.reason})`);
      } else if (r.status === 'PASS') {
        console.log(`    ✓ ${r.rule}: ${r.actual} (need ${r.threshold})`);
      } else {
        const icon = tier === 'SOFT' ? '⚠' : '✗';
        console.log(`    ${icon} ${r.rule}: ${r.actual} (need ${r.threshold}) — ${r.description}`);
      }
    }
    console.log('');
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  const totalFails = hardFails + surfaceFails;
  if (totalFails === 0 && softWarns === 0) {
    console.log('  ✓ All contrast checks passed.\n');
  } else {
    if (totalFails > 0) {
      console.log(`  ✗ ${totalFails} rule(s) failed (${hardFails} hard, ${surfaceFails} surface).`);
    }
    if (softWarns > 0) {
      console.log(`  ⚠ ${softWarns} soft warning(s).`);
    }
    console.log('');
  }

  // Exit 1 if any hard or surface rules failed
  process.exit(totalFails > 0 ? 1 : 0);
}

main();
