# CLI UX conventions

This document is the contract for Skill Store's interactive behavior. Every
command must follow it.

## Global flags

| Flag | Behavior |
| --- | --- |
| `--quiet` | Only warnings and errors. No spinners, tables or success messages. |
| `--verbose` | Adds file paths, git commands and extra context. |
| `--no-color` | Disables ANSI colors (also honored: `NO_COLOR`). |
| `-y, --yes` | Accepts confirmations with their default answer. Required in CI for destructive flows. |
| `--json` | Machine-readable output on stdout (only on commands that support it). |
| `--dry-run` | Computes and prints the plan without touching disk. |

## Streams

- **stdout** is reserved for the command result: tables, human output, or JSON.
- **stderr** is used for progress, spinners, warnings and errors.
- With `--json`, stdout contains **only** the JSON document. Spinners are
  disabled and all logs go to stderr.

## Terminal detection

- Interactive prompts run only when both stdin and stdout are TTYs.
- Without a TTY, a command that needs input fails with an actionable error that
  names the non-interactive alternative (for example
  `skill-store enable <skills...>` or `--yes`).
- `skill-store` with no arguments and no TTY prints the static help.

## Cancellation

- Cancelling a prompt (`Esc` / `Ctrl+C`) exits with status `0`, prints
  `Cancelled.` and leaves the user's files untouched.
- Partial results are not written: state files are only saved after a completed
  decision.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success (including a cancelled prompt). |
| `1` | Execution error, validation failure, missing dependency or aborted destructive operation. |

## Interactive pickers

The fuzzy pickers (`use`, `install`, `find`, `browse`) share the same keys:

| Key | Action |
| --- | --- |
| Type | Filter by name, category, tag or description. |
| `↑` / `↓` | Move the cursor. |
| `Tab` | Toggle the focused item (multiselect pickers). |
| `Enter` | Confirm the selection or the highlighted option. |
| `Esc` / `Ctrl+C` | Cancel without changing anything (exit 0). |

`find` and `browse` show a preview of the selected skill and then a small action
menu (enable in this project, enable globally, disable, install).

## Destructive operations

Any operation that overwrites user data must:

1. Show what will change (plan or diff).
2. Require an explicit confirmation, or a flag (`--yes`, `--force`) in non-TTY.
3. Keep a backup when the data was customized by the user.

See `docs/skill-updates.md` for the skill-specific policy.
