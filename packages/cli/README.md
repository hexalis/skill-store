# @apocryphon/cli

Terminal interface for Apocryphon.

```bash
npm install -g @apocryphon/cli
apocryphon --help
```

Requires Node.js >= 20.

## Highlights

- Interactive pickers with **fuzzy search** (`use`, `install`, `find`, `browse`).
- **Categories and tags** for discovery.
- **Shell completions** (bash, zsh, fish) and an interactive launcher when you run
  `apocryphon` with no arguments.
- **Customization-safe updates**: diffs, three-way merges, `--force`/`--keep/--merge`
  and automatic backups.
- **Local skills**: `apocryphon new` and `apocryphon import`.

## Commands

| Command | Description |
| ------- | ----------- |
| `apocryphon init` | Create `~/.apocryphon`, configure clients, connect the default registry. |
| `apocryphon registry show/use/default` | Inspect or switch the active skill source (local, Git, Azure). |
| `apocryphon clients list/enable/disable` | Choose which clients receive symlinks. |
| `apocryphon use` | Interactive skill/pack picker (project or `--global`). |
| `apocryphon find [query]` | Fuzzy picker with preview and actions. |
| `apocryphon browse` | Explore installed skills by category. |
| `apocryphon tags` / `categories` | Tag and category counts. |
| `apocryphon search <query>` | Fuzzy search (`--category`, `--tag`, `--fzf`). |
| `apocryphon install [skills...]` | Install/update (`--all`, `--filter`). |
| `apocryphon list` | Installed skills, scopes and customization state. |
| `apocryphon enable/disable <items...>` | Toggle skills or packs (`--global`). |
| `apocryphon pack list/apply/remove` | Manage packs. |
| `apocryphon sync` | Plan/apply registry updates (`--dry-run`, `--force`, `--keep`, `--merge`, `--all`, `--offline`). |
| `apocryphon diff <id>` | Show local and registry changes. |
| `apocryphon reset <id>` | Discard local changes (restore pristine). |
| `apocryphon adopt <id>` | Adopt the current vault copy as the baseline. |
| `apocryphon backups list/restore` | Inspect or restore update backups. |
| `apocryphon new <id>` | Create a local skill. |
| `apocryphon import <source>` | Import a skill from a path or Git URL. |
| `apocryphon validate [paths...]` | Lint skills (`--registry`, `--strict`). |
| `apocryphon status` | Clients, active skills, budget, customization, hygiene. |
| `apocryphon completion bash\|zsh\|fish` | Print completions (`--install` to write them). |
| `apocryphon mcp` | Optional stdio MCP server. |

## Global flags

| Flag | Behavior |
| ---- | -------- |
| `--quiet` | Only warnings and errors. |
| `--verbose` | Extra paths, git commands and context. |
| `--no-color` | Disable ANSI colors (also `NO_COLOR`). |
| `-y, --yes` | Accept confirmations (required in non-interactive environments). |

`--json` is available on `status`, `list`, `search`, `validate`, `sync`,
`clients list`, `pack list`, `backups list`, `tags`, `categories` and `browse`.

## Safe updates

Edit skills directly in `~/.apocryphon/vault/<id>/`. Apocryphon keeps a pristine
copy and per-file hashes, so it never overwrites your changes silently:

```bash
apocryphon diff <id>
apocryphon sync --dry-run
apocryphon sync --merge      # three-way merge
apocryphon sync --keep       # keep yours
apocryphon sync --force      # registry wins (backup first)
```

Without a TTY and without flags, `sync` aborts when a customized skill has an
update. See `docs/skill-updates.md` in the repository for details.

## Registry source

The official catalog is the default. Use `registry` to inspect or switch sources:

```bash
apocryphon registry show
apocryphon registry use ~/dev/skills
apocryphon registry use git@ssh.dev.azure.com:v3/org/project/repo
apocryphon registry use <url> --ref v1.0.0
apocryphon registry default
```

`config.json` stores `registry: null` for the default or an explicit
`{ source, ref }` override. Local paths are stored absolute. Git clones live in
`~/.apocryphon/registries/<hash>/`, one per source/ref. Switching sources never
deletes installed skills, local edits, backups or project activations.

`APOCRYPHON_DEFAULT_REGISTRY` overrides the built-in default source. Use
`apocryphon init --skip-registry` to bootstrap without fetching the catalog.

## Shell completions

```bash
# Print
apocryphon completion bash

# Install for the current shell
apocryphon completion --install
apocryphon completion install --shell zsh
```

## Optional MCP server

`apocryphon mcp` is intentionally not bundled to keep the CLI light. Install the
SDK next to the CLI:

```bash
npm install -g @modelcontextprotocol/sdk
```

Then register `apocryphon mcp` as an MCP server in your client.

## Notes

- `APOCRYPHON_HOME` overrides the state directory (useful for tests).
- Commands are non-interactive by default when there is no TTY; use flags to
  express destructive decisions explicitly.
