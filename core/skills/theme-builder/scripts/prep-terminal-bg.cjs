#!/usr/bin/env node
/**
 * prep-terminal-bg.cjs — Pre-blur + darken a theme wallpaper for terminal view.
 *
 * TerminalView renders this asset as a static layer behind xterm so text
 * stays readable over high-frequency wallpaper detail. Pre-baking avoids the
 * runtime GPU cost of backdrop-filter on a full-pane surface (especially on
 * low-end Android) and lets us blur harder than we safely could at runtime.
 *
 * Usage:
 *   node prep-terminal-bg.cjs <input-wallpaper> <output-path> [--blur N] [--brightness N]
 *
 * Defaults:
 *   --blur 32          Gaussian blur sigma (pixels). 32 kills text-fighting
 *                      detail while keeping the color field recognizable.
 *   --brightness 0.82  Multiplier applied to every pixel. 0.82 darkens enough
 *                      to preserve contrast against light-fg themes without
 *                      turning every theme into a muddy bruise.
 *
 * Output:
 *   WebP at quality 70, downscaled to max 960px on the longer side. A heavily
 *   blurred image carries no high-frequency detail, so it compresses ~4x
 *   better at half-res and still looks identical when rendered full-screen.
 *   Prints JSON: {"ok":true,"path":"...","bytes":N,"input":"..."} or
 *                {"ok":false,"error":"..."}.
 *   Exits 0 on success, 1 on failure.
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const positional = [];
  const flags = { blur: 32, brightness: 0.82 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--blur') flags.blur = parseFloat(argv[++i]);
    else if (a === '--brightness') flags.brightness = parseFloat(argv[++i]);
    else positional.push(a);
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv);
  if (positional.length < 2) {
    console.log(JSON.stringify({
      ok: false,
      error: 'usage: prep-terminal-bg.cjs <input> <output> [--blur N] [--brightness N]',
    }));
    process.exit(1);
  }
  const [input, output] = positional;

  if (!fs.existsSync(input)) {
    console.log(JSON.stringify({ ok: false, error: `input not found: ${input}` }));
    process.exit(1);
  }

  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    console.log(JSON.stringify({
      ok: false,
      error: 'sharp not installed. Run: cd core/skills/theme-builder/scripts && npm install',
    }));
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });

  try {
    await sharp(input)
      // Downscale first — processing a 960px image is faster than 1920px, and
      // the final output is identical since we're about to blur it to mush anyway.
      .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
      .blur(flags.blur)
      .modulate({ brightness: flags.brightness })
      .webp({ quality: 70 })
      .toFile(output);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: `sharp failed: ${e.message}` }));
    process.exit(1);
  }

  const bytes = fs.statSync(output).size;
  console.log(JSON.stringify({ ok: true, path: output, bytes, input }));
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
