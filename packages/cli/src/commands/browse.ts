import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { listVaultSkills, type SkillLintResult } from '@hexalis/skill-store-core'
import { loadContext } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { requireInteractive, runSafely } from '../lib/run.js'
import { groupByCategory, skillCategory, skillHint } from '../lib/skill-view.js'
import { promptSkillAction } from '../lib/skill-actions.js'
import { fuzzyScore } from '../lib/fuzzy.js'
import { printJson, table } from '../lib/output.js'

interface BrowseOptions {
  category?: string
  json?: boolean
}

export function browseCommand(): Command {
  const command = new Command('browse')
    .description('Explore installed skills by category')
    .option('-c, --category <category>', 'Jump directly to a category')
    .option('--json', 'Print categories and counts as JSON')

  addGlobalOptions(command)

  return command.action(async (options: BrowseOptions) => {
    await runSafely(async () => {
      const ui = uiFromArgv(Boolean(options.json))
      const ctx = await loadContext()
      const skills = await listVaultSkills(ctx.paths.vault)

      const groups = groupByCategory(skills)

      if (options.json) {
        printJson(
          Object.fromEntries(
            Object.entries(groups).map(([category, list]) => [
              category,
              list.map((skill) => skill.id),
            ]),
          ),
        )
        return
      }

      if (skills.length === 0) {
        throw new Error('The vault is empty. Run `skill-store sync` or install some skills.')
      }

      if (!ui.interactive) {
        console.log(
          table(
            ['Category', 'Skills', 'IDs'],
            Object.entries(groups)
              .sort((a, b) => b[1].length - a[1].length)
              .map(([category, list]) => [category, String(list.length), list.map((s) => s.id).join(', ')]),
          ),
        )
        return
      }

      let category = options.category
      if (!category) {
        const answer = await p.select<string>({
          message: 'Category',
          options: Object.entries(groups)
            .sort((a, b) => b[1].length - a[1].length)
            .map(([name, list]) => ({
              value: name,
              label: name,
              hint: `${list.length} skill(s)`,
            })),
        })
        if (p.isCancel(answer)) {
          p.cancel('Cancelled.')
          return
        }
        category = answer
      }

      const list = groups[category]
      if (!list || list.length === 0) {
        throw new Error(`No skills in category "${category}".`)
      }

      const choice = await p.autocomplete<string>({
        message: `Skills in ${pc.bold(category)}`,
        options: list.map((skill) => ({
          value: skill.id,
          label: skill.id,
          hint: skillHint(skill as SkillLintResult),
        })),
        placeholder: 'Type to filter…',
        filter: (search, option) =>
          fuzzyScore(search, `${option.label} ${option.hint ?? ''}`) > 0,
      })
      if (p.isCancel(choice)) {
        p.cancel('Cancelled.')
        return
      }

      await promptSkillAction(ctx, choice, ui, true)
    })
  })
}
