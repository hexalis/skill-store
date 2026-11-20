# Skill updates and customization

Skill Store never silently overwrites a skill you edited. This document describes
how local changes are detected, shown and merged.

## Directory layout

```text
~/.skill-store/
├── vault/<id>/                 # working copy used by clients (symlinked)
├── pristine/<id>/              # exact copy of the installed registry version
└── backups/<id>/<timestamp>/   # snapshot taken before an overwrite or merge
```

`state.json` records, per installed skill:

```jsonc
{
  "version": "1.0.0",
  "source": { "type": "registry", "ref": "git@github.com:hexalis/skill-registry.git" },
  "contentHash": "sha256 of the whole skill",
  "fileHashes": { "SKILL.md": "…", "scripts/check.sh": "…" },
  "fileModes": { "scripts/check.sh": "755" },
  "customized": true,
  "baseline": "known",
  "lastMergedAt": null
}
```

## Skill states

| State | Meaning |
| --- | --- |
| `clean` | `vault/` matches `pristine/`. |
| `customized` | The user edited the vault. |
| `update available` | The registry changed since the installed version. |
| `conflict` | Both the vault and the registry changed. |

`skill-store status` and `skill-store list` show these states.
`skill-store diff <id>` shows local and upstream changes.

## Update policy

| Situation | Default action |
| --- | --- |
| No local changes | Fast-forward to the registry version. |
| Local changes, registry unchanged | Nothing to do. |
| Local changes + registry changes | Ask the user. |
| No TTY and no flag | **Abort** and list the customizable skills. |

### Flags

| Flag | Effect |
| --- | --- |
| `--force` / `--theirs` | Upstream wins for every file. A backup is created first. |
| `--keep` / `--ours` | Keep the vault and skip this update. |
| `--merge` | Three-way merge (base = pristine, ours = vault, theirs = registry). |
| `--yes` | Accept only decisions without conflicts; conflicts still need a flag. |

## Merge semantics

- Files changed only upstream are taken from the registry.
- Files changed only locally are kept.
- Files changed on both sides are merged with `git merge-file`.
- Binary files, add/add or delete/modify conflicts cannot be merged automatically:
  they require an explicit choice.
- Conflicting text files keep standard markers:

  ```text
  <<<<<<< ours
  ...
  =======
  ...
  >>>>>>> theirs
  ```

  Resolve them in the editor and run `skill-store sync` again; the result becomes
  local customization.

## Backups and recovery

- Every overwrite or merge snapshots the vault into
  `~/.skill-store/backups/<id>/<timestamp>/`.
- The last **5** backups per skill are kept.
- `skill-store reset <id>` restores the pristine copy (discarding local edits),
  after confirmation.

## Existing installations

Installs created before this feature have no `pristine/` copy:

- On first sync, Skill Store adopts the current vault as the baseline only if its
  hash matches the one recorded at install time.
- Otherwise the skill is marked `baseline: unknown` and the first update requires
  `--force`, `--keep` or `skill-store adopt <id>`.
