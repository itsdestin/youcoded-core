# Conversation Index — Spec

**Version:** 1.0
**Last updated:** 2026-04-05
**Feature location:** `core/hooks/lib/backup-common.sh` (utility functions), integrated into `sync.sh`, `session-start.sh`, `session-end-sync.sh`

## Purpose

Provides cross-device conversation topic/title continuity. Topics are stored locally as ephemeral files (`~/.claude/topics/topic-{SESSION_ID}`) but were previously not synced, causing `/resume` to show "New Session" on other devices. The conversation index maps session IDs to topic metadata in a single JSON file that syncs alongside other personal data, enabling meaningful conversation names on every device.

## User Mandates

- (2026-04-05) The index must NEVER replace local topic files as the source of truth for sessions on the originating device. Local topic files are authoritative; the index is a sync artifact.
- (2026-04-05) Index sync must follow the same failure semantics as personal-sync: failures are logged but must not block the session or other sync operations.

## Design Decisions

| Decision | Rationale | Alternatives considered |
|----------|-----------|----------------------|
| Lazy build from topic files during sync | title-update.sh tells Claude to write topic files via `echo` (Bash tool), not the Write tool — so the PostToolUse Write|Edit trigger doesn't fire for topic writes. Building the index during the already-scheduled sync cycle avoids adding new hook registrations. | Real-time index update on every topic write (requires new hook or file watcher — complexity for minimal latency benefit), title-update.sh writes to index directly (hook doesn't know topic content — only emits a reminder). |
| Single JSON file, not per-session sidecar files | One file to sync is cheaper and simpler than N small files. The index is small (a few KB even with hundreds of sessions). Merge semantics are trivial on a single file. | Per-session `.meta.json` files alongside `.jsonl` (file proliferation, must update sync globs), topic files in sync scope directly (hundreds of tiny files, pruning complications). |
| Union merge with latest-lastActive-wins | Sessions are created on a single device, so the same session ID on two devices means the index was synced. `lastActive` monotonically increases. Latest-wins is always correct and deterministic. | Conflict markers (overkill for metadata), manual resolution (defeats automation). |
| `system-backup/` remote path | Matches the approved sync-consolidation-design (04-01-2026) D3 layout. Ensures zero rework when consolidation from personal-sync + git-sync to unified sync.sh lands. | `personal/` root (would need to move later), `topics/` (non-standard location). |
| Topic cache files regenerated on pull, never overwritten | Existing local topic files may have more recent updates not yet scanned into the index. `regenerate_topic_cache()` only creates files for sessions without a local topic file. | Always overwrite (loses in-progress topic updates), merge per-file (unnecessary complexity). |
| 30-day pruning | More generous than the 7-day topic file pruning in title-update.sh because the index is small and longer retention improves cross-device coverage. Pruning runs during `update_conversation_index()`. | Match 7-day pruning (too aggressive for cross-device scenarios), no pruning (unbounded growth). |
| No-op when node unavailable | JSON manipulation requires node. If unavailable, the index update is skipped and logged. The index is an enhancement — absence doesn't break any existing functionality. | Grep/sed JSON manipulation (fragile and error-prone), hard failure (violates non-blocking mandate). |

## File Format

```json
{
  "version": 1,
  "sessions": {
    "<session-id>": {
      "topic": "Human-readable conversation title",
      "lastActive": "2026-04-05T01:15:00.000Z",
      "slug": "C--Users-username",
      "device": "DESKTOP-ABC-windows"
    }
  }
}
```

- `version`: Schema version for future migration support
- `topic`: The conversation title set by Claude via title-update.sh
- `lastActive`: ISO 8601 timestamp of the topic file's last modification time
- `slug`: Project slug on the device that last updated this entry
- `device`: `"${hostname}-${platform}"` identifier of the originating device

## Data Flow

```
Write:   Claude --echo--> topic file --scan during sync--> index --push--> remote
Read:    statusline --reads--> topic file (local cache, unchanged)
Restore: pull --merge--> local index --regenerate--> topic cache files
```

## Integration Points

| Component | Role | Changes |
|-----------|------|---------|
| `backup-common.sh` | Utility functions: `get_device_name()`, `update_conversation_index()`, `merge_conversation_index()`, `regenerate_topic_cache()` | New functions added |
| `sync.sh` | Pre-push index build, per-backend push | Path filter + push logic per backend |
| `session-start.sh` | Pull remote index to staging, post-pull merge + cache regeneration | Per-backend pull + sequential post-pull |
| `session-end-sync.sh` | Best-effort index update + push at session exit | Added after JSONL push |
| `title-update.sh` | Unchanged — topic files remain the write mechanism | No changes |
| `statusline.sh` | Unchanged — reads topic cache files | No changes |

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-04-05 | Initial spec: cross-device topic sync via conversation index |
