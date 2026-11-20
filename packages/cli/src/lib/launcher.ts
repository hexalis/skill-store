import { spawnSync } from 'node:child_process'
import * as p from '@clack/prompts'
import { c } from './colors.js'
import { isInteractive } from './run.js'

export interface LauncherAction {
  value: string
  label: string
  hint?: string
  args: string[]
}

export const LAUNCHER_ACTIONS: LauncherAction[] = [
  {
    value: 'use',
    label: 'Activate skills in this project',
    hint: 'interactive picker',
    args: ['use'],
  },
  {
    value: 'install',
    label: 'Search and install skills',
    hint: 'catalog + fuzzy search',
    args: ['install'],
  },
  {
    value: 'find',
    label: 'Find a skill',
    hint: 'search, inspect and act',
    args: ['find'],
  },
  {
    value: 'status',
    label: 'Show status and context budget',
    args: ['status'],
  },
  {
    value: 'sync',
    label: 'Sync client links',
    hint: 'plan before applying',
    args: ['sync'],
  },
  {
    value: 'packs',
    label: 'Browse packs',
    args: ['pack', 'list'],
  },
  {
    value: 'clients',
    label: 'Manage clients',
    args: ['clients', 'list'],
  },
  {
    value: 'help',
    label: 'Help',
    args: ['--help'],
  },
]

function runSelf(args: string[]): void {
  const entry = process.argv[1]
  if (!entry) return
  const result = spawnSync(process.execPath, [...process.execArgv, entry, ...args], {
    stdio: 'inherit',
  })
  if (typeof result.status === 'number') process.exitCode = result.status
}

/**
 * Interactive launcher shown by `skill-store` with no arguments in a TTY.
 * Each action re-executes the CLI with inherited stdio, which keeps prompts and
 * colors working exactly like a direct invocation.
 */
export async function runLauncher(): Promise<void> {
  if (!isInteractive()) return

  p.intro(`${c.bgCyan(c.black(' skill-store '))} ${c.dim('skill manager')}`)

  for (;;) {
    const action = await p.select<string>({
      message: 'What do you want to do?',
      options: LAUNCHER_ACTIONS.map((entry) => ({
        value: entry.value,
        label: entry.label,
        hint: entry.hint,
      })),
    })

    if (p.isCancel(action) || action === 'exit') {
      p.outro('Bye.')
      return
    }

    const selected = LAUNCHER_ACTIONS.find((entry) => entry.value === action)
    if (!selected) continue

    if (selected.value === 'help') {
      runSelf(['--help'])
      continue
    }

    runSelf(selected.args)
    return
  }
}
