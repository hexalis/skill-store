# @hexalis/skill-store-core

Shared engine for Skill Store. It contains no terminal or UI dependencies, so it
can power the CLI today and the visual store later.

## Modules

| Module | Responsibility |
| ------ | -------------- |
| `paths.ts` | `~/.skill-store` layout (vault, pristine, backups) and project lookup (`SKILL_STORE_HOME` override). |
| `schemas.ts` | Zod contracts for `config.json`, `state.json`, `projects.json`, `registry.json` and `SKILL.md` frontmatter. |
| `store.ts` | Atomic JSON reads/writes with schema validation. |
| `skill-files.ts` | File manifests, SHA-256 fingerprints, modes and atomic directory copies. |
| `skill-diff.ts` | Per-file diff between manifests (added/modified/deleted/mode changes). |
| `skill-merge.ts` | Three-way merge with `git merge-file`, conflict markers and per-file choices. |
| `skill-updates.ts` | Pristine baselines, update planning/apply, backups and restore. |
| `skill-linter.ts` | Portable frontmatter/trigger validation, category/tags, body size, references and script checks. |
| `context-budget.ts` | Token estimate and green/yellow/red threshold for active skills. |
| `clients.ts` | Client directory defaults, detection and dedupe coverage. |
| `packs.ts` | Pack resolution and active-skill expansion. |
| `sync-engine.ts` | Symlink reconciliation (global/project) with `.git/info/exclude` management. |
| `git-exclude.ts` | Idempotent managed block in `<repo>/.git/info/exclude`. |
| `registry.ts` | Git/local registry client, install and update planning. |
| `vault.ts` | Vault listing and linting. |
| `status.ts` | Full status report (clients, budget, customization) for the CLI and MCP server. |
| `progress.ts` | Progress events so core stays terminal-agnostic. |
| `bootstrap.ts` | Home initialization and registry pack import. |

## Usage

```ts
import {
  initializeHome,
  resolvePaths,
  resolveRegistryLocation,
  readRegistryIndex,
  syncSkills,
  readConfig,
  readState,
} from '@hexalis/skill-store-core'

const paths = resolvePaths()
const config = await readConfig(paths.config)
const state = await readState(paths.state)

await syncSkills({ paths, config, state, projectRoot: process.cwd() })
```

## Design rules

- Only symlinks that resolve inside the vault are removed.
- Real files/directories are reported, never deleted.
- Validation errors block installation; warnings surface quality problems.
- No module writes to stdout: output belongs to the caller (CLI, MCP or UI).
