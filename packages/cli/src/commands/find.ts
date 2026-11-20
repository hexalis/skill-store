import { Command } from 'commander'
import * as p from '@clack/prompts'
import {
  listVaultSkills,
  type RegistrySkillEntry,
  type SkillLintResult,
} from '@hexalis/skill-store-core'
import { loadContext, tryLoadRegistry } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { requireInteractive, runSafely } from '../lib/run.js'
import { fuzzyScore } from '../lib/fuzzy.js'
import { skillHint } from '../lib/skill-view.js'
import { promptSkillAction } from '../lib/skill-actions.js'

interface FindOptions {
  project?: string
}

interface Candidate {
  id: string
  installed: boolean
  label: string
  hint: string
}

function fromVault(skill: SkillLintResult): Candidate {
  return {
    id: skill.id,
    installed: true,
    label: skill.id,
    hint: skillHint(skill),
  }
}

function fromRegistry(entry: RegistrySkillEntry): Candidate {
  return {
    id: entry.id,
    installed: false,
    label: entry.id,
    hint: [entry.category ?? '', (entry.tags ?? []).slice(0, 2).join(', '), entry.description ?? '']
      .filter(Boolean)
      .join(' · '),
  }
}

export function findCommand(): Command {
  const command = new Command('find')
    .description('Fuzzy-search skills, preview them and act without leaving the picker')
    .argument('[query]', 'Optional initial search text')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')

  addGlobalOptions(command)

  return command.action(async (query: string | undefined, options: FindOptions) => {
    await runSafely(async () => {
      requireInteractive('skill-store find')
      const ui = uiFromArgv()
      const ctx = await loadContext({ project: options.project })
      const registry = await tryLoadRegistry(ctx)
      const vault = await listVaultSkills(ctx.paths.vault)
      const installed = new Set(vault.map((skill) => skill.id))

      const candidates: Candidate[] = [
        ...vault.map(fromVault),
        ...(registry?.index.skills ?? [])
          .filter((entry) => !installed.has(entry.id))
          .map(fromRegistry),
      ]

      if (candidates.length === 0) {
        throw new Error('No skills available. Install some or configure a registry.')
      }

      const choice = await p.autocomplete<string>({
        message: 'Find a skill',
        options: candidates.map((candidate) => ({
          value: candidate.id,
          label: `${candidate.label}${candidate.installed ? '' : ' (not installed)'}`,
          hint: candidate.hint,
        })),
        initialUserInput: query ?? '',
        placeholder: 'Type to search by name, category, tag or description…',
        maxItems: 12,
        filter: (search, option) =>
          fuzzyScore(search, `${option.label} ${option.hint ?? ''}`) > 0,
      })
      if (p.isCancel(choice)) {
        p.cancel('Cancelled.')
        return
      }

      const selected = candidates.find((candidate) => candidate.id === choice)
      if (!selected) return
      await promptSkillAction(ctx, selected.id, ui, selected.installed)
    })
  })
}
