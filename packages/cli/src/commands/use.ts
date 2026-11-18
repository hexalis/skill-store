import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
  computeContextBudget,
  expandActiveSkills,
  listVaultSkills,
  type BudgetSkillInput,
  type ContextBudget,
  type Pack,
  type ProjectEntry,
  type SkillLintResult,
  type State,
} from '@apocryphon/core'
import {
  activePacks,
  activeSkills,
  availablePacks,
  ensureEntry,
  loadContext,
  saveProjectEntry,
  saveState,
  syncContext,
  tryLoadRegistry,
} from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely, requireInteractive } from '../lib/run.js'
import { fuzzyScore } from '../lib/fuzzy.js'
import { previewText, skillCategory, skillHint } from '../lib/skill-view.js'
import { heading, printBudget, printSyncReport, truncate } from '../lib/output.js'

interface UseOptions {
  global?: boolean
  project?: string
  filter?: string
  preview?: boolean
}

function budgetFor(
  state: State,
  entry: ProjectEntry | null,
  packs: Record<string, Pack>,
  skills: SkillLintResult[],
  thresholds: { warnAt: number; failAt: number },
): ContextBudget {
  const active = expandActiveSkills(state, entry, packs)
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const inputs: BudgetSkillInput[] = [...new Set([...active.global, ...active.project])].map(
    (id) => {
      const skill = byId.get(id)
      return {
        id,
        name: skill?.frontmatter?.name,
        description: skill?.frontmatter?.description,
      }
    },
  )
  return computeContextBudget(inputs, thresholds)
}

export async function runUse(options: UseOptions): Promise<void> {
  requireInteractive('apocryphon use')
  const ui = uiFromArgv()
  const ctx = await loadContext({ project: options.project })
  const global = options.global ?? false

  const registry = await tryLoadRegistry(ctx)
  const packs = availablePacks(ctx, registry?.index.packs)
  const allSkills = await listVaultSkills(ctx.paths.vault)

  if (allSkills.length === 0) {
    throw new Error(
      'The vault is empty. Run `apocryphon sync` or `apocryphon install <skill>` first.',
    )
  }

  const filtered = options.filter
    ? allSkills.filter(
        (skill) =>
          fuzzyScore(options.filter ?? '', `${skill.id} ${skillHint(skill)}`) > 0,
      )
    : allSkills

  if (filtered.length === 0) {
    throw new Error(`No installed skills match "${options.filter}".`)
  }

  const sorted = [...filtered].sort((a, b) => {
    const byCategory = skillCategory(a).localeCompare(skillCategory(b))
    return byCategory !== 0 ? byCategory : a.id.localeCompare(b.id)
  })

  const currentSkills = new Set(activeSkills(ctx, global))
  const currentPacks = new Set(activePacks(ctx, global))

  p.intro(
    `${pc.bgCyan(pc.black(' apocryphon '))} ${global ? 'global skills' : `skills for ${ctx.projectRoot}`}`,
  )

  const availableSkills = new Set(sorted.map((skill) => skill.id))
  const skillSelection = await p.autocompleteMultiselect<string>({
    message: 'Skills (type to filter, space to toggle)',
    options: sorted.map((skill) => ({
      value: skill.id,
      label: `${skill.id}`,
      hint: truncate(skillHint(skill), 90),
    })),
    initialValues: [...currentSkills].filter((id) => availableSkills.has(id)),
    required: false,
    placeholder: 'Filter by name, category, tag or description…',
    filter: (search, option) =>
      fuzzyScore(search, `${option.label} ${option.hint ?? ''}`) > 0,
  })
  if (p.isCancel(skillSelection)) {
    p.cancel('No changes made.')
    return
  }

  const packNames = Object.keys(packs).sort((a, b) => a.localeCompare(b))
  let packSelection: string[] = []
  if (packNames.length > 0) {
    const selected = await p.autocompleteMultiselect<string>({
      message: 'Packs (optional)',
      options: packNames.map((name) => ({
        value: name,
        label: name,
        hint: `${packs[name]?.skills.length ?? 0} skills · ${truncate(packs[name]?.description ?? '', 60)}`,
      })),
      initialValues: [...currentPacks].filter((name) => packNames.includes(name)),
      required: false,
      placeholder: 'Filter packs…',
      filter: (search, option) =>
        fuzzyScore(search, `${option.label} ${option.hint ?? ''}`) > 0,
    })
    if (p.isCancel(selected)) {
      p.cancel('No changes made.')
      return
    }
    packSelection = selected
  }

  const selectedSkills = skillSelection
    .map((id) => allSkills.find((skill) => skill.id === id))
    .filter((skill): skill is SkillLintResult => Boolean(skill))

  if ((options.preview ?? true) && selectedSkills.length > 0) {
    for (const skill of selectedSkills.slice(0, 3)) {
      p.note(previewText(skill, 8), `Preview · ${skill.id}`)
    }
  }

  const now = new Date().toISOString()
  if (global) {
    ctx.state = {
      ...ctx.state,
      globalSkills: skillSelection,
      globalPacks: packSelection,
      updatedAt: now,
    }
    await saveState(ctx)
  } else {
    const entry: ProjectEntry = {
      ...ensureEntry(ctx),
      skills: skillSelection,
      packs: packSelection,
      updatedAt: now,
    }
    await saveProjectEntry(ctx, entry)
  }

  const reporter = ui.reporter()
  const report = await syncContext(ctx, { reporter })
  const budget = budgetFor(
    ctx.state,
    global ? ctx.entry : ensureEntry(ctx),
    packs,
    allSkills,
    ctx.config.budget,
  )

  heading(global ? 'Global skill set' : `Project ${ctx.projectRoot}`)
  printSyncReport(report)
  printBudget(budget)
  p.outro(`${skillSelection.length} skill(s) + ${packSelection.length} pack(s) active.`)
}

export function useCommand(): Command {
  const command = new Command('use')
    .description('Interactively pick the skills and packs active in this project')
    .option('-g, --global', 'Edit the global skill set instead of the current project')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .option('-f, --filter <query>', 'Pre-filter the skill list')
    .option('--no-preview', 'Do not print the SKILL.md preview after selecting')

  addGlobalOptions(command)

  return command.action(async (options: UseOptions) => {
    await runSafely(() => runUse(options))
  })
}
