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
import { requireInteractive, runSafely } from '../lib/run.js'
import { heading, printBudget, printSyncReport, truncate } from '../lib/output.js'

function budgetFor(
  state: State,
  entry: ProjectEntry | null,
  packs: Record<string, Pack>,
  skills: Awaited<ReturnType<typeof listVaultSkills>>,
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

export function useCommand(): Command {
  return new Command('use')
    .description(
      'Interactively pick the skills and packs active in this project (or globally)',
    )
    .option('-g, --global', 'Edit the global skill set instead of the current project')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .action(async (options: { global?: boolean; project?: string }) => {
      await runSafely(async () => {
        requireInteractive('apocryphon use')
        const ctx = await loadContext({ project: options.project })
        const global = options.global ?? false
        const registry = await tryLoadRegistry(ctx)
        const packs = availablePacks(ctx, registry?.index.packs)
        const vaultSkills = await listVaultSkills(ctx.paths.vault)

        if (vaultSkills.length === 0) {
          throw new Error(
            'The vault is empty. Run `apocryphon sync` or `apocryphon install <skill>` first.',
          )
        }

        const currentSkills = new Set(activeSkills(ctx, global))
        const currentPacks = new Set(activePacks(ctx, global))

        p.intro(
          `${pc.bgCyan(pc.black(' apocryphon '))} ${global ? 'global skills' : `skills for ${ctx.projectRoot}`}`,
        )

        const skillSelection = await p.multiselect<string>({
          message: 'Skills',
          options: vaultSkills.map((skill) => ({
            value: skill.id,
            label: skill.id,
            hint: truncate(
              `${skill.frontmatter?.category ?? 'uncategorized'} · ${skill.frontmatter?.description ?? 'no description'}`,
              72,
            ),
          })),
          initialValues: [...currentSkills],
          required: false,
        })
        if (p.isCancel(skillSelection)) {
          p.cancel('No changes made.')
          return
        }

        const packNames = Object.keys(packs).sort((a, b) => a.localeCompare(b))
        let packSelection: string[] = []
        if (packNames.length > 0) {
          const selected = await p.multiselect<string>({
            message: 'Packs (optional)',
            options: packNames.map((name) => ({
              value: name,
              label: name,
              hint: truncate(`${packs[name]?.skills.length ?? 0} skills`, 60),
            })),
            initialValues: [...currentPacks],
            required: false,
          })
          if (p.isCancel(selected)) {
            p.cancel('No changes made.')
            return
          }
          packSelection = selected
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

        const report = await syncContext(ctx)
        const budget = budgetFor(
          ctx.state,
          global ? ctx.entry : ensureEntry(ctx),
          packs,
          vaultSkills,
          ctx.config.budget,
        )

        heading(global ? 'Global skill set' : `Project ${ctx.projectRoot}`)
        printSyncReport(report)
        printBudget(budget)
        p.outro(
          `${skillSelection.length} skill(s) + ${packSelection.length} pack(s) active.`,
        )
      })
    })
}
