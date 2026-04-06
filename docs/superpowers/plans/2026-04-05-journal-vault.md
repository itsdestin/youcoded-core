# Journal Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt all journal and encyclopedia files at rest on remote backends using Node.js crypto, with per-file encryption, password-based unlock, and transparent integration with the existing sync system.

**Architecture:** A Node.js core module (`journal-vault.js`) handles all crypto operations (encrypt, decrypt, wrap, unwrap) via built-in `crypto`. Three shell hooks integrate with the Claude Code hook system: a PreToolUse guard that triggers unlock on access, a SessionEnd hook that locks on exit, and a background watchdog for idle timeout. The existing `sync.sh` and `session-start.sh` get vault-aware conditionals to push/pull encrypted files instead of plain text.

**Tech Stack:** Node.js `crypto` (scrypt, AES-256-GCM), bash hooks, existing backup-common.sh utilities

**Spec:** `core/specs/journal-vault-spec.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `life/hooks/journal-vault.js` | Create | Core crypto module — all vault commands (init, unlock, lock, status, change-password, recover, rotate-recovery) |
| `life/hooks/journal-vault-guard.sh` | Create | PreToolUse hook — intercepts encyclopedia/journal access, triggers unlock |
| `life/hooks/journal-vault-lock.sh` | Create | SessionEnd hook — locks vault on session exit |
| `life/hooks/journal-vault-watchdog.sh` | Create | Background process — auto-locks after idle timeout |
| `core/hooks/hooks-manifest.json` | Modify | Add vault guard and lock hook entries |
| `core/hooks/sync.sh` | Modify | Vault-aware encyclopedia suppression and vault file push |
| `core/hooks/session-start.sh` | Modify | Vault-aware encyclopedia pull suppression and vault file pull |

---

### Task 1: Crypto Primitives — encrypt, decrypt, wrap, unwrap

**Files:**
- Create: `life/hooks/journal-vault.js`

This task builds the low-level crypto functions. No CLI, no file I/O — just pure functions that take buffers and return buffers. Everything else builds on these.

- [ ] **Step 1: Create journal-vault.js with crypto helpers**

```js
// life/hooks/journal-vault.js — Journal Vault crypto engine
// Spec: core/specs/journal-vault-spec.md
// Commands: init, unlock, lock, status, change-password, recover, rotate-recovery

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// --- Constants ---
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(require('os').homedir(), '.claude');
const VAULT_STATE_DIR = path.join(CLAUDE_DIR, '.vault-state');
const CONFIG_FILE = path.join(CLAUDE_DIR, 'toolkit-state', 'config.json');
const SCRYPT_MAXMEM = 256 * 1024 * 1024; // 256MB ceiling for scrypt

// --- Crypto primitives ---

function deriveKey(password, salt, params) {
  return new Promise((resolve, reject) => {
    const N = params.N || 65536;
    const r = params.r || 8;
    const p = params.p || 1;
    crypto.scrypt(password, salt, 32, { N, r, p, maxmem: SCRYPT_MAXMEM }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

function aesGcmEncrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: iv (12) + ciphertext (N) + tag (16)
  return Buffer.concat([iv, encrypted, tag]);
}

function aesGcmDecrypt(key, blob) {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(12, blob.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function wrapDEK(wrappingKey, dek) {
  return aesGcmEncrypt(wrappingKey, dek);
}

function unwrapDEK(wrappingKey, wrappedDEK) {
  return aesGcmDecrypt(wrappingKey, wrappedDEK);
}
```

- [ ] **Step 2: Verify primitives with an inline self-test**

Run:
```bash
node -e "
const c = require('crypto');
// Paste deriveKey, aesGcmEncrypt, aesGcmDecrypt, wrapDEK, unwrapDEK here or require the file
// Quick test: encrypt-decrypt roundtrip
const key = c.randomBytes(32);
const iv = c.randomBytes(12);
const cipher = c.createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([cipher.update(Buffer.from('hello vault')), cipher.final()]);
const tag = cipher.getAuthTag();
const blob = Buffer.concat([iv, enc, tag]);
const decipher = c.createDecipheriv('aes-256-gcm', key, blob.subarray(blob.length-16));
decipher.setAuthTag(blob.subarray(blob.length-16));
const dec = Buffer.concat([decipher.update(blob.subarray(12, blob.length-16)), decipher.final()]);
console.log('roundtrip:', dec.toString());
"
```

Expected: `roundtrip: hello vault`

- [ ] **Step 3: Commit**

```bash
git add life/hooks/journal-vault.js
git commit -m "feat(vault): add crypto primitives — scrypt KDF, AES-256-GCM encrypt/decrypt, DEK wrap/unwrap"
```

---

### Task 2: Password Prompt and Config Helpers

**Files:**
- Modify: `life/hooks/journal-vault.js`

Add the password prompt (readline with hidden input) and config read/write helpers.

- [ ] **Step 1: Add password prompt function**

Append to `journal-vault.js` after the crypto primitives:

```js
// --- Password prompt ---

function promptPassword(prompt) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(prompt);
    let password = '';

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onData = (ch) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stderr.write('\n');
        rl.close();
        resolve(password);
      } else if (c === '\u0003') { // Ctrl+C
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        rl.close();
        reject(new Error('Cancelled'));
      } else if (c === '\u007F' || c === '\b') { // Backspace
        password = password.slice(0, -1);
      } else {
        password += c;
      }
    };
    process.stdin.on('data', onData);
  });
}

function promptPasswordConfirm(prompt) {
  return promptPassword(prompt).then(async (p1) => {
    const p2 = await promptPassword('Confirm password: ');
    if (p1 !== p2) throw new Error('Passwords do not match');
    return p1;
  });
}
```

- [ ] **Step 2: Add config helpers**

Append to `journal-vault.js`:

```js
// --- Config helpers ---

function configGet(key, defaultValue) {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return config[key] !== undefined ? config[key] : defaultValue;
  } catch {
    return defaultValue;
  }
}

function configSet(key, value) {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch { /* new config */ }
  config[key] = value;
  const tmp = CONFIG_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmp, CONFIG_FILE);
}
```

- [ ] **Step 3: Add vault path helpers**

Append to `journal-vault.js`:

```js
// --- Path helpers ---

function vaultHeaderPath() {
  return path.join(CLAUDE_DIR, 'vault-header.json');
}

function vaultDir() {
  const remotePath = configGet('vault_remote_path', 'vault');
  return path.join(CLAUDE_DIR, remotePath);
}

function encPath(relativePath) {
  return path.join(vaultDir(), relativePath + '.enc');
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
```

- [ ] **Step 4: Commit**

```bash
git add life/hooks/journal-vault.js
git commit -m "feat(vault): add password prompt, config helpers, and path utilities"
```

---

### Task 3: Encrypt and Decrypt File Operations

**Files:**
- Modify: `life/hooks/journal-vault.js`

Build the file-level encrypt/decrypt operations and manifest handling.

- [ ] **Step 1: Add file encryption and decryption**

Append to `journal-vault.js`:

```js
// --- File operations ---

function encryptFile(dek, srcPath, destPath) {
  ensureDir(destPath);
  const plaintext = fs.readFileSync(srcPath);
  const encrypted = aesGcmEncrypt(dek, plaintext);
  fs.writeFileSync(destPath, encrypted);
  return plaintext.length;
}

function decryptFile(dek, srcPath, destPath) {
  ensureDir(destPath);
  const blob = fs.readFileSync(srcPath);
  const plaintext = aesGcmDecrypt(dek, blob);
  fs.writeFileSync(destPath, plaintext);
  return plaintext.length;
}
```

- [ ] **Step 2: Add manifest operations**

Append to `journal-vault.js`:

```js
// --- Manifest ---

function buildManifest(fileEntries) {
  return { version: 1, files: fileEntries };
}

function encryptManifest(dek, manifest) {
  const json = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  const encrypted = aesGcmEncrypt(dek, json);
  const manifestPath = path.join(vaultDir(), 'manifest.enc');
  ensureDir(manifestPath);
  fs.writeFileSync(manifestPath, encrypted);
}

function decryptManifest(dek) {
  const manifestPath = path.join(vaultDir(), 'manifest.enc');
  if (!fs.existsSync(manifestPath)) return null;
  const blob = fs.readFileSync(manifestPath);
  const json = aesGcmDecrypt(dek, blob);
  return JSON.parse(json.toString('utf8'));
}
```

- [ ] **Step 3: Add source file discovery**

Append to `journal-vault.js`:

```js
// --- File discovery ---

function discoverSourceFiles() {
  const files = [];
  const encyclopediaDir = path.join(CLAUDE_DIR, 'encyclopedia');
  const journalDirName = configGet('JOURNAL_DIR', 'journals');
  const journalDir = path.join(CLAUDE_DIR, journalDirName);

  if (fs.existsSync(encyclopediaDir)) {
    for (const f of fs.readdirSync(encyclopediaDir)) {
      if (f.endsWith('.md')) {
        files.push({ relative: 'encyclopedia/' + f, absolute: path.join(encyclopediaDir, f) });
      }
    }
  }

  if (fs.existsSync(journalDir)) {
    for (const f of fs.readdirSync(journalDir)) {
      if (f.endsWith('.md')) {
        files.push({ relative: 'journals/' + f, absolute: path.join(journalDir, f) });
      }
    }
  }

  return files;
}
```

- [ ] **Step 4: Commit**

```bash
git add life/hooks/journal-vault.js
git commit -m "feat(vault): add file encrypt/decrypt, manifest handling, and source discovery"
```

---

### Task 4: Init Command

**Files:**
- Modify: `life/hooks/journal-vault.js`

Implement the `init` command — first-time vault setup.

- [ ] **Step 1: Add the init command**

Append to `journal-vault.js`:

```js
// --- Commands ---

async function cmdInit() {
  if (fs.existsSync(vaultHeaderPath())) {
    console.error('Vault already initialized. Use change-password or recover to modify.');
    process.exit(1);
  }

  const sourceFiles = discoverSourceFiles();
  if (sourceFiles.length === 0) {
    console.error('No encyclopedia or journal files found to encrypt.');
    process.exit(1);
  }

  console.error(`Found ${sourceFiles.length} file(s) to encrypt.`);
  const password = await promptPasswordConfirm('Enter vault password: ');

  // Generate keys
  const dek = crypto.randomBytes(32);
  const recoveryKey = crypto.randomBytes(32);
  const salt = crypto.randomBytes(16);
  const kdfParams = { algorithm: 'scrypt', N: 65536, r: 8, p: 1 };

  // Derive wrapping key and wrap DEK
  const wrappingKey = await deriveKey(password, salt, kdfParams);
  const wrappedDEK = wrapDEK(wrappingKey, dek);
  const recoveryWrappedDEK = wrapDEK(recoveryKey, dek);

  // Write vault header
  const header = {
    version: 1,
    kdf: kdfParams,
    salt: salt.toString('base64'),
    wrappedDEK: wrappedDEK.toString('base64'),
    recoveryWrappedDEK: recoveryWrappedDEK.toString('base64'),
  };
  fs.writeFileSync(vaultHeaderPath(), JSON.stringify(header, null, 2) + '\n');

  // Encrypt all files
  const fileEntries = {};
  for (const file of sourceFiles) {
    const dest = encPath(file.relative);
    const size = encryptFile(dek, file.absolute, dest);
    fileEntries[file.relative] = { size };
    console.error(`  Encrypted: ${file.relative}`);
  }

  // Write encrypted manifest
  encryptManifest(dek, buildManifest(fileEntries));

  // Set config
  configSet('vault_enabled', true);

  // Create vault state (unlocked)
  fs.mkdirSync(VAULT_STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(VAULT_STATE_DIR, '.unlocked'), '');
  fs.writeFileSync(path.join(VAULT_STATE_DIR, '.last-access'), new Date().toISOString());
  fs.writeFileSync(path.join(VAULT_STATE_DIR, '.dek-cache'), dek.toString('base64'));

  // Display recovery key
  console.error('');
  console.error('=== RECOVERY KEY ===');
  console.error('Save this somewhere safe. It will NOT be shown again.');
  console.error(recoveryKey.toString('base64'));
  console.error('====================');
  console.error('');
  console.error(`Vault initialized. ${sourceFiles.length} file(s) encrypted.`);

  // Spawn watchdog
  spawnWatchdog();

  console.log('INITIALIZED');
}
```

- [ ] **Step 2: Add watchdog spawner (placeholder — full watchdog in Task 7)**

Append to `journal-vault.js`:

```js
// --- Watchdog ---

function spawnWatchdog() {
  const watchdogScript = path.join(__dirname, 'journal-vault-watchdog.sh');
  if (!fs.existsSync(watchdogScript)) return;

  const timeoutMinutes = configGet('vault_timeout_minutes', 15);
  const { spawn } = require('child_process');
  const child = spawn('bash', [watchdogScript, VAULT_STATE_DIR, String(timeoutMinutes)], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  fs.writeFileSync(path.join(VAULT_STATE_DIR, '.watchdog-pid'), String(child.pid));
}
```

- [ ] **Step 3: Commit**

```bash
git add life/hooks/journal-vault.js
git commit -m "feat(vault): implement init command — keygen, encryption, recovery key display"
```

---

### Task 5: Unlock and Lock Commands

**Files:**
- Modify: `life/hooks/journal-vault.js`

Implement unlock (decrypt to local paths) and lock (re-encrypt dirty files, wipe).

- [ ] **Step 1: Add the unlock command**

Append to `journal-vault.js`:

```js
async function cmdUnlock() {
  const headerPath = vaultHeaderPath();
  if (!fs.existsSync(headerPath)) {
    console.error('No vault found. Run init first.');
    process.exit(1);
  }

  if (fs.existsSync(path.join(VAULT_STATE_DIR, '.unlocked'))) {
    console.error('Vault is already unlocked.');
    console.log('ALREADY_UNLOCKED');
    process.exit(0);
  }

  const header = JSON.parse(fs.readFileSync(headerPath, 'utf8'));
  const password = await promptPassword('Vault password: ');

  // Derive wrapping key
  const salt = Buffer.from(header.salt, 'base64');
  const wrappingKey = await deriveKey(password, salt, header.kdf);

  // Unwrap DEK
  let dek;
  try {
    dek = unwrapDEK(wrappingKey, Buffer.from(header.wrappedDEK, 'base64'));
  } catch {
    console.error('Wrong password.');
    process.exit(1);
  }

  // Decrypt manifest
  const manifest = decryptManifest(dek);
  if (!manifest) {
    console.error('Manifest not found. Vault may be corrupted.');
    process.exit(1);
  }

  // Decrypt files to standard local paths
  const encyclopediaDir = path.join(CLAUDE_DIR, 'encyclopedia');
  const journalDirName = configGet('JOURNAL_DIR', 'journals');
  const journalDir = path.join(CLAUDE_DIR, journalDirName);

  let count = 0;
  for (const [relative, meta] of Object.entries(manifest.files)) {
    const encFile = encPath(relative);
    if (!fs.existsSync(encFile)) {
      console.error(`  MISSING: ${relative}.enc — skipping`);
      continue;
    }
    let destDir;
    if (relative.startsWith('encyclopedia/')) destDir = encyclopediaDir;
    else if (relative.startsWith('journals/')) destDir = journalDir;
    else continue;
    const destPath = path.join(destDir, path.basename(relative));
    decryptFile(dek, encFile, destPath);
    count++;
  }

  // Save vault state
  fs.mkdirSync(VAULT_STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(VAULT_STATE_DIR, '.unlocked'), '');
  fs.writeFileSync(path.join(VAULT_STATE_DIR, '.last-access'), new Date().toISOString());
  fs.writeFileSync(path.join(VAULT_STATE_DIR, '.dek-cache'), dek.toString('base64'));

  spawnWatchdog();

  console.error(`Vault unlocked. ${count} file(s) decrypted.`);
  console.log('UNLOCKED');
}
```

- [ ] **Step 2: Add the lock command**

Append to `journal-vault.js`:

```js
async function cmdLock() {
  if (!fs.existsSync(path.join(VAULT_STATE_DIR, '.unlocked'))) {
    console.error('Vault is already locked.');
    console.log('ALREADY_LOCKED');
    process.exit(0);
  }

  // Read cached DEK
  const dekCachePath = path.join(VAULT_STATE_DIR, '.dek-cache');
  if (!fs.existsSync(dekCachePath)) {
    console.error('DEK cache missing. Cannot lock properly — wiping local files.');
    wipePlaintext();
    wipeVaultState();
    console.log('LOCKED');
    process.exit(0);
  }
  const dek = Buffer.from(fs.readFileSync(dekCachePath, 'utf8').trim(), 'base64');

  // Re-encrypt dirty files
  const sourceFiles = discoverSourceFiles();
  const fileEntries = {};
  let reencrypted = 0;

  for (const file of sourceFiles) {
    const dest = encPath(file.relative);
    const srcMtime = fs.statSync(file.absolute).mtimeMs;
    const destMtime = fs.existsSync(dest) ? fs.statSync(dest).mtimeMs : 0;

    if (srcMtime > destMtime) {
      const size = encryptFile(dek, file.absolute, dest);
      fileEntries[file.relative] = { size };
      reencrypted++;
    } else {
      // Keep existing entry — read size from existing enc file
      const size = fs.existsSync(dest)
        ? aesGcmDecrypt(dek, fs.readFileSync(dest)).length
        : 0;
      fileEntries[file.relative] = { size };
    }
  }

  // Re-encrypt manifest
  encryptManifest(dek, buildManifest(fileEntries));

  // Wipe plaintext and state
  wipePlaintext();
  wipeVaultState();

  console.error(`Vault locked. ${reencrypted} file(s) re-encrypted.`);
  console.log('LOCKED');
}

function wipePlaintext() {
  const encyclopediaDir = path.join(CLAUDE_DIR, 'encyclopedia');
  const journalDirName = configGet('JOURNAL_DIR', 'journals');
  const journalDir = path.join(CLAUDE_DIR, journalDirName);

  for (const dir of [encyclopediaDir, journalDir]) {
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.md')) {
          fs.unlinkSync(path.join(dir, f));
        }
      }
    }
  }
}

function wipeVaultState() {
  // Kill watchdog
  const pidFile = path.join(VAULT_STATE_DIR, '.watchdog-pid');
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
      process.kill(pid, 'SIGTERM');
    } catch { /* already dead */ }
  }

  // Remove state directory
  if (fs.existsSync(VAULT_STATE_DIR)) {
    for (const f of fs.readdirSync(VAULT_STATE_DIR)) {
      fs.unlinkSync(path.join(VAULT_STATE_DIR, f));
    }
    fs.rmdirSync(VAULT_STATE_DIR);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add life/hooks/journal-vault.js
git commit -m "feat(vault): implement unlock and lock commands with dirty-file re-encryption"
```

---

### Task 6: Status, Change-Password, Recover, Rotate-Recovery Commands + CLI Dispatch

**Files:**
- Modify: `life/hooks/journal-vault.js`

Implement remaining commands and wire up the CLI argument dispatch.

- [ ] **Step 1: Add status command**

Append to `journal-vault.js`:

```js
async function cmdStatus() {
  const headerExists = fs.existsSync(vaultHeaderPath());
  const unlocked = fs.existsSync(path.join(VAULT_STATE_DIR, '.unlocked'));

  if (!headerExists) {
    console.log('VAULT: not initialized');
    return;
  }

  console.log(`VAULT: ${unlocked ? 'unlocked' : 'locked'}`);

  if (unlocked) {
    const lastAccess = path.join(VAULT_STATE_DIR, '.last-access');
    if (fs.existsSync(lastAccess)) {
      console.log(`Last access: ${fs.readFileSync(lastAccess, 'utf8').trim()}`);
    }
    const pidFile = path.join(VAULT_STATE_DIR, '.watchdog-pid');
    if (fs.existsSync(pidFile)) {
      console.log(`Watchdog PID: ${fs.readFileSync(pidFile, 'utf8').trim()}`);
    }
  }

  // Count encrypted files
  const vd = vaultDir();
  if (fs.existsSync(vd)) {
    let count = 0;
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory()) walk(path.join(dir, f.name));
        else if (f.name.endsWith('.enc') && f.name !== 'manifest.enc') count++;
      }
    };
    walk(vd);
    console.log(`Encrypted files: ${count}`);
  }
}
```

- [ ] **Step 2: Add change-password command**

Append to `journal-vault.js`:

```js
async function cmdChangePassword() {
  const headerPath = vaultHeaderPath();
  if (!fs.existsSync(headerPath)) {
    console.error('No vault found.');
    process.exit(1);
  }

  const header = JSON.parse(fs.readFileSync(headerPath, 'utf8'));
  const oldPassword = await promptPassword('Current password: ');

  const salt = Buffer.from(header.salt, 'base64');
  const oldKey = await deriveKey(oldPassword, salt, header.kdf);

  let dek;
  try {
    dek = unwrapDEK(oldKey, Buffer.from(header.wrappedDEK, 'base64'));
  } catch {
    console.error('Wrong password.');
    process.exit(1);
  }

  const newPassword = await promptPasswordConfirm('New password: ');
  const newSalt = crypto.randomBytes(16);
  const newKey = await deriveKey(newPassword, newSalt, header.kdf);
  const newWrappedDEK = wrapDEK(newKey, dek);

  header.salt = newSalt.toString('base64');
  header.wrappedDEK = newWrappedDEK.toString('base64');
  // recoveryWrappedDEK stays the same — it wraps the same DEK

  fs.writeFileSync(headerPath, JSON.stringify(header, null, 2) + '\n');

  // Update DEK cache if unlocked
  if (fs.existsSync(path.join(VAULT_STATE_DIR, '.dek-cache'))) {
    fs.writeFileSync(path.join(VAULT_STATE_DIR, '.dek-cache'), dek.toString('base64'));
  }

  console.error('Password changed.');
  console.log('PASSWORD_CHANGED');
}
```

- [ ] **Step 3: Add recover and rotate-recovery commands**

Append to `journal-vault.js`:

```js
async function cmdRecover() {
  const headerPath = vaultHeaderPath();
  if (!fs.existsSync(headerPath)) {
    console.error('No vault found.');
    process.exit(1);
  }

  const header = JSON.parse(fs.readFileSync(headerPath, 'utf8'));
  const recoveryKeyB64 = await promptPassword('Recovery key (base64): ');

  let dek;
  try {
    dek = unwrapDEK(Buffer.from(recoveryKeyB64, 'base64'), Buffer.from(header.recoveryWrappedDEK, 'base64'));
  } catch {
    console.error('Invalid recovery key.');
    process.exit(1);
  }

  const newPassword = await promptPasswordConfirm('New password: ');
  const newSalt = crypto.randomBytes(16);
  const newKey = await deriveKey(newPassword, newSalt, header.kdf);
  const newWrappedDEK = wrapDEK(newKey, dek);

  header.salt = newSalt.toString('base64');
  header.wrappedDEK = newWrappedDEK.toString('base64');

  fs.writeFileSync(headerPath, JSON.stringify(header, null, 2) + '\n');
  console.error('Password reset via recovery key.');
  console.log('RECOVERED');
}

async function cmdRotateRecovery() {
  if (!fs.existsSync(path.join(VAULT_STATE_DIR, '.unlocked'))) {
    console.error('Vault must be unlocked to rotate recovery key.');
    process.exit(1);
  }

  const dekCachePath = path.join(VAULT_STATE_DIR, '.dek-cache');
  const dek = Buffer.from(fs.readFileSync(dekCachePath, 'utf8').trim(), 'base64');

  const newRecoveryKey = crypto.randomBytes(32);
  const newRecoveryWrappedDEK = wrapDEK(newRecoveryKey, dek);

  const headerPath = vaultHeaderPath();
  const header = JSON.parse(fs.readFileSync(headerPath, 'utf8'));
  header.recoveryWrappedDEK = newRecoveryWrappedDEK.toString('base64');
  fs.writeFileSync(headerPath, JSON.stringify(header, null, 2) + '\n');

  console.error('');
  console.error('=== NEW RECOVERY KEY ===');
  console.error('Save this somewhere safe. The old recovery key is now invalid.');
  console.error(newRecoveryKey.toString('base64'));
  console.error('========================');
  console.log('RECOVERY_ROTATED');
}
```

- [ ] **Step 4: Add CLI dispatch**

Append to `journal-vault.js`:

```js
// --- CLI dispatch ---

const command = process.argv[2];

const commands = {
  init: cmdInit,
  unlock: cmdUnlock,
  lock: cmdLock,
  status: cmdStatus,
  'change-password': cmdChangePassword,
  recover: cmdRecover,
  'rotate-recovery': cmdRotateRecovery,
};

if (!command || !commands[command]) {
  console.error('Usage: node journal-vault.js <command>');
  console.error('Commands: ' + Object.keys(commands).join(', '));
  process.exit(1);
}

commands[command]().catch((err) => {
  console.error('Error: ' + err.message);
  process.exit(1);
});
```

- [ ] **Step 5: Test CLI dispatch works**

Run:
```bash
node life/hooks/journal-vault.js status
```

Expected: `VAULT: not initialized`

- [ ] **Step 6: Commit**

```bash
git add life/hooks/journal-vault.js
git commit -m "feat(vault): add status, change-password, recover, rotate-recovery commands and CLI dispatch"
```

---

### Task 7: Shell Hooks — Guard, Lock, Watchdog

**Files:**
- Create: `life/hooks/journal-vault-guard.sh`
- Create: `life/hooks/journal-vault-lock.sh`
- Create: `life/hooks/journal-vault-watchdog.sh`

- [ ] **Step 1: Create the PreToolUse guard hook**

```bash
#!/usr/bin/env bash
# journal-vault-guard.sh — PreToolUse hook (Bash|Read)
# Intercepts encyclopedia/journal access when vault is locked. Triggers unlock.
# Spec: core/specs/journal-vault-spec.md

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
VAULT_STATE="$CLAUDE_DIR/.vault-state"
CONFIG_FILE="$CLAUDE_DIR/toolkit-state/config.json"
VAULT_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/journal-vault.js"

# --- Check if vault is enabled ---
VAULT_ENABLED="false"
if [[ -f "$CONFIG_FILE" ]] && command -v node &>/dev/null; then
    VAULT_ENABLED=$(node -e "try{const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(c.vault_enabled===true?'true':'false')}catch{console.log('false')}" "$CONFIG_FILE" 2>/dev/null) || VAULT_ENABLED="false"
fi
[[ "$VAULT_ENABLED" != "true" ]] && exit 0

# --- Parse stdin ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_name||'')}catch{console.log('')}})" 2>/dev/null)

# --- Check if the tool targets journal/encyclopedia paths ---
TARGETS_VAULT="false"

if [[ "$TOOL_NAME" == "Read" ]]; then
    FILE_PATH=$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}catch{console.log('')}})" 2>/dev/null)
    FILE_PATH_UNIX="${FILE_PATH//\\//}"
    case "$FILE_PATH_UNIX" in
        */.claude/encyclopedia/*|*/.claude/journals/*) TARGETS_VAULT="true" ;;
    esac
elif [[ "$TOOL_NAME" == "Bash" ]]; then
    COMMAND=$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.tool_input?.command||'')}catch{console.log('')}})" 2>/dev/null)
    if echo "$COMMAND" | grep -qE 'encyclopedia|journals|The Journal'; then
        TARGETS_VAULT="true"
    fi
fi

[[ "$TARGETS_VAULT" != "true" ]] && exit 0

# --- Vault is targeted. Check state. ---
if [[ -f "$VAULT_STATE/.unlocked" ]]; then
    # Vault is unlocked — update last-access and allow
    date -Iseconds > "$VAULT_STATE/.last-access" 2>/dev/null
    exit 0
fi

# --- Vault is locked — trigger unlock ---
RESULT=$(node "$VAULT_JS" unlock 2>&1)
EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
    exit 0  # Unlocked — allow the original tool call
else
    echo "Journal vault is locked. Unlock cancelled or failed."
    echo "Say \"unlock the vault\" to try again."
    exit 1
fi
```

Write this to `life/hooks/journal-vault-guard.sh`.

- [ ] **Step 2: Create the SessionEnd lock hook**

```bash
#!/usr/bin/env bash
# journal-vault-lock.sh — SessionEnd hook
# Locks vault on session exit. Spec: core/specs/journal-vault-spec.md

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
VAULT_STATE="$CLAUDE_DIR/.vault-state"
VAULT_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/journal-vault.js"

# Only act if vault is unlocked
if [[ -f "$VAULT_STATE/.unlocked" ]]; then
    node "$VAULT_JS" lock 2>&1 | head -1
fi
```

Write this to `life/hooks/journal-vault-lock.sh`.

- [ ] **Step 3: Create the watchdog**

```bash
#!/usr/bin/env bash
# journal-vault-watchdog.sh — Background idle timeout monitor
# Usage: journal-vault-watchdog.sh <vault-state-dir> <timeout-minutes>
# Spec: core/specs/journal-vault-spec.md

VAULT_STATE="$1"
TIMEOUT_MINUTES="${2:-15}"
VAULT_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/journal-vault.js"
POLL_INTERVAL=60

[[ -z "$VAULT_STATE" ]] && exit 1

echo $$ > "$VAULT_STATE/.watchdog-pid"

while true; do
    sleep $POLL_INTERVAL

    # Exit if vault was locked externally
    [[ ! -f "$VAULT_STATE/.unlocked" ]] && exit 0

    # Check last access time
    if [[ -f "$VAULT_STATE/.last-access" ]]; then
        LAST_ACCESS=$(cat "$VAULT_STATE/.last-access")
        if command -v node &>/dev/null; then
            ELAPSED_MINUTES=$(node -e "
                const la = new Date(process.argv[1]);
                console.log(Math.floor((Date.now() - la.getTime()) / 60000));
            " "$LAST_ACCESS" 2>/dev/null) || continue

            if [[ "$ELAPSED_MINUTES" -ge "$TIMEOUT_MINUTES" ]]; then
                node "$VAULT_JS" lock 2>&1 | head -1
                exit 0
            fi
        fi
    fi
done
```

Write this to `life/hooks/journal-vault-watchdog.sh`.

- [ ] **Step 4: Make hooks executable**

```bash
chmod +x life/hooks/journal-vault-guard.sh life/hooks/journal-vault-lock.sh life/hooks/journal-vault-watchdog.sh
```

- [ ] **Step 5: Commit**

```bash
git add life/hooks/journal-vault-guard.sh life/hooks/journal-vault-lock.sh life/hooks/journal-vault-watchdog.sh
git commit -m "feat(vault): add guard, session-end lock, and watchdog hooks"
```

---

### Task 8: Hook Registration

**Files:**
- Modify: `core/hooks/hooks-manifest.json`

- [ ] **Step 1: Add vault hooks to the manifest**

Add to the `PreToolUse` array in `core/hooks/hooks-manifest.json`:

```json
{
  "command": "bash ~/.claude/hooks/journal-vault-guard.sh",
  "matcher": "Bash|Read",
  "timeout": 30,
  "required": false
}
```

Add to the `SessionEnd` array:

```json
{
  "command": "bash ~/.claude/hooks/journal-vault-lock.sh",
  "timeout": 15,
  "required": false
}
```

- [ ] **Step 2: Commit**

```bash
git add core/hooks/hooks-manifest.json
git commit -m "feat(vault): register guard and lock hooks in manifest"
```

---

### Task 9: Sync Integration — vault-aware sync.sh

**Files:**
- Modify: `core/hooks/sync.sh`

The sync hook needs three changes: (1) add vault files to path filter, (2) suppress plain-text encyclopedia push when vault is active, (3) push vault files in each backend.

- [ ] **Step 1: Add vault paths to the path filter**

In the `case "$FILE_PATH" in` block (around line 38), add after `*/encyclopedia/*) ;;`:

```bash
    */vault-header.json) ;;
    */vault/*.enc) ;;
```

- [ ] **Step 2: Add vault-enabled check near the top of sync functions**

After the config reading section (after `SYNC_REPO` is set, around line 82), add:

```bash
# --- Vault state ---
VAULT_ENABLED="false"
if type config_get &>/dev/null; then
    VAULT_ENABLED=$(config_get "vault_enabled" "false")
elif command -v node &>/dev/null && [[ -f "$CONFIG_FILE" ]]; then
    VAULT_ENABLED=$(node -e "try{const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(c.vault_enabled===true?'true':'false')}catch{console.log('false')}" "$CONFIG_FILE" 2>/dev/null) || VAULT_ENABLED="false"
fi
```

- [ ] **Step 3: Wrap encyclopedia push in vault check (sync_drive)**

In `sync_drive()`, wrap the encyclopedia section (lines 195-209) in a vault check:

```bash
    # Encyclopedia
    if [[ "$VAULT_ENABLED" != "true" ]]; then
        if [[ -d "$CLAUDE_DIR/encyclopedia" ]]; then
            rclone copy "$CLAUDE_DIR/encyclopedia/" "$REMOTE_BASE/encyclopedia/" \
                --update --max-depth 1 --include "*.md" 2>/dev/null || \
                log_backup "WARN" "Encyclopedia sync to Backup failed"

            local _enc_remote_path="The Journal/System"
            if [[ -f "$CONFIG_FILE" ]]; then
                local _enc_configured
                _enc_configured=$(grep -o '"encyclopedia_remote_path"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" 2>/dev/null | head -1 | sed 's/.*"encyclopedia_remote_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || true)
                [[ -n "$_enc_configured" ]] && _enc_remote_path="$_enc_configured"
            fi
            rclone copy "$CLAUDE_DIR/encyclopedia/" "gdrive:$DRIVE_ROOT/$_enc_remote_path/" \
                --update --max-depth 1 --include "*.md" 2>/dev/null || \
                log_backup "WARN" "Encyclopedia sync to The Journal/System failed"
        fi
    fi

    # Vault files (when vault is active)
    if [[ "$VAULT_ENABLED" == "true" ]]; then
        local _VAULT_DIR="$CLAUDE_DIR/$(config_get 'vault_remote_path' 'vault')"
        [[ -f "$CLAUDE_DIR/vault-header.json" ]] && \
            rclone copyto "$CLAUDE_DIR/vault-header.json" "$REMOTE_BASE/vault-header.json" \
                --checksum 2>/dev/null || \
                log_backup "WARN" "Vault header sync to Drive failed"
        [[ -d "$_VAULT_DIR" ]] && \
            rclone copy "$_VAULT_DIR/" "$REMOTE_BASE/vault/" \
                --checksum --include '*.enc' 2>/dev/null || \
                log_backup "WARN" "Vault files sync to Drive failed"
    fi
```

- [ ] **Step 4: Apply same pattern to sync_github and sync_icloud**

In `sync_github()`, wrap the encyclopedia `cp` (around line 349-351) in `if [[ "$VAULT_ENABLED" != "true" ]]`, and add vault push:

```bash
    if [[ "$VAULT_ENABLED" != "true" ]]; then
        [[ -d "$CLAUDE_DIR/encyclopedia" ]] && {
            mkdir -p "$REPO_DIR/encyclopedia"
            cp -r "$CLAUDE_DIR/encyclopedia"/* "$REPO_DIR/encyclopedia/" 2>/dev/null || true
        }
    fi

    # Vault files
    if [[ "$VAULT_ENABLED" == "true" ]]; then
        local _VAULT_DIR="$CLAUDE_DIR/$(config_get 'vault_remote_path' 'vault')"
        [[ -f "$CLAUDE_DIR/vault-header.json" ]] && cp "$CLAUDE_DIR/vault-header.json" "$REPO_DIR/vault-header.json" 2>/dev/null || true
        [[ -d "$_VAULT_DIR" ]] && { mkdir -p "$REPO_DIR/vault"; cp -r "$_VAULT_DIR"/* "$REPO_DIR/vault/" 2>/dev/null || true; }
    fi
```

In `sync_icloud()`, same pattern around line 465-468:

```bash
    if [[ "$VAULT_ENABLED" != "true" ]]; then
        [[ -d "$CLAUDE_DIR/encyclopedia" ]] && {
            mkdir -p "$ICLOUD_PATH/encyclopedia"
            rsync -a --update "$CLAUDE_DIR/encyclopedia/" "$ICLOUD_PATH/encyclopedia/" 2>/dev/null || \
                cp -r "$CLAUDE_DIR/encyclopedia"/* "$ICLOUD_PATH/encyclopedia/" 2>/dev/null || true
        }
    fi

    # Vault files
    if [[ "$VAULT_ENABLED" == "true" ]]; then
        local _VAULT_DIR="$CLAUDE_DIR/$(config_get 'vault_remote_path' 'vault')"
        [[ -f "$CLAUDE_DIR/vault-header.json" ]] && {
            rsync -a --checksum "$CLAUDE_DIR/vault-header.json" "$ICLOUD_PATH/vault-header.json" 2>/dev/null || \
                cp "$CLAUDE_DIR/vault-header.json" "$ICLOUD_PATH/vault-header.json" 2>/dev/null || true
        }
        [[ -d "$_VAULT_DIR" ]] && {
            mkdir -p "$ICLOUD_PATH/vault"
            rsync -a --checksum "$_VAULT_DIR/" "$ICLOUD_PATH/vault/" 2>/dev/null || \
                cp -r "$_VAULT_DIR"/* "$ICLOUD_PATH/vault/" 2>/dev/null || true
        }
    fi
```

- [ ] **Step 5: Commit**

```bash
git add core/hooks/sync.sh
git commit -m "feat(vault): vault-aware sync — suppress plain-text encyclopedia, push encrypted files"
```

---

### Task 10: Session-Start Integration — vault-aware pull

**Files:**
- Modify: `core/hooks/session-start.sh`

- [ ] **Step 1: Add vault pull to the Drive backend section**

In the Drive pull section (around line 336), wrap encyclopedia pull in vault check and add vault file pull:

```bash
                        # Encyclopedia — skip if vault is active
                        if [[ "$(config_get 'vault_enabled' 'false')" != "true" ]]; then
                            rclone copy "$DRIVE_SOURCE/encyclopedia/" "$CLAUDE_DIR/encyclopedia/" \
                                --update --max-depth 1 --include "*.md" 2>/dev/null &
                        fi
                        # Vault files — pull if vault is active
                        if [[ "$(config_get 'vault_enabled' 'false')" == "true" ]] || \
                           rclone lsf "$DRIVE_SOURCE/vault-header.json" 2>/dev/null | grep -q 'vault-header.json'; then
                            rclone copyto "$DRIVE_SOURCE/vault-header.json" "$CLAUDE_DIR/vault-header.json" \
                                --checksum 2>/dev/null &
                            local _VAULT_DIR="$CLAUDE_DIR/$(config_get 'vault_remote_path' 'vault')"
                            mkdir -p "$_VAULT_DIR"
                            rclone copy "$DRIVE_SOURCE/vault/" "$_VAULT_DIR/" \
                                --checksum --include '*.enc' 2>/dev/null &
                            # Auto-detect vault on fresh device
                            if [[ "$(config_get 'vault_enabled' 'false')" != "true" ]]; then
                                config_set "vault_enabled" "true" 2>/dev/null || true
                            fi
                        fi
```

- [ ] **Step 2: Apply same pattern to GitHub and iCloud backend pull sections**

For GitHub (around line 375):

```bash
                        if [[ "$(config_get 'vault_enabled' 'false')" != "true" ]]; then
                            [[ -d "$REPO_DIR/encyclopedia" ]] && rsync -a --update "$REPO_DIR/encyclopedia/" "$CLAUDE_DIR/encyclopedia/" 2>/dev/null || true
                        fi
                        # Vault files
                        if [[ -f "$REPO_DIR/vault-header.json" ]]; then
                            cp "$REPO_DIR/vault-header.json" "$CLAUDE_DIR/vault-header.json" 2>/dev/null || true
                            local _VAULT_DIR="$CLAUDE_DIR/$(config_get 'vault_remote_path' 'vault')"
                            [[ -d "$REPO_DIR/vault" ]] && { mkdir -p "$_VAULT_DIR"; cp -r "$REPO_DIR/vault"/* "$_VAULT_DIR/" 2>/dev/null || true; }
                            [[ "$(config_get 'vault_enabled' 'false')" != "true" ]] && config_set "vault_enabled" "true" 2>/dev/null || true
                        fi
```

For iCloud (around line 410):

```bash
                        if [[ "$(config_get 'vault_enabled' 'false')" != "true" ]]; then
                            [[ -d "$ICLOUD_PATH/encyclopedia" ]] && rsync -a --update "$ICLOUD_PATH/encyclopedia/" "$CLAUDE_DIR/encyclopedia/" 2>/dev/null || true
                        fi
                        # Vault files
                        if [[ -f "$ICLOUD_PATH/vault-header.json" ]]; then
                            cp "$ICLOUD_PATH/vault-header.json" "$CLAUDE_DIR/vault-header.json" 2>/dev/null || true
                            local _VAULT_DIR="$CLAUDE_DIR/$(config_get 'vault_remote_path' 'vault')"
                            [[ -d "$ICLOUD_PATH/vault" ]] && { mkdir -p "$_VAULT_DIR"; cp -r "$ICLOUD_PATH/vault"/* "$_VAULT_DIR/" 2>/dev/null || true; }
                            [[ "$(config_get 'vault_enabled' 'false')" != "true" ]] && config_set "vault_enabled" "true" 2>/dev/null || true
                        fi
```

- [ ] **Step 3: Add vault status message to the sync status output**

In the post-sync status section of session-start.sh, after the sync completes, add:

```bash
    # Vault status
    if [[ "$(config_get 'vault_enabled' 'false')" == "true" ]]; then
        if [[ ! -f "$CLAUDE_DIR/.vault-state/.unlocked" ]]; then
            echo "{\"hookSpecificOutput\": \"Journal vault locked — unlock to access encyclopedia and journal files\"}" >&2
        fi
    fi
```

- [ ] **Step 4: Commit**

```bash
git add core/hooks/session-start.sh
git commit -m "feat(vault): vault-aware session-start — pull encrypted files, auto-detect vault on fresh device"
```

---

### Task 11: End-to-End Manual Test

No files to create — this is a verification task.

- [ ] **Step 1: Test init**

```bash
# Ensure you have some encyclopedia files in ~/.claude/encyclopedia/
node life/hooks/journal-vault.js init
```

Expected: Password prompt → encryption → recovery key displayed → `INITIALIZED`

- [ ] **Step 2: Test status while unlocked**

```bash
node life/hooks/journal-vault.js status
```

Expected: `VAULT: unlocked`, file count, watchdog PID

- [ ] **Step 3: Test lock**

```bash
node life/hooks/journal-vault.js lock
```

Expected: `LOCKED`, encyclopedia directory emptied, `.vault-state/` removed, `.enc` files exist in vault dir

- [ ] **Step 4: Test unlock**

```bash
node life/hooks/journal-vault.js unlock
```

Expected: Password prompt → `UNLOCKED`, encyclopedia files restored

- [ ] **Step 5: Test wrong password**

```bash
node life/hooks/journal-vault.js lock
node life/hooks/journal-vault.js unlock
# Enter wrong password
```

Expected: `Wrong password.`, exit code 1

- [ ] **Step 6: Verify encrypted files exist**

```bash
ls -la ~/.claude/vault/
ls -la ~/.claude/vault/encyclopedia/
```

Expected: `manifest.enc` and `*.md.enc` files

- [ ] **Step 7: Test change-password**

```bash
node life/hooks/journal-vault.js unlock
node life/hooks/journal-vault.js change-password
```

Expected: Old password prompt → new password prompt → confirm → `PASSWORD_CHANGED`

- [ ] **Step 8: Commit all work on the feature branch**

```bash
git add -A
git commit -m "feat(vault): complete journal vault v1 — Node.js crypto, per-file encryption, multi-backend sync"
```
