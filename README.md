# Apocryphon

**Apocryphon** is a local skill store and manager for coding agents. It installs,
validates and activates [Agent Skills](https://opencode.ai/docs/skills) for
**Claude Code**, **Cursor** and **OpenCode**, globally or per project, without
modifying the shared `.gitignore` of your repositories.

It is designed for environments where you cannot run an external orchestration
harness: Apocryphon guides the agents from inside the native IDE/CLI using
high-quality skill descriptions, deterministic verification scripts and a
careful, customization-safe update flow.

## Highlights

- **Global and per-project activation** with symlinks and `.git/info/exclude`
  (no repository pollution).
- **Fuzzy finder** in pickers and search, plus `find` and `browse` flows.
- **Categories and curated tags** for discovery (`--category`, `--tag`, `tags`,
  `categories`).
- **Shell completions** for bash, zsh and fish, and an interactive launcher when
  you run `apocryphon` with no arguments.
- **Safe updates:** local edits are detected with per-file hashes; updates show a
  plan/diff and support three-way merges, `--force` and `--keep`. Backups are
  created automatically (5 per skill).
- **Local skills:** create with `apocryphon new`, import with `apocryphon import`.
- **Lint as a gate:** portable names, explicit triggers in the description,
  categories/tags, body size, references and script fingerprints.

## Packages

| Package | Purpose |
| ------- | ------- |
| [`@apocryphon/core`](./packages/core) | Skill vault, linter, sync engine, registry client, diff/merge and status reporting. |
| [`@apocryphon/cli`](./packages/cli) | Lightweight terminal interface (`apocryphon`). **Current focus.** |
| `@apocryphon/ui` | Visual store (planned, distributed separately). |

The official catalog lives in a separate repository:
[Majokan/apocryphon-registry](https://github.com/Majokan/apocryphon-registry).
`catalog/` in this repo is a minimal fixture used by the test suite.

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
apocryphon init --registry git@github.com:Majokan/apocryphon-registry.git

# 2. Explore
apocryphon categories
apocryphon search commit
apocryphon find                  # fuzzy picker: preview + actions

# 3. Install and activate
apocryphon install workflow-atomic-commits
apocryphon enable --global workflow-atomic-commits
cd ~/work/my-project && apocryphon use      # interactive picker

# 4. Keep things healthy
apocryphon status                # clients, budget, customizations, updates
apocryphon sync --dry-run        # preview registry updates and link changes
apocryphon sync                  # merge/apply with explicit decisions
```

## How it works

- The **vault** (`~/.apocryphon/vault/<skill-id>/`) is the working copy.
- The **pristine** copy (`~/.apocryphon/pristine/<id>/`) is the merge base; it is
  what the registry installed, untouched by your edits.
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

## Customizing skills

Edit anything inside `~/.apocryphon/vault/<id>/`. Apocryphon records file hashes
and modes so it can tell your changes apart from registry changes:

```bash
apocryphon diff workflow-atomic-commits   # local vs pristine and registry changes
apocryphon sync --dry-run                 # plan without touching disk
apocryphon sync --merge                   # three-way merge
apocryphon sync --keep                    # keep yours, skip the update
apocryphon sync --force                   # registry wins (backup first)
apocryphon reset <id>                     # discard local changes
apocryphon backups list <id>              # snapshots taken before overwrites
```

Without a TTY and without flags, `sync` **refuses to overwrite** customized
skills. See [`docs/skill-updates.md`](./docs/skill-updates.md) for the full policy.

## Create and import local skills

```bash
apocryphon new my-skill --category workflow --tags git,project
apocryphon new my-skill --references --scripts --enable
apocryphon import ./path/to/skill
apocryphon import git@github.com:me/skills.git --id my-skill
```

`new` scaffolds a skill that already passes the linter. `import` validates the
source and asks for `--trust-scripts` when it contains scripts.

## Commands

| Command | Description |
| ------- | ----------- |
| `apocryphon init` | Create the home, configure clients, connect a registry. |
| `apocryphon clients list/enable/disable` | Manage which clients receive symlinks. |
| `apocryphon search <query>` | Fuzzy search the catalog (or installed skills). |
| `apocryphon find [query]` | Fuzzy picker with preview and actions. |
| `apocryphon browse` | Explore installed skills by category. |
| `apocryphon tags` / `categories` | Tag and category counts. |
| `apocryphon install [skills...]` | Install/update skills (`--all`, `--filter`). |
| `apocryphon list` | Installed skills with scope, category and customization state. |
| `apocryphon enable/disable <items...>` | Toggle skills or packs (`--global`). |
| `apocryphon pack list/apply/remove` | Manage packs. |
| `apocryphon use` | Interactive selector for the current project. |
| `apocryphon sync` | Plan/apply registry updates and reconcile links. |
| `apocryphon diff <id>` | Show local and registry changes. |
| `apocryphon reset <id>` / `adopt <id>` | Restore pristine / adopt the vault as baseline. |
| `apocryphon backups list/restore` | Manage update backups. |
| `apocryphon new <id>` | Create a local skill. |
| `apocryphon import <source>` | Import a skill from a path or Git URL. |
| `apocryphon validate [paths...]` | Lint skills (`--registry`, `--strict`). |
| `apocryphon status` | Clients, active skills, budget, customization, hygiene. |
| `apocryphon completion bash\|zsh\|fish` | Print shell completions (`--install` to write them). |
| `apocryphon mcp` | Optional stdio MCP server (requires the MCP SDK). |

Global flags: `--quiet`, `--verbose`, `--no-color`, `-y/--yes`. Commands that
produce machine-readable output support `--json`
(`status`, `list`, `search`, `validate`, `sync`, `clients list`, `pack list`,
`backups list`, `tags`, `categories`, `browse`).

## Development

```bash
npm install
npm run build       # core, then cli
npm run typecheck
npm test
```

`catalog/` is a two-skill fixture registry used by tests and demos:

```bash
APOCRYPHON_HOME=/tmp/apo-demo node packages/cli/dist/cli.mjs init \
  --registry ./catalog --clients claude --yes
```

See [`docs/cli-ux.md`](./docs/cli-ux.md) for the interactive UX contract.

## Releasing

CI (`.github/workflows/ci.yml`) runs typecheck, tests, build and a non-interactive
smoke test on Node 20, 22 and 24.

Publishing uses a GitHub Environment named **`npm`**:

| Kind | Name | Purpose |
| ---- | ---- | ------- |
| Variable | `NPM_PUBLISH=true` | Kill switch (same pattern as the Hexalis workflows) |
| Secret | `NPM_TOKEN` | npm automation token with publish access to `@apocryphon` |

### Stable release

```bash
npm version minor -w @apocryphon/core --no-git-tag-version
npm version minor -w @apocryphon/cli  --no-git-tag-version
git commit -am "chore(release): v0.2.0"
git tag v0.2.0      # must match @apocryphon/cli's version
git push --follow-tags
```

`release.yml` typechecks, tests, builds and publishes `@apocryphon/core` first and
`@apocryphon/cli` afterwards, skipping versions that already exist on npm.
Provenance is enabled by default and requires a public repository. A manual
dispatch can override the dist-tag or run a dry run that only produces tarballs.

### Snapshots

Run **Actions → Prerelease → Run workflow** with a dist-tag (default `next`).

```bash
npm install -g @apocryphon/cli@next
```

## License

MIT
