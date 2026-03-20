#!/usr/bin/env bash
# generate-manifest.sh — Scans toolkit directories and generates plugin-manifest.json
# Called by release.sh during the release process.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Single node invocation to scan all directories and produce manifest
VERSION="unknown"
[[ -f "$TOOLKIT_ROOT/VERSION" ]] && VERSION=$(cat "$TOOLKIT_ROOT/VERSION" | tr -d '[:space:]')

# Convert bash path to Windows-style path (C:/...) so Node.js resolves it correctly on Windows
NODE_ROOT="$(cygpath -m "$TOOLKIT_ROOT" 2>/dev/null || echo "$TOOLKIT_ROOT")"

node -e "
const fs = require('fs');
const path = require('path');
const root = '$NODE_ROOT';

function listDirs(dir) {
    try {
        return fs.readdirSync(dir).filter(f =>
            fs.statSync(path.join(dir, f)).isDirectory());
    } catch(e) { return []; }
}
function listFiles(dir, ext) {
    try {
        return fs.readdirSync(dir).filter(f =>
            f.endsWith(ext) && fs.statSync(path.join(dir, f)).isFile());
    } catch(e) { return []; }
}

const layers = ['core', 'life', 'productivity'];
const skills = [];
const hooks = [];
for (const layer of layers) {
    skills.push(...listDirs(path.join(root, layer, 'skills')));
    hooks.push(...listFiles(path.join(root, layer, 'hooks'), '.sh'));
}
const commands = listFiles(path.join(root, 'core', 'commands'), '.md');
const utility_scripts = listFiles(path.join(root, 'core', 'hooks'), '.js');
const specs = listFiles(path.join(root, 'core', 'specs'), '.md');

const manifest = {
    version: '$VERSION',
    generated_at: new Date().toISOString(),
    owned_files: { skills, hooks, commands, utility_scripts, specs, templates: ['claude-md-fragments/*'] }
};
console.log(JSON.stringify(manifest, null, 2));
" > "$TOOLKIT_ROOT/plugin-manifest.json"

echo "Generated plugin-manifest.json (version $VERSION)"
