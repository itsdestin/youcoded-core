#!/bin/bash
# Release script — bumps VERSION + plugin.json, adds CHANGELOG header, commits, tags, and pushes.
# Usage: ./scripts/release.sh 1.3.0
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$1"
if [[ -z "$VERSION" ]]; then
    echo "Usage: ./scripts/release.sh <version>"
    echo "  e.g. ./scripts/release.sh 1.3.0"
    exit 1
fi

# Strip leading v if provided
VERSION="${VERSION#v}"

# Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: '$VERSION' is not valid semver (expected X.Y.Z)"
    exit 1
fi

CURRENT=$(cat VERSION 2>/dev/null | tr -d '[:space:]')
NEWER=$(printf '%s\n' "$CURRENT" "$VERSION" | sort -V | tail -1)
if [[ "$NEWER" != "$VERSION" || "$CURRENT" == "$VERSION" ]]; then
    echo "Error: v$VERSION is not newer than current v$CURRENT"
    exit 1
fi

# Check for existing tag
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
    echo "Error: tag v$VERSION already exists"
    exit 1
fi

# Check working tree is clean (besides what we're about to change)
if [[ -n "$(git status --porcelain)" ]]; then
    echo "Error: working tree is dirty — commit or stash changes first"
    exit 1
fi

echo "Releasing v$VERSION (currently v$CURRENT)"

# 1. Bump VERSION
echo "$VERSION" > VERSION

# 2. Bump plugin.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$VERSION\"/" plugin.json

# 3. Add CHANGELOG header
TODAY=$(date +%Y-%m-%d)
sed -i "0,/^## /{s|^## |## v$VERSION ($TODAY)\n\n_(fill in release notes)_\n\n## |}" CHANGELOG.md

# 4. Commit, tag, push
git add VERSION plugin.json CHANGELOG.md
git commit -m "release: v$VERSION"
git tag "v$VERSION"
git push origin master --tags

echo ""
echo "Done — v$VERSION tagged and pushed."
echo "Remember to fill in the CHANGELOG entry."
