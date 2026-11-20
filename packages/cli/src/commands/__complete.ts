import { Command } from 'commander'
import { CLIENT_IDS, listVaultSkillIds } from '@hexalis/skill-store-core'
import { loadContext, type CliContext } from '../lib/context.js'
import { SHELLS } from '../lib/completions.js'

const COMMANDS = [
  'init',
  'clients',
  'search',
  'install',
  'list',
  'enable',
  'disable',
  'pack',
  'use',
  'sync',
  'validate',
  'status',
  'find',
  'browse',
  'tags',
  'categories',
  'new',
  'import',
  'diff',
  'reset',
  'adopt',
  'backups',
  'completion',
  'mcp',
]

const COMMON_FLAGS = ['--help', '--quiet', '--verbose', '--no-color', '--yes']

const FLAGS: Record<string, string[]> = {
  init: ['--registry', '--clients', '--force', '--yes'],
  clients: ['--json'],
  search: ['--category', '--tag', '--limit', '--fzf', '--json'],
  install: ['--filter', '--all', '--force', '--keep', '--merge', '--no-sync'],
  list: ['--project', '--category', '--tag', '--query', '--json'],
  enable: ['--global', '--project'],
  disable: ['--global', '--project'],
  pack: ['--project', '--json'],
  use: ['--global', '--project', '--filter', '--no-preview'],
  sync: ['--project', '--all', '--offline', '--dry-run', '--force', '--keep', '--merge', '--json'],
  validate: ['--registry', '--strict', '--json'],
  status: ['--project', '--json'],
  find: ['--project'],
  browse: ['--category', '--json'],
  tags: ['--json'],
  categories: ['--json'],
  new: ['--category', '--tags', '--description', '--references', '--scripts', '--enable', '--global'],
  import: ['--id', '--force', '--keep', '--merge', '--trust-scripts', '--no-sync'],
  diff: ['--upstream'],
  reset: ['--yes'],
  adopt: ['--yes'],
  backups: ['--json'],
  completion: ['--install', '--shell', '--print'],
}

async function maybeContext(): Promise<CliContext | null> {
  try {
    return await loadContext()
  } catch {
    return null
  }
}

async function skillIds(ctx: CliContext | null): Promise<string[]> {
  if (!ctx) return []
  return listVaultSkillIds(ctx.paths.vault)
}

function packNames(ctx: CliContext | null): string[] {
  return ctx ? Object.keys(ctx.state.packs) : []
}

function flagsFor(command: string | undefined): string[] {
  if (!command) return COMMON_FLAGS
  return [...COMMON_FLAGS, ...(FLAGS[command] ?? [])]
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

async function candidates(
  type: string,
  words: string[],
  ctx: CliContext | null,
): Promise<string[]> {
  if (type !== 'words') {
    switch (type) {
      case 'commands':
        return COMMANDS
      case 'skills':
        return skillIds(ctx)
      case 'packs':
        return packNames(ctx)
      case 'clients':
        return [...CLIENT_IDS]
      case 'shells':
        return [...SHELLS]
      default:
        return []
    }
  }

  if (words.length === 0) return COMMANDS

  const [command, subcommand] = words
  const last = words[words.length - 1] ?? ''
  const afterSpace = last === ''

  if (last.startsWith('-')) return flagsFor(command)

  // Still typing the first word: offer top-level commands. If the word is
  // already a complete command with subcommands, offer those instead.
  if (words.length === 1) {
    switch (command) {
      case 'clients':
        return ['list', 'enable', 'disable']
      case 'pack':
        return ['list', 'apply', 'remove']
      case 'backups':
        return ['list', 'restore']
      case 'completion':
        return [...SHELLS, 'install']
      default:
        return COMMANDS
    }
  }

  switch (command) {
    case 'clients':
      return words.length === 2 && !afterSpace
        ? ['list', 'enable', 'disable']
        : [...CLIENT_IDS]
    case 'pack':
      if (words.length === 2 && !afterSpace) return ['list', 'apply', 'remove']
      if (subcommand === 'apply' || subcommand === 'remove') return packNames(ctx)
      return []
    case 'backups':
      return words.length === 2 && !afterSpace ? ['list', 'restore'] : []
    case 'completion':
      return words.length === 2 && !afterSpace ? [...SHELLS, 'install'] : []
    case 'enable':
    case 'disable':
      return unique([...(await skillIds(ctx)), ...packNames(ctx)])
    case 'install':
    case 'diff':
    case 'reset':
    case 'adopt':
      return skillIds(ctx)
    default:
      return []
  }
}

export function completeCommand(): Command {
  return new Command('__complete')
    .description('Internal: emit shell completion candidates')
    .argument('<type>', 'words, commands, skills, packs, clients or shells')
    .argument('[words...]', 'Words typed so far')
    .action(async (type: string, words: string[]) => {
      const ctx = await maybeContext()
      const values = await candidates(type, words, ctx)
      if (values.length > 0) console.log(unique(values).join('\n'))
    })
}
