import { Command } from 'commander'
import pc from 'picocolors'
import { collectStatus } from '@hexalis/skill-store-core'
import { loadContext, tryLoadRegistry } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { printJson, table, truncate } from '../lib/output.js'
import { fuzzyScore } from '../lib/fuzzy.js'

interface ListOptions {
  project?: string
  json?: boolean
  category?: string
  tag?: string
  query?: string
}

function stateLabel(row: {
  customized: boolean
  updateAvailable: boolean
  baseline: 'known' | 'unknown'
}): string {
  if (row.customized && row.updateAvailable) return pc.red('conflict')
  if (row.customized) return pc.yellow('customized')
  if (row.updateAvailable) return pc.cyan('update')
  if (row.baseline === 'unknown') return pc.yellow('baseline?')
  return pc.dim('clean')
}

export function listCommand(): Command {
  const command = new Command('list')
    .description('List installed skills with scope, category and customization state')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .option('-c, --category <category>', 'Only show skills in this category')
    .option('-t, --tag <tag>', 'Only show skills with this tag')
    .option('-q, --query <query>', 'Fuzzy filter over ids, categories, tags and descriptions')
    .option('--json', 'Print machine-readable JSON')

  addGlobalOptions(command)

  return command.action(async (options: ListOptions) => {
    await runSafely(async () => {
      const ui = uiFromArgv(Boolean(options.json))
      const ctx = await loadContext({ project: options.project })
      const registry = await tryLoadRegistry(ctx)
      const status = await collectStatus({
        paths: ctx.paths,
        config: ctx.config,
        state: ctx.state,
        projects: ctx.projects,
        projectRoot: ctx.projectRoot,
        registryPacks: registry?.index.packs ?? null,
        registry: registry?.snapshot ?? null,
      })

      let rows = status.skills
      if (options.category) {
        rows = rows.filter((row) => (row.category ?? 'uncategorized') === options.category)
      }
      if (options.tag) {
        rows = rows.filter((row) => row.tags.includes(options.tag ?? ''))
      }
      if (options.query) {
        rows = rows
          .map((row) => ({
            row,
            score: fuzzyScore(
              options.query ?? '',
              `${row.id} ${row.category ?? ''} ${row.tags.join(' ')} ${row.description ?? ''}`,
            ),
          }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((entry) => entry.row)
      }

      if (options.json) {
        printJson(rows)
        return
      }

      if (rows.length === 0) {
        ui.info('No skills match the current filters.')
        return
      }

      console.log(
        table(
          ['Skill', 'Category', 'Tags', 'Global', 'Project', 'State', 'Lint', 'Description'],
          rows.map((row) => [
            row.id,
            row.category ?? '-',
            row.tags.slice(0, 3).join(', ') || '-',
            row.activeGlobal ? pc.green('yes') : pc.dim('no'),
            row.activeProject ? pc.green('yes') : pc.dim('no'),
            stateLabel(row),
            row.lintErrors > 0
              ? pc.red(`${row.lintErrors} err`)
              : row.lintWarnings > 0
                ? pc.yellow(`${row.lintWarnings} warn`)
                : pc.green('ok'),
            truncate(row.description ?? '', 50),
          ]),
        ),
      )
    })
  })
}
