# @hexalis/skill-store-cli

Terminal interface for Skill Store.

```bash
npm install -g @hexalis/skill-store-cli
skill-store --help
hss --help          # equivalent short alias
```

Requires Node.js >= 22.

## Highlights

- Interactive pickers with **fuzzy search** (`use`, `install`, `find`, `browse`).
- **Categories and tags** for discovery.
- **Shell completions** (bash, zsh, fish) and an interactive launcher when you run
  `skill-store` with no arguments.
- **Customization-safe updates**: diffs, three-way merges, `--force`/`--keep/--merge`
  and automatic backups.
- **Local skills**: `skill-store new` and `skill-store import`.

## Commands

| Command | Description |
| ------- | ----------- |
| `skill-store init` | Create `~/.skill-store`, configure clients, connect the default registry. |
| `skill-store registry show/use/default` | Inspect or switch the active skill source (local, Git, Azure). |
| `skill-store clients list/enable/disable` | Choose which clients receive symlinks. |
| `skill-store use` | Interactive skill/pack picker (project or `--global`). |
| `skill-store find [query]` | Fuzzy picker with preview and actions. |
| `skill-store browse` | Explore installed skills by category. |
| `skill-store tags` / `categories` | Tag and category counts. |
| `skill-store search <query>` | Fuzzy search (`--category`, `--tag`, `--fzf`). |
| `skill-store install [skills...]` | Install/update (`--all`, `--filter`). |
| `skill-store list` | Installed skills, scopes and customization state. |
| `skill-store enable/disable <items...>` | Toggle skills or packs (`--global`). |
| `skill-store pack list/apply/remove` | Manage packs. |
| `skill-store sync` | Plan/apply registry updates (`--dry-run`, `--force`, `--keep`, `--merge`, `--all`, `--offline`). |
| `skill-store diff <id>` | Show local and registry changes. |
| `skill-store reset <id>` | Discard local changes (restore pristine). |
| `skill-store adopt <id>` | Adopt the current vault copy as the baseline. |
| `skill-store backups list/restore` | Inspect or restore update backups. |
| `skill-store new <id>` | Create a local skill. |
| `skill-store import <source>` | Import a skill from a path or Git URL. |
| `skill-store validate [paths...]` | Lint skills (`--registry`, `--strict`). |
| `skill-store status` | Clients, active skills, budget, customization, hygiene. |
| `skill-store completion bash\|zsh\|fish` | Print completions (`--install` to write them). |
| `skill-store mcp` | Optional stdio MCP server. |

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

Edit skills directly in `~/.skill-store/vault/<id>/`. Skill Store keeps a pristine
copy and per-file hashes, so it never overwrites your changes silently:

```bash
skill-store diff <id>
skill-store sync --dry-run
skill-store sync --merge      # three-way merge
skill-store sync --keep       # keep yours
skill-store sync --force      # registry wins (backup first)
```

Without a TTY and without flags, `sync` aborts when a customized skill has an
update. See `docs/skill-updates.md` in the repository for details.

## Registry source

The Hexalis registry is the default: `git@github.com:hexalis/skill-registry.git`.
It is private, so access to the Hexalis organization is required. Use `registry`
to inspect or switch sources:

```bash
skill-store registry show
skill-store registry use ~/dev/skills
skill-store registry use git@ssh.dev.azure.com:v3/org/project/repo
skill-store registry use <url> --ref v1.0.0
skill-store registry default
```

`config.json` stores `registry: null` for the default or an explicit
`{ source, ref }` override. Local paths are stored absolute. Git clones live in
`~/.skill-store/registries/<hash>/`, one per source/ref. Switching sources never
deletes installed skills, local edits, backups or project activations.

`SKILL_STORE_DEFAULT_REGISTRY` overrides the built-in default source. Use
`skill-store init --skip-registry` to bootstrap without fetching the catalog.

## Shell completions

```bash
# Print
skill-store completion bash

# Install for the current shell
skill-store completion --install
skill-store completion install --shell zsh
```

## Optional MCP server

`skill-store mcp` is intentionally not bundled to keep the CLI light. Install the
SDK next to the CLI:

```bash
npm install -g @modelcontextprotocol/sdk
```

Then register `skill-store mcp` as an MCP server in your client.

## Notes

- `SKILL_STORE_HOME` overrides the state directory (useful for tests).
- Commands are non-interactive by default when there is no TTY; use flags to
  express destructive decisions explicitly.
