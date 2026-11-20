<div align="center">

# Skill Store

**A local skill store for coding agents.**

Install, validate and activate Agent Skills for **Claude Code**, **Cursor** and
**OpenCode** — globally or per project, without polluting your repositories.

[![CI](https://github.com/hexalis/skill-store/actions/workflows/ci.yml/badge.svg)](https://github.com/hexalis/skill-store/actions/workflows/ci.yml)
[![npm @hexalis/skill-store-cli](https://img.shields.io/npm/v/@hexalis/skill-store-cli?label=%40hexalis%2Fskill-store-cli)](https://www.npmjs.com/package/@hexalis/skill-store-cli)
[![npm @hexalis/skill-store-core](https://img.shields.io/npm/v/@hexalis/skill-store-core?label=%40hexalis%2Fskill-store-core)](https://www.npmjs.com/package/@hexalis/skill-store-core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Safe updates](#updating-skills-safely) · [Commands](#commands) · [Registry](#registry-source) · [Docs](docs/cli-ux.md)

</div>

---

Skill Store is built for the real world: sometimes you **cannot** run a custom
orchestration harness because of organization policies, and you have to work
inside the official IDEs and CLIs. Instead of fighting that, Skill Store guides
the agents from the inside with high-quality skill descriptions, deterministic
verification scripts and a careful update flow that never discards your edits
silently.

## Why Skill Store

- **Global and per-project activation.** Symlinks into each client's native
  skill directory, with `<project>/.git/info/exclude` handling so `git status`
  stays clean.
- **Fuzzy discovery.** Search-as-you-type in every picker, plus `find`, `browse`,
  categories and curated tags.
- **Safe updates.** Per-file hashes, pristine baselines, diffs, three-way merges,
  `--force`/`--keep` and automatic backups (5 per skill).
- **Local skills.** Scaffold with `skill-store new`, import with `skill-store import`.
- **Lint as a gate.** Portable names, explicit triggers, categories/tags, body
  size, references and script fingerprints.
- **Scriptable.** `--json` on every read command, shell completions for bash,
  zsh and fish.
- **No backend.** Git is the database; no server, no account, works offline.

## Install

```bash
npm install -g @hexalis/skill-store-cli
# or run on demand
npx --package @hexalis/skill-store-cli skill-store --help
```

The package installs two equivalent commands: **`skill-store`** and its short
alias **`hss`**.

Requires **Node.js >= 22**.

## Quick start

```bash
# 1. Create ~/.skill-store (connects the Hexalis registry by default)
skill-store init

# Optional: switch to a fork, a local catalog or another Git repo
skill-store registry use git@ssh.dev.azure.com:v3/org/project/repo
skill-store registry show
skill-store registry default        # back to the Hexalis registry

# 2. Explore
skill-store categories
skill-store search commit
skill-store find                  # fuzzy picker: preview + actions

# 3. Install and activate
skill-store install skill-router
skill-store enable --global skill-router
cd ~/work/my-project && skill-store use      # interactive picker

# 4. Keep things healthy
skill-store status                # clients, budget, customizations, updates
skill-store sync --dry-run        # preview updates and link changes
skill-store sync                  # merge/apply with explicit decisions
```

## How it works

```text
        registry (Git)                 ~/.skill-store
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
- When Claude Code and OpenCode are both enabled, Skill Store skips the duplicate
  OpenCode copy (OpenCode already scans `~/.claude/skills`).
- Only symlinks managed by Skill Store are removed. Real files are never deleted.

## Updating skills safely

Edit anything inside `~/.skill-store/vault/<id>/`. Skill Store records file hashes
and modes, so it can tell your changes apart from registry changes:

```bash
skill-store diff skill-router   # local vs pristine and registry changes
skill-store sync --dry-run                 # plan without touching disk
skill-store sync --merge                   # three-way merge
skill-store sync --keep                    # keep yours, skip the update
skill-store sync --force                   # registry wins (backup first)
skill-store reset <id>                     # discard local changes
skill-store backups list <id>              # snapshots taken before overwrites
```

| Situation | Default behavior |
| --- | --- |
| No local changes | Fast-forward to the registry version |
| Local changes, registry unchanged | Nothing to do |
| Local changes + registry changes | Ask the user (merge / registry / keep / per file) |
| No TTY and no flags | **Abort** and list the flags to choose |

Conflicts keep standard markers (`<<<<<<<`, `=======`, `>>>>>>>`) and the command
exits `1`. Resolve them in your editor and run `skill-store sync` again. Full
policy: [`docs/skill-updates.md`](docs/skill-updates.md).

## Registry source

The **Hexalis registry is the default**: `skill-store init` connects to
`git@github.com:hexalis/skill-registry.git` automatically. The registry is
private, so access to the Hexalis organization is required.

You can switch to a local path, a fork, a private GitHub repo or an Azure DevOps
repository. A single source is active at a time:

```bash
skill-store registry show                 # source, ref, cache and catalog summary
skill-store registry use ~/dev/skills     # local directory
skill-store registry use git@github.com:me/skills.git
skill-store registry use git@ssh.dev.azure.com:v3/org/project/repo
skill-store registry use <url> --ref v1.0.0   # pin a branch, tag or commit
skill-store registry default              # remove the override
```

`config.json` keeps `registry: null` for the default, or
`{ "source": "...", "ref": "..." }` for an override. Local paths are stored as
absolute paths. Git sources are cloned once into
`~/.skill-store/registries/<hash>/`, so switching sources never mixes caches.

Changing the source **does not delete installed skills, local edits, backups or
project activations**. The new catalog is used for future installs and updates;
packs that are still active keep their definitions. A registry only needs a
`registry.json` and the skill directories it lists; see the
[registry repository](https://github.com/hexalis/skill-registry).

`SKILL_STORE_DEFAULT_REGISTRY` can replace the built-in default (useful for
enterprises and tests). For an offline bootstrap, use
`skill-store init --skip-registry`; the next command will fetch the active source.

## Discovery

```bash
skill-store search prisma            # fuzzy ranking, stable scores
skill-store search git --category workflow --tag commits
skill-store find                     # type → preview → enable/disable/install
skill-store browse                   # category → skill → action
skill-store tags                     # tag counts
skill-store categories               # category counts
skill-store completion --install     # bash, zsh or fish
```

Running `skill-store` with no arguments opens an interactive launcher. In the
fuzzy pickers: **type** to filter, **↑/↓** to move, **Tab** to toggle,
**Enter** to confirm, **Esc** to cancel. See [`docs/cli-ux.md`](docs/cli-ux.md).

## Local skills

```bash
skill-store new my-skill --category workflow --tags git,project
skill-store new my-skill --references --scripts --enable
skill-store import ./path/to/skill
skill-store import git@github.com:me/skills.git --id my-skill
```

`new` scaffolds a skill that already passes the linter. `import` validates the
source and asks for `--trust-scripts` when it contains scripts.

## Commands

| Command | Description |
| ------- | ----------- |
| `skill-store init` | Create the home, configure clients, connect the default registry. |
| `skill-store registry show/use/default` | Inspect, override or reset the active skill source. |
| `skill-store clients list/enable/disable` | Manage which clients receive symlinks. |
| `skill-store search <query>` | Fuzzy search the catalog (or installed skills). |
| `skill-store find [query]` | Fuzzy picker with preview and actions. |
| `skill-store browse` | Explore installed skills by category. |
| `skill-store tags` / `categories` | Tag and category counts. |
| `skill-store install [skills...]` | Install/update skills (`--all`, `--filter`). |
| `skill-store list` | Installed skills, scopes and customization state. |
| `skill-store enable/disable <items...>` | Toggle skills or packs (`--global`). |
| `skill-store pack list/apply/remove` | Manage packs. |
| `skill-store use` | Interactive selector for the current project. |
| `skill-store sync` | Plan/apply registry updates and reconcile links. |
| `skill-store diff <id>` | Show local and registry changes. |
| `skill-store reset <id>` / `adopt <id>` | Restore pristine / adopt the vault as baseline. |
| `skill-store backups list/restore` | Manage update backups. |
| `skill-store new <id>` | Create a local skill. |
| `skill-store import <source>` | Import a skill from a path or Git URL. |
| `skill-store validate [paths...]` | Lint skills (`--registry`, `--strict`). |
| `skill-store status` | Clients, active skills, budget, customization, hygiene. |
| `skill-store completion bash\|zsh\|fish` | Print shell completions (`--install` to write them). |
| `skill-store mcp` | Optional stdio MCP server (requires the MCP SDK). |

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
~/.skill-store/
├── config.json        # clients, registry, budget thresholds
├── state.json         # global skills/packs, installed metadata, hashes
├── projects.json      # per-project skills/packs
├── vault/<id>/        # working copies (symlinked)
├── pristine/<id>/     # merge baseline
├── backups/<id>/<ts>/ # snapshots before overwrite/merge
└── registries/<hash>/ # per-source/per-ref Git clones
```

`SKILL_STORE_HOME` overrides the state directory (useful for tests).

## Repository layout

```text
packages/
├── core/   # @hexalis/skill-store-core — vault, linter, sync, registry, diff/merge, status
└── cli/    # @hexalis/skill-store-cli  — the `skill-store` terminal interface
catalog/    # minimal fixture registry used by tests and demos
docs/       # UX contract and skill update policy
```

The Hexalis catalog lives in the private repository
**[hexalis/skill-registry](https://github.com/hexalis/skill-registry)**.
A future `@hexalis/skill-store-ui` package will reuse `@hexalis/skill-store-core`.

## Development

```bash
pnpm install
pnpm build       # core, then cli
pnpm typecheck
pnpm test
```

Run the CLI from the repo:

```bash
SKILL_STORE_HOME=/tmp/skill-store-demo node packages/cli/dist/cli.mjs init \
  --registry ./catalog --clients claude --yes
```

The test suite covers the linter, budget, git exclude block, sync engine, diff
and merge logic, backups, fuzzy scoring and an end-to-end CLI flow.

## Releasing

CI runs typecheck, tests, build and a non-interactive smoke test on Node 22 and
24. CI and publishing call the reusable workflows from
[`hexalis/github-workflows`](https://github.com/hexalis/github-workflows).

Publishing uses the `stable` environment; manual snapshots use `develop` and
`qa`. Each environment has `NPM_PUBLISH=true`. `NPM_TOKEN` is a **repository or
organization** secret so the caller workflow can pass it to the reusable
workflow (environment secrets are not visible to the caller job).

| Environment | Used by | Dist-tag | Purpose |
| ----------- | ------- | -------- | ------- |
| `stable` | Release (Changesets) | `latest` | Stable releases |
| `develop` | Prerelease (manual) | `dev` | Development snapshots |
| `qa` | Prerelease (manual) | `next` / `beta` | QA snapshots |

### Stable release

Stable releases follow the Changesets flow:

1. Add a changeset to the PR:
   ```bash
   pnpm changeset
   git add .changeset
   git commit -m "chore: add changeset"
   git push
   ```
2. Merge the PR into `main`.
3. `changesets-release.yml` opens or updates the **Version Packages** PR.
4. Merge that PR to version both packages and publish them to npm.

The initial changeset bumps both packages from `0.0.0` to `0.1.0`. After the
Version Packages PR is merged, the next `main` run publishes them to npm.

### Snapshots

```bash
# Development snapshot (dist-tag: dev)
gh workflow run prerelease.yml -f environment=develop -f dist-tag=dev

# QA snapshot (dist-tag: next)
gh workflow run prerelease.yml -f environment=qa -f dist-tag=next
```

`changesets-prerelease.yml` builds the packages and publishes the pending
changesets under the requested dist-tag. The reusable workflows do not expose a
dry-run mode; CI already runs typecheck, tests and build on every change.

## Contributing

1. Open an issue describing the skill, bug or UX change.
2. Keep changes focused and add tests for new behavior.
3. Run `pnpm typecheck && pnpm test && pnpm build`.
4. Use semantic commits (`feat(cli): …`, `fix(core): …`, `docs: …`).
5. For skill or registry changes, open a PR in the private
   [skill-registry](https://github.com/hexalis/skill-registry).

## Credits

Skill Store is a fork of [Apocryphon](https://github.com/marlonbaltodano11/apocryphon)
by Marlon Baltodano, adapted for Hexalis.

## License

[MIT](LICENSE) © 2026 Marlon Baltodano and Hexalis
