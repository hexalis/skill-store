# Apocryphon

**Apocryphon** is a local skill store and manager for coding agents. It installs,
validates and activates [Agent Skills](https://opencode.ai/docs/skills) for
**Claude Code**, **Cursor** and **OpenCode**, globally or per project, without
modifying the shared `.gitignore` of your repositories.

It is designed for environments where you cannot run an external orchestration
harness: Apocryphon guides the agents from inside the native IDE/CLI using
high-quality skill descriptions and deterministic verification scripts.

## Packages

| Package | Purpose |
| ------- | ------- |
| [`@apocryphon/core`](./packages/core) | Skill vault, linter, sync engine, registry client and status reporting. |
| [`@apocryphon/cli`](./packages/cli) | Lightweight terminal interface (`apocryphon`). **Current focus.** |
| `@apocryphon/ui` | Visual store (planned, distributed separately). |

## Install (CLI)

```bash
npm install -g @apocryphon/cli
# or run on demand
npx @apocryphon/cli --help
```

Requires Node.js >= 20.

## Quick start

```bash
# 1. Create ~/.apocryphon and connect the skill catalog
apocryphon init --registry <git-url-or-local-path>

# 2. Explore and install skills
apocryphon search prisma
apocryphon install workflow-atomic-commits

# 3. Activate them
apocryphon enable --global workflow-atomic-commits
cd ~/work/my-project && apocryphon use      # interactive picker

# 4. Inspect the result
apocryphon status
```

## How it works

- The **vault** (`~/.apocryphon/vault/<skill-id>/`) is the source of truth.
- **Global skills** are symlinked into each enabled client's global directory
  (`~/.claude/skills`, `~/.cursor/skills`, `~/.config/opencode/skills`).
- **Project skills** are symlinked into `<project>/.claude/skills`,
  `<project>/.cursor/skills` and `<project>/.opencode/skills`, and those paths are
  written to `<project>/.git/info/exclude` — so the client discovers them while
  `git status` stays clean.
- When Claude Code and OpenCode are both enabled, Apocryphon skips the duplicate
  OpenCode copy (OpenCode already scans `~/.claude/skills`).
- Only symlinks managed by Apocryphon are ever removed. Real files and
  directories are never deleted.

## Skill quality rules

`apocryphon validate` enforces a portable contract:

- Frontmatter with a lowercase kebab-case `name` matching the folder.
- A `description` (20–1024 chars) with **explicit triggers** — it is the only
  text clients use to decide when to load the skill.
- Bodies under ~150 lines; long material belongs in `references/` (progressive
  disclosure).
- Scripts under `scripts/` must be executable and are fingerprinted with
  SHA-256, so tampering is detected (`apocryphon status`).

## Commands

| Command | Description |
| ------- | ----------- |
| `apocryphon init` | Create the home, configure clients, connect a registry. |
| `apocryphon clients list/enable/disable` | Manage which clients receive symlinks. |
| `apocryphon search <query>` | Search the catalog (or installed skills). |
| `apocryphon install <skills...>` | Copy skills from the registry into the vault. |
| `apocryphon list` | List installed skills and their active scopes. |
| `apocryphon enable/disable <items...>` | Activate skills or packs (`--global` for all projects). |
| `apocryphon pack list/apply/remove` | Manage packs. |
| `apocryphon use` | Interactive selector for the current project. |
| `apocryphon sync` | Pull the registry, update installed skills, reconcile links. |
| `apocryphon validate [paths...]` | Lint skills (vault, registry or arbitrary paths). |
| `apocryphon status` | Clients, links, context budget and repository hygiene. |
| `apocryphon mcp` | Optional stdio MCP server (requires the MCP SDK). |

`status --json`, `list --json` and `validate --json` make the CLI scriptable and
ready for the future UI package.

## Development

```bash
npm install
npm run build       # core, then cli
npm run typecheck
npm test
```

The repository includes `catalog/`, a ready-to-use local registry with the
`core-discipline` pack:

```bash
APOCRYPHON_HOME=/tmp/apo-demo node packages/cli/dist/cli.mjs init \
  --registry ./catalog --clients claude --yes
APOCRYPHON_HOME=/tmp/apo-demo node packages/cli/dist/cli.mjs install workflow-atomic-commits
```

## License

MIT
