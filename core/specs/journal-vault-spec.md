# Journal Vault — Spec

**Version:** 1.0
**Last updated:** 2026-04-05
**Feature location:** `life/hooks/journal-vault.js`, `life/hooks/journal-vault-guard.sh`, `life/hooks/journal-vault-lock.sh`, `life/hooks/journal-vault-watchdog.sh`
**Supersedes:** Original PowerShell-based vault (reverted in f1a9bd1)

## Purpose

Encrypts all journal and encyclopedia files at rest on remote backends (Google Drive, GitHub, iCloud). Files are decrypted only locally after password entry, and re-encrypted on lock or session exit. The rest of the toolkit sees the same local paths as today — skills, hooks, and the sync system require minimal changes.

## User Mandates

- (2026-04-05) Encrypted files MUST be synced to all configured remote backends. Files must never be local-only — losing the device must not mean losing the vault.
- (2026-04-05) A user on a fresh device with the correct password MUST be able to downsync and unlock the vault without any special migration steps.
- (2026-04-05) If both password and recovery key are lost, files are unrecoverable. This is the intended security property.

## Design Decisions

| ID | Decision | Rationale | Alternatives considered |
|----|----------|-----------|------------------------|
| D1 | Node.js `crypto` module instead of PowerShell + .NET DLLs | The toolkit already requires Node.js everywhere. Eliminates PowerShell 7 dependency, binary DLLs, and Windows-only WPF dialogs. Cross-platform by default. | PowerShell 7 + Argon2/Blake2 DLLs (original — reverted for platform issues), rclone crypt overlay (gives up unlock/lock lifecycle control) |
| D2 | `crypto.scrypt` instead of Argon2id for KDF | Built into Node.js with zero dependencies. Memory-hard (64MB at N=65536). 134ms derivation time. Argon2id is theoretically superior but requires native C bindings — not worth the dependency for a personal vault. | Argon2id via `argon2` npm package (native compilation required), PBKDF2 (not memory-hard, insufficient for modern threat model) |
| D3 | Per-file encryption with shared DEK instead of single blob | Plays with the existing sync system — `sync.sh` pushes individual files with `--checksum`. Only changed files get re-encrypted and re-uploaded. Single blob would re-upload everything on every change and conflict with rclone's diffing. | Single encrypted blob (original design — re-uploads entire vault on any change), rclone crypt (transparent but loses lock/unlock semantics) |
| D4 | Envelope encryption: password wraps DEK, DEK encrypts files | Password changes only re-wrap the DEK — no file re-encryption. Recovery key independently wraps the same DEK. Standard pattern (AWS KMS, age, etc.). | Direct password-derived key for file encryption (password change = re-encrypt everything) |
| D5 | Guard blocks and triggers unlock instead of rewriting commands | The old guard parsed rclone subcommands and rewrote them — fragile and incomplete. New approach: block the tool call, trigger unlock (which populates local paths), then allow retry. Skills already read from standard local paths. | Command rewriting (original — fragile, required per-subcommand handling) |
| D6 | `readline` for password prompt instead of WPF | Works on all platforms. In the desktop app, the terminal is an xterm.js instance — readline works there too. A future Electron IPC modal can be added without changing the vault module. | WPF popup (Windows-only), zenity (Linux GUI dependency), Electron IPC modal (future enhancement, not needed for v1) |
| D7 | Config in existing `config.json` via `config_get()` | Vault settings are just 3 keys. No reason for a separate config file. Consistent with how every other feature stores config. | Separate `journal-vault.json` (original — unnecessary file proliferation) |

## Crypto Architecture

### Algorithms

| Component | Algorithm | Parameters |
|-----------|-----------|------------|
| KDF | scrypt | N=65536 (64MB), r=8, p=1, 16-byte salt |
| File encryption | AES-256-GCM | 12-byte random IV per file, 16-byte auth tag |
| DEK wrapping | AES-256-GCM | Same as file encryption, applied to 32-byte DEK |

### Key Hierarchy

```
Password (user input)
  └─ scrypt(password, salt) ──► Wrapping Key (32 bytes)
                                  └─ AES-256-GCM wrap ──► Wrapped DEK
                                                             │
Recovery Key (random 32 bytes, shown once as base64)         │
  └─ AES-256-GCM wrap ──► Recovery-Wrapped DEK               │
                                                             │
DEK (random 32 bytes) ◄─────────────────────────────────────┘
  └─ AES-256-GCM encrypt ──► Each file individually
  └─ AES-256-GCM encrypt ──► Manifest
```

### Vault Header (`vault-header.json`, plaintext — synced to all backends)

```json
{
  "version": 1,
  "kdf": { "algorithm": "scrypt", "N": 65536, "r": 8, "p": 1 },
  "salt": "<base64, 16 bytes>",
  "wrappedDEK": "<base64, nonce + ciphertext + tag = 60 bytes>",
  "recoveryWrappedDEK": "<base64, 60 bytes>"
}
```

Contains no sensitive data — only the parameters needed to derive the wrapping key from a password.

### Encrypted Manifest (`manifest.enc`, encrypted with DEK)

Decrypted content:

```json
{
  "version": 1,
  "files": {
    "encyclopedia/Core Identity.md": { "size": 1234 },
    "encyclopedia/Status Snapshot.md": { "size": 567 },
    "journals/2026-04-05.md": { "size": 890 }
  }
}
```

IVs and auth tags are stored as the first 12 bytes and last 16 bytes of each `.enc` file (standard GCM layout), not in the manifest. The manifest tracks the file inventory and plaintext sizes for integrity checking.

## File Layout

### Remote (Drive/GitHub/iCloud — replaces plain-text copies when vault is active)

```
Backup/personal/
  vault-header.json
  vault/
    manifest.enc
    encyclopedia/
      Core Identity.md.enc
      Status Snapshot.md.enc
      People Database.md.enc
      Chronicle.md.enc
      Beliefs and Positions.md.enc
      Predictions.md.enc
      Open Threads and Goals.md.enc
      Preferences and Reference Data.md.enc
    journals/
      2026-04-05.md.enc
      ...
```

### Local (decrypted, only exists while vault is unlocked)

```
~/.claude/
  encyclopedia/          # standard path, populated by unlock
  journals/              # standard path, populated by unlock
  .vault-state/
    .unlocked            # marker: presence = vault is unlocked
    .last-access         # ISO timestamp, updated on file access
    .dek-cache           # cached DEK (wiped on lock)
    .watchdog-pid        # PID of background watchdog process
```

## Components

### `journal-vault.js` — Core Module

Location: `life/hooks/journal-vault.js`

CLI interface: `node journal-vault.js <command>`

| Command | Purpose |
|---------|---------|
| `init` | First-time setup: create DEK, wrap with password + recovery key, encrypt existing files, push to backends, remove plain-text remote copies |
| `unlock` | Prompt for password, derive wrapping key, unwrap DEK, decrypt files to local paths, start watchdog |
| `lock` | Re-encrypt dirty files, push to backends, wipe local decrypted files and DEK cache, kill watchdog |
| `status` | Print vault state: locked/unlocked, file count, last access time, watchdog PID |
| `change-password` | Prompt for old password, verify, prompt for new password, re-wrap DEK, update vault-header.json |
| `recover` | Prompt for recovery key (base64), unwrap DEK, prompt for new password, re-wrap DEK |
| `rotate-recovery` | Generate new recovery key, re-wrap DEK, display new key. Requires vault to be unlocked. |

Password prompt uses Node.js `readline` with terminal echo disabled (`process.stdin.setRawMode(true)` for hidden input).

### `journal-vault-guard.sh` — PreToolUse Hook

Location: `life/hooks/journal-vault-guard.sh`
Event: PreToolUse, matcher: `Bash|Read`

Logic:
1. Parse tool name and input from stdin JSON
2. For `Read`: check if `file_path` is under `~/.claude/encyclopedia/` or `~/.claude/journals/`
3. For `Bash`: check if command references journal/encyclopedia paths or rclone commands targeting The Journal
4. If vault is not enabled (`vault_enabled` not true in config) → exit 0
5. If vault is unlocked (`.vault-state/.unlocked` exists) → touch `.last-access`, exit 0
6. If vault is locked → call `node journal-vault.js unlock`
   - On success → exit 0 (tool call proceeds, files are now available)
   - On failure (cancelled/wrong password) → exit 1 with message instructing Claude that vault is locked

### `journal-vault-lock.sh` — SessionEnd Hook

Location: `life/hooks/journal-vault-lock.sh`
Event: SessionEnd

Logic:
1. If `.vault-state/.unlocked` exists → call `node journal-vault.js lock`
2. Hard timeout: 15 seconds (enforced by settings.json timeout property)

### `journal-vault-watchdog.sh` — Background Timeout Monitor

Location: `life/hooks/journal-vault-watchdog.sh`
Spawned by: `journal-vault.js unlock`

Logic:
1. Poll every 60 seconds
2. Read `.vault-state/.last-access` timestamp
3. If elapsed time > `vault_timeout_minutes` → call `node journal-vault.js lock`
4. Exit if `.vault-state/.unlocked` disappears (locked externally)

## Sync Integration

### `sync.sh` Changes

When `vault_enabled` is true in config:

**Path filter addition:**
- `*/vault-header.json` and `*/vault/*.enc` are added to the sync scope

**Encyclopedia/journal suppression:**
- The existing encyclopedia push to `The Journal/System/` is skipped
- The existing encyclopedia push to `Backup/personal/encyclopedia/` is skipped
- Journal files are not pushed as plain text

**Vault file push (all 3 backends):**
- `vault-header.json` → `Backup/personal/vault-header.json`
- `vault/*.enc` → `Backup/personal/vault/`

Dirty detection: on lock, only files with mtime newer than their `.enc` counterpart are re-encrypted. The lock command handles encryption; `sync.sh` just pushes whatever `.enc` files exist.

### `session-start.sh` Changes

**Pull behavior when vault is detected:**
- Pull `vault-header.json` and `vault/` from preferred backend
- If vault-header.json exists but local files are not decrypted → status message: "Journal vault locked — unlock to access encyclopedia and journal files"
- Skip encyclopedia cache population from `Backup/personal/encyclopedia/` (would be empty or stale anyway)

## Config

Three keys in `~/.claude/toolkit-state/config.json`:

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `vault_enabled` | boolean | `false` | Master switch. Set to `true` by `init`, read by guard and sync. |
| `vault_timeout_minutes` | number | `15` | Idle timeout before watchdog auto-locks. |
| `vault_remote_path` | string | `"vault"` | Subdirectory name under `Backup/personal/` for encrypted files. |

## Lifecycle Flows

### Init (first time)

```
User: "set up journal vault"
  → Claude runs: node journal-vault.js init
    → Prompt password (twice)
    → Generate DEK (32 random bytes)
    → Generate recovery key (32 random bytes)
    → scrypt(password, salt) → wrapping key
    → Wrap DEK with wrapping key → wrappedDEK
    → Wrap DEK with recovery key → recoveryWrappedDEK
    → Write vault-header.json
    → Encrypt each encyclopedia + journal file → .enc files
    → Build and encrypt manifest
    → Set vault_enabled=true in config.json
    → Display recovery key (base64) — "Save this somewhere safe. Shown once."
    → Push vault-header.json + vault/ to all backends
    → Remove plain-text encyclopedia/journal from remote backends
    → Start watchdog
```

### Unlock

```
Guard hook detects locked vault + journal path access
  → node journal-vault.js unlock
    → Prompt password
    → Read vault-header.json
    → scrypt(password, salt) → wrapping key
    → Unwrap DEK (AES-256-GCM decrypt wrappedDEK)
    → If unwrap fails → "Wrong password", exit 1
    → Cache DEK to .vault-state/.dek-cache
    → Decrypt manifest → get file list
    → Decrypt each .enc file → write to standard local path
    → Create .vault-state/.unlocked + .last-access
    → Spawn watchdog in background
    → Print "UNLOCKED" to stdout
```

### Lock

```
Triggered by: manual command, SessionEnd hook, or watchdog timeout
  → node journal-vault.js lock
    → Read cached DEK from .vault-state/.dek-cache
    → For each local file: if mtime > .enc file mtime → re-encrypt
    → Re-encrypt manifest
    → Wipe ~/.claude/encyclopedia/* and ~/.claude/journals/*
    → Wipe .vault-state/ entirely
    → Kill watchdog process (read PID from .watchdog-pid)
    → Print "LOCKED" to stdout
    → Push updated .enc files to all backends immediately (lock is explicit,
      don't defer to debounced sync — user may be shutting down)
```

### Cross-Device Recovery

```
Fresh DestinCode install
  → Setup wizard configures backends
  → session-start.sh pulls from preferred backend
  → vault-header.json detected → vault_enabled=true set in local config
  → Status: "Journal vault locked"
  → User accesses encyclopedia → guard triggers unlock
  → Password entered → files decrypted → working state
```

## Hook Registration (hooks-manifest.json additions)

```json
{
  "PreToolUse": [
    {
      "command": "bash ~/.claude/hooks/journal-vault-guard.sh",
      "matcher": "Bash|Read",
      "timeout": 30,
      "required": false
    }
  ],
  "SessionEnd": [
    {
      "command": "bash ~/.claude/hooks/journal-vault-lock.sh",
      "timeout": 15,
      "required": false
    }
  ]
}
```

Both hooks are `required: false` — vault is optional. If the hooks fail (e.g., node not available), the session continues without vault protection.

## Dependencies

- **Depends on:**
  - Node.js `crypto` module (built-in) — scrypt, AES-256-GCM, randomBytes
  - Node.js `readline` module (built-in) — password prompt
  - `lib/backup-common.sh` — `config_get()`, `log_backup()`
  - `sync.sh` — pushes encrypted files to backends
  - `session-start.sh` — pulls encrypted files on session start

- **Depended on by:**
  - Encyclopedia skills (encyclopedia-update, encyclopedia-compile, encyclopedia-interviewer, encyclopedia-librarian) — indirectly; they read from `~/.claude/encyclopedia/` which the vault populates on unlock
  - Journaling assistant — reads/writes `~/.claude/journals/` which the vault manages
  - `sync.sh` — vault-aware path filter and suppression logic

## Security Properties

- Files encrypted at rest on all remote backends (AES-256-GCM)
- Files decrypted only locally, only while vault is unlocked
- DEK never leaves the local machine in plaintext
- Password never stored — only used transiently to derive wrapping key
- Recovery key shown once at init — not stored by the system
- Auto-lock on idle timeout and session exit
- Tamper detection via GCM authentication tags

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-04-05 | Initial spec: Node.js rewrite of journal vault with per-file encryption, scrypt KDF, multi-backend sync |
