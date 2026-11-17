# @apocryphon/cli

Terminal interface for Apocryphon.

```bash
npm install -g @apocryphon/cli
apocryphon --help
```

Requires Node.js >= 20.

## Commands

| Command | Description |
| ------- | ----------- |
| `apocryphon init` | Create `~/.apocryphon`, configure clients, connect a registry. |
| `apocryphon clients list/enable/disable` | Choose which clients receive symlinks. |
| `apocryphon use` | Interactive skill/pack picker (project or `--global`). |
| `apocryphon search <query>` | Search the catalog. |
| `apocryphon install <skills...>` | Install/update skills in the vault. |
| `apocryphon list` | Installed skills with scopes and lint status. |
| `apocryphon enable/disable <items...>` | Toggle skills or packs (`--global` for all projects). |
| `apocryphon pack list/apply/remove` | Manage packs. |
| `apocryphon sync` | Pull registry, update skills, reconcile links (`--all`, `--offline`). |
| `apocryphon validate [paths...]` | Lint skills (`--registry` to check the catalog). |
| `apocryphon status` | Clients, active skills, context budget, git exclude, integrity. |
| `apocryphon mcp` | Optional stdio MCP server. |

## Optional MCP server

`apocryphon mcp` is intentionally not bundled to keep the CLI light. Install the
SDK next to the CLI:

```bash
npm install -g @modelcontextprotocol/sdk
```

Then register `apocryphon mcp` as an MCP server in your client.

## Notes

- `APOCRYPHON_HOME` overrides the state directory (useful for tests).
- All read-only commands accept `--json` where it makes sense.
