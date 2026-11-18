import type { Command } from 'commander'

import { createUi, type Ui } from './ui.js'

/**
 * Build a Ui from the global flags found in argv. `json` is command-specific.
 */
export function uiFromArgv(json = false): Ui {
  const flags = readGlobalFlags()
  return createUi({
    quiet: flags.quiet,
    verbose: flags.verbose,
    yes: flags.yes,
    json,
  })
}

export interface GlobalFlags {
  quiet: boolean
  verbose: boolean
  color: boolean
  yes: boolean
}

/**
 * Read the global flags directly from argv.
 *
 * Commander exposes them per command, but subcommands do not inherit parent
 * options; reading argv keeps the behavior identical everywhere (including the
 * MCP helpers and the launcher).
 */
export function readGlobalFlags(argv: string[] = process.argv): GlobalFlags {
  return {
    quiet: argv.includes('--quiet'),
    verbose: argv.includes('--verbose'),
    color: !argv.includes('--no-color') && !process.env.NO_COLOR,
    yes: argv.includes('--yes') || argv.includes('-y'),
  }
}

function hasOption(command: Command, long: string): boolean {
  return command.options.some((option) => option.long === long)
}

/** Register the global UX flags on a command (idempotently). */
export function addGlobalOptions<T extends Command>(command: T): T {
  if (!hasOption(command, '--quiet')) {
    command.option('--quiet', 'Only warnings and errors')
  }
  if (!hasOption(command, '--verbose')) {
    command.option('--verbose', 'Verbose output')
  }
  if (!hasOption(command, '--no-color')) {
    command.option('--no-color', 'Disable colors')
  }
  if (!hasOption(command, '--yes')) {
    command.option('-y, --yes', 'Accept confirmations with their default answer')
  }
  return command
}
