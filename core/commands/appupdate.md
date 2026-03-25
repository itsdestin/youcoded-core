---
description: Check for and install the latest DestinCode desktop app from GitHub Releases
---

Check for the latest DestinCode desktop app release on GitHub, compare it to the currently installed version, and install/update if needed.

## Steps

1. **Detect toolkit root.**
   ```bash
   TOOLKIT_ROOT="$HOME/destinclaude"
   [[ ! -f "$TOOLKIT_ROOT/VERSION" ]] && TOOLKIT_ROOT=$(node -e "try{const c=JSON.parse(require('fs').readFileSync(process.env.HOME+'/.claude/toolkit-state/config.json','utf8'));if(c.toolkit_root)console.log(c.toolkit_root)}catch{}" 2>/dev/null)
   ```
   If neither works: "Can't find toolkit root. Run `/setup-wizard` first."

2. **Check prerequisites.** Verify `gh` CLI is available:
   ```bash
   command -v gh &>/dev/null && echo "OK" || echo "MISSING"
   ```
   If missing: "The `gh` CLI is required for app updates. Install it with `winget install GitHub.cli` (Windows), `brew install gh` (macOS), or see https://cli.github.com/."

3. **Fetch latest release info from GitHub.**
   ```bash
   gh release view --repo itsdestin/destinclaude --json tagName,name,publishedAt 2>/dev/null
   ```
   Store the `tagName` (e.g., `v2.1.4`) as `LATEST_TAG` and strip the `v` prefix as `LATEST_VERSION`.

   If this fails: "Can't reach GitHub — you may be offline."

4. **Determine currently installed app version.** Read the local cache:
   ```bash
   cat ~/.claude/toolkit-state/app-version.json 2>/dev/null
   ```
   This file contains `{"installed_version": "X.Y.Z"}`. If the file doesn't exist or has no `installed_version`, the installed version is unknown — treat as "not installed" and proceed to install.

5. **Compare versions.** If the installed version matches `LATEST_VERSION`: "DestinCode is up to date (vX.Y.Z)." — stop. Otherwise, show:
   - Current installed version (or "not installed / unknown")
   - Latest available version
   - Ask: "Would you like to install DestinCode vX.Y.Z?"

6. **Verify install script exists.**
   ```bash
   [[ -f "$TOOLKIT_ROOT/desktop/scripts/install-app.sh" ]] && echo "OK" || echo "MISSING"
   ```
   If missing: "Install script not found at `$TOOLKIT_ROOT/desktop/scripts/install-app.sh`. Your toolkit may not include the desktop component."

7. **Run the installer.** Use the existing install script with the latest version:
   ```bash
   TOOLKIT_ROOT="$TOOLKIT_ROOT" bash "$TOOLKIT_ROOT/desktop/scripts/install-app.sh" --version "$LATEST_VERSION"
   ```
   Present the installer output to the user.

8. **Update the version cache** so future checks know what's installed:
   ```bash
   echo "{\"installed_version\": \"$LATEST_VERSION\"}" > ~/.claude/toolkit-state/app-version.json
   ```

9. **Offer to launch the app.** Ask: "Would you like to launch DestinCode now?"

   If yes, launch based on platform:
   ```bash
   # Windows
   "$LOCALAPPDATA/Programs/DestinCode/DestinCode.exe" &

   # macOS
   open /Applications/DestinCode.app

   # Linux
   ~/.local/bin/DestinCode.AppImage &
   ```

10. **Final confirmation.**
    ```
    DestinCode vX.Y.Z installed and running.
    ```
