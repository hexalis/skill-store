import { Command } from 'commander'
import { listVaultSkills } from '@apocryphon/core'
import { loadContext, tryLoadRegistry } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { skillCategory, skillTags } from '../lib/skill-view.js'
import { printJson, table } from '../lib/output.js'

function countValues(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function tagsCommand(): Command {
  const command = new Command('tags')
    .description('List tags with skill counts (installed and catalog)')
    .option('--json', 'Print machine-readable JSON')

  addGlobalOptions(command)

  return command.action(async (options: { json?: boolean }) => {
    await runSafely(async () => {
      const ui = uiFromArgv(Boolean(options.json))
      const ctx = await loadContext()
      const registry = await tryLoadRegistry(ctx)
      const vault = await listVaultSkills(ctx.paths.vault)

      const values = [
        ...vault.flatMap(skillTags),
        ...(registry?.index.skills.flatMap((entry) => entry.tags ?? []) ?? []),
      ]
      const counts = countValues(values)

      if (options.json) {
        printJson(
          counts.map(([tag, count]) => ({
            tag,
            count,
            label: registry?.index.taxonomy?.tags.find((entry) => entry.id === tag)?.label ?? null,
          })),
        )
        return
      }

      if (counts.length === 0) {
        ui.info('No tags found.')
        return
      }

      console.log(
        table(
          ['Tag', 'Skills', 'Label'],
          counts.map(([tag, count]) => [
            tag,
            String(count),
            registry?.index.taxonomy?.tags.find((entry) => entry.id === tag)?.label ?? '-',
          ]),
        ),
      )
    })
  })
}

export function categoriesCommand(): Command {
  const command = new Command('categories')
    .description('List categories with skill counts')
    .option('--json', 'Print machine-readable JSON')

  addGlobalOptions(command)

  return command.action(async (options: { json?: boolean }) => {
    await runSafely(async () => {
      const ui = uiFromArgv(Boolean(options.json))
      const ctx = await loadContext()
      const registry = await tryLoadRegistry(ctx)
      const vault = await listVaultSkills(ctx.paths.vault)

      const values = [
        ...vault.map(skillCategory),
        ...(registry?.index.skills.map((entry) => entry.category ?? 'uncategorized') ?? []),
      ]
      const counts = countValues(values)

      if (options.json) {
        printJson(counts.map(([category, count]) => ({ category, count })))
        return
      }

      if (counts.length === 0) {
        ui.info('No categories found.')
        return
      }

      console.log(
        table(
          ['Category', 'Skills'],
          counts.map(([category, count]) => [category, String(count)]),
        ),
      )
    })
  })
}
