<div align="center">

# Apocryphon

**A local skill store for coding agents.**

Install, validate and activate Agent Skills for **Claude Code**, **Cursor** and
**OpenCode** — globally or per project, without polluting your repositories.

[![CI](https://github.com/marlonbaltodano11/apocryphon/actions/workflows/ci.yml/badge.svg)](https://github.com/marlonbaltodano11/apocryphon/actions/workflows/ci.yml)
[![npm @apocryphon/cli](https://img.shields.io/npm/v/@apocryphon/cli?label=%40apocryphon%2Fcli)](https://www.npmjs.com/package/@apocryphon/cli)
[![npm @apocryphon/core](https://img.shields.io/npm/v/@apocryphon/core?label=%40apocryphon%2Fcore)](https://www.npmjs.com/package/@apocryphon/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Safe updates](#updating-skills-safely) · [Commands](#commands) · [Registry](https://github.com/marlonbaltodano11/apocryphon-registry) · [Docs](docs/cli-ux.md)

</div>

---

Apocryphon is built for the real world: sometimes you **cannot** run a custom
orchestration harness because of organization policies, and you have to work
inside the official IDEs and CLIs. Instead of fighting that, Apocryphon guides
the agents from the inside with high-quality skill descriptions, deterministic
verification scripts and a careful update flow that never discards your edits
silently.

## Why Apocryphon

- **Global and per-project activation.** Symlinks into each client's native
  skill directory, with `<project>/.git/info/exclude` handling so `git status`
  stays clean.
- **Fuzzy discovery.** Search-as-you-type in every picker, plus `find`, `browse`,
  categories and curated tags.
- **Safe updates.** Per-file hashes, pristine baselines, diffs, three-way merges,
  `--force`/`--keep` and automatic backups (5 per skill).
- **Local skills.** Scaffold with `apocryphon new`, import with `apocryphon import`.
- **Lint as a gate.** Portable names, explicit triggers, categories/tags, body
  size, references and script fingerprints.
- **Scriptable.** `--json` on every read command, shell completions for bash,
  zsh and fish.
- **No backend.** Git is the database; no server, no account, works offline.

## Install

```bash
npm install -g @apocryphon/cli
# or run on demand
npx @apocryphon/cli --help
```

Requires **Node.js >= 20**.

## Quick start

```bash
# 1. Create ~/.apocryphon (connects the official catalog by default)
apocryphon init

# Optional: switch to a fork, a local catalog or a private Git repo
apocryphon registry use git@ssh.dev.azure.com:v3/org/project/repo
apocryphon registry show
apocryphon registry default        # back to the official catalog

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
apocryphon sync --dry-run        # preview updates and link changes
apocryphon sync                  # merge/apply with explicit decisions
```

## How it works

```text
        registry (Git)                 ~/.apocryphon
   ┌────────────────────┐        ┌──────────────────────┐
   │ registry.json      │        │ vault/<id>/          │──┐
   │ skills/<id>/       │──install──▶ pristine/<id>/     │  │ symlinks
   │ packs, taxonomy    │        │ backups/<id>/<ts>/   │  │
   └────────────────────┘        │ state.json           │  │
                                 │ projects.json        │  │
                                 └──────────────────────┘  │
                                                           ▼
                                   ~/.claude/skills      ~/.cursor/skills
                                   ~/.config/opencode/skills
                                   <project>/.claude/skills (+ .git/info/exclude)
```

- The **vault** is the working copy the agents read.
- The **pristine** copy is the merge base: the registry version, untouched by you.
- **Global skills** go to each enabled client's global directory.
- **Project skills** go to `<project>/<client>/skills` and are added to
  `<project>/.git/info/exclude`; the shared `.gitignore` is never modified.
- When Claude Code and OpenCode are both enabled, Apocryphon skips the duplicate
  OpenCode copy (OpenCode already scans `~/.claude/skills`).
- Only symlinks managed by Apocryphon are removed. Real files are never deleted.

## Updating skills safely

Edit anything inside `~/.apocryphon/vault/<id>/`. Apocryphon records file hashes
and modes, so it can tell your changes apart from registry changes:

```bash
apocryphon diff workflow-atomic-commits   # local vs pristine and registry changes
apocryphon sync --dry-run                 # plan without touching disk
apocryphon sync --merge                   # three-way merge
apocryphon sync --keep                    # keep yours, skip the update
apocryphon sync --force                   # registry wins (backup first)
apocryphon reset <id>                     # discard local changes
apocryphon backups list <id>              # snapshots taken before overwrites
```

| Situation | Default behavior |
| --- | --- |
| No local changes | Fast-forward to the registry version |
| Local changes, registry unchanged | Nothing to do |
| Local changes + registry changes | Ask the user (merge / registry / keep / per file) |
| No TTY and no flags | **Abort** and list the flags to choose |

Conflicts keep standard markers (`<<<<<<<`, `=======`, `>>>>>>>`) and the command
exits `1`. Resolve them in your editor and run `apocryphon sync` again. Full
policy: [`docs/skill-updates.md`](docs/skill-updates.md).

## Registry source

The **official catalog is the default**: `apocryphon init` connects to
`https://github.com/marlonbaltodano11/apocryphon-registry.git` automatically.

You can switch to a local path, a fork, a private GitHub repo or an Azure DevOps
repository. A single source is active at a time:

```bash
apocryphon registry show                 # source, ref, cache and catalog summary
apocryphon registry use ~/dev/skills     # local directory
apocryphon registry use git@github.com:me/skills.git
apocryphon registry use git@ssh.dev.azure.com:v3/org/project/repo
apocryphon registry use <url> --ref v1.0.0   # pin a branch, tag or commit
apocryphon registry default              # remove the override
```

`config.json` keeps `registry: null` for the default, or
`{ "source": "...", "ref": "..." }` for an override. Local paths are stored as
absolute paths. Git sources are cloned once into
`~/.apocryphon/registries/<hash>/`, so switching sources never mixes caches.

Changing the source **does not delete installed skills, local edits, backups or
project activations**. The new catalog is used for future installs and updates;
packs that are still active keep their definitions. A registry only needs a
`registry.json` and its `skills/<id>/SKILL.md` folders; see the
[registry repository](https://github.com/marlonbaltodano11/apocryphon-registry).

`APOCRYPHON_DEFAULT_REGISTRY` can replace the built-in default (useful for
enterprises and tests). For an offline bootstrap, use
`apocryphon init --skip-registry`; the next command will fetch the active source.

## Discovery

```bash
apocryphon search prisma            # fuzzy ranking, stable scores
apocryphon search git --category workflow --tag commits
apocryphon find                     # type → preview → enable/disable/install
apocryphon browse                   # category → skill → action
apocryphon tags                     # tag counts
apocryphon categories               # category counts
apocryphon completion --install     # bash, zsh or fish
```

Running `apocryphon` with no arguments opens an interactive launcher. In the
fuzzy pickers: **type** to filter, **↑/↓** to move, **Tab** to toggle,
**Enter** to confirm, **Esc** to cancel. See [`docs/cli-ux.md`](docs/cli-ux.md).

## Local skills

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
| `apocryphon init` | Create the home, configure clients, connect the default registry. |
| `apocryphon registry show/use/default` | Inspect, override or reset the active skill source. |
| `apocryphon clients list/enable/disable` | Manage which clients receive symlinks. |
| `apocryphon search <query>` | Fuzzy search the catalog (or installed skills). |
| `apocryphon find [query]` | Fuzzy picker with preview and actions. |
| `apocryphon browse` | Explore installed skills by category. |
| `apocryphon tags` / `categories` | Tag and category counts. |
| `apocryphon install [skills...]` | Install/update skills (`--all`, `--filter`). |
| `apocryphon list` | Installed skills, scopes and customization state. |
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

### Global flags

| Flag | Behavior |
| ---- | -------- |
| `--quiet` | Only warnings and errors. |
| `--verbose` | Extra paths, git commands and context. |
| `--no-color` | Disable ANSI colors (also `NO_COLOR`). |
| `-y, --yes` | Accept confirmations (required without a TTY). |
| `--json` | Machine-readable output on supported commands. |

## State layout

```text
~/.apocryphon/
├── config.json        # clients, registry, budget thresholds
├── state.json         # global skills/packs, installed metadata, hashes
├── projects.json      # per-project skills/packs
├── vault/<id>/        # working copies (symlinked)
├── pristine/<id>/     # merge baseline
├── backups/<id>/<ts>/ # snapshots before overwrite/merge
└── registries/<hash>/ # per-source/per-ref Git clones
```

`APOCRYPHON_HOME` overrides the state directory (useful for tests).

## Repository layout

```text
packages/
├── core/   # @apocryphon/core — vault, linter, sync, registry, diff/merge, status
└── cli/    # @apocryphon/cli  — the `apocryphon` terminal interface
catalog/    # minimal fixture registry used by tests and demos
docs/       # UX contract and skill update policy
```

The official catalog lives in a separate repository:
**[marlonbaltodano11/apocryphon-registry](https://github.com/marlonbaltodano11/apocryphon-registry)**.
A future `@apocryphon/ui` package will reuse `@apocryphon/core`.

## Development

```bash
npm install
npm run build       # core, then cli
npm run typecheck
npm test
```

Run the CLI from the repo:

```bash
APOCRYPHON_HOME=/tmp/apo-demo node packages/cli/dist/cli.mjs init \
  --registry ./catalog --clients claude --yes
```

The test suite covers the linter, budget, git exclude block, sync engine, diff
and merge logic, backups, fuzzy scoring and an end-to-end CLI flow (59 tests).

## Releasing

CI runs typecheck, tests, build and a non-interactive smoke test on Node 20, 22
and 24. Publishing uses three GitHub Environments; all of them have
`NPM_PUBLISH=true`, and `NPM_TOKEN` is stored as a **repository** secret so every
environment can read it.

| Environment | Used by | Dist-tag | Purpose |
| ----------- | ------- | -------- | ------- |
| `develop` | Prerelease (manual) | `dev` | Development snapshots |
| `qa` | Prerelease (manual) | `next` / `beta` | QA snapshots |
| `production` | Release (tag or manual) | `latest` | Stable releases |

`production` can be protected with required reviewers or a deployment branch
policy once the release cadence is settled.

### Stable release

```bash
npm version minor -w @apocryphon/core --no-git-tag-version
npm version minor -w @apocryphon/cli  --no-git-tag-version
git commit -am "chore(release): v0.2.0"
git tag v0.2.0      # must match @apocryphon/cli's version
git push --follow-tags
```

`release.yml` runs in the `production` environment, typechecks, tests, builds
and publishes `@apocryphon/core` first and `@apocryphon/cli` afterwards, skipping
versions that already exist on npm. Provenance is enabled by default and
requires a public repository. A manual dispatch can override the dist-tag or run
a dry run that only produces tarballs.

When the run was triggered by a tag, the workflow also creates a **GitHub
Release** for that tag with auto-generated notes and the npm tarballs attached.
Snapshot runs (`prerelease.yml`) do not create GitHub Releases.

### Snapshots

```bash
# Development snapshot (dist-tag: dev)
gh workflow run prerelease.yml -f environment=develop -f dist-tag=dev

# QA snapshot (dist-tag: next)
gh workflow run prerelease.yml -f environment=qa -f dist-tag=next

# Dry run (build + pack only, no publish)
gh workflow run prerelease.yml -f environment=develop -f dist-tag=dev -f dry-run=true
```

`prerelease.yml` rewrites both packages to `<base>-<dist-tag>.<run_number>` and
points the CLI dependency at that core snapshot so the pair is installable:

```bash
npm install -g @apocryphon/cli@next
```

> These workflows are self-contained copies adapted from
> `hexalis/github-workflows`. If you later centralize them, replace the bodies with
> `uses:` calls once they support npm workspaces.


## Contributing

1. Open an issue describing the skill, bug or UX change.
2. Keep changes focused and add tests for new behavior.
3. Run `npm run typecheck && npm test && npm run build`.
4. Use semantic commits (`feat(cli): …`, `fix(core): …`, `docs: …`).
5. For catalog changes, open a PR in
   [apocryphon-registry](https://github.com/marlonbaltodano11/apocryphon-registry).

## License

[MIT](LICENSE) © Marlon Baltodano
