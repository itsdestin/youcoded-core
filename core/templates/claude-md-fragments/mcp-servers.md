## MCP Server Configuration

**IMPORTANT:** Local MCP servers are configured in `~/.claude.json` (NOT `~/.claude/mcp.json`), under `projects["<project-path>"].mcpServers`. The `/mcp` command manages this.

| Server | Type | Purpose |
|---|---|---|
| `windows-control` | stdio (uvx) | Windows desktop interaction (Windows only) |
| `gmessages` | stdio (Go) | Google Messages SMS/RCS read/write via libgm |
| `todoist` | http | Todoist task management |

MCP server code lives at `<toolkit_root>/productivity/mcp-servers/<name>/`.
