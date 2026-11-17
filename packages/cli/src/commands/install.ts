import { Command } from 'commander'
import pc from 'picocolors'
import {
  findRegistrySkill,
  installSkillFromRegistry,
  searchRegistry,
} from '@apocryphon/core'
import {
  loadContext,
  requireRegistry,
  saveState,
  syncContext,
} from '../lib/context.js'
import { runSafely } from '../lib/run.js'
import { printIssues, printSyncReport, table, truncate } from '../lib/output.js'

export function installCommand(): Command {
  return new Command('install')
    .description('Install (or update) skills from the configured registry into the vault')
    .argument('<skills...>', 'Skill ids')
    .option('-f, --force', 'Install even if lint reports errors')
    .option('--no-sync', 'Do not refresh symlinks after installing')
    .action(
      async (
        ids: string[],
        options: { force?: boolean; sync?: boolean },
      ) => {
        await runSafely(async () => {
          const ctx = await loadContext()
          const handle = await requireRegistry(ctx)

          const missing: string[] = []
          const results: Array<{ id: string; updated: boolean; issues: string }> = []

          for (const id of ids) {
            const entry = findRegistrySkill(handle.index, id)
            if (!entry) {
              missing.push(id)
              continue
            }

            const result = await installSkillFromRegistry({
              location: handle.location,
              entry,
              paths: ctx.paths,
              state: ctx.state,
              force: options.force ?? false,
            })

            if (result.lint.issues.length > 0) {
              console.log(`\n${pc.bold(result.id)}:`)
              printIssues(result.lint.issues)
            }

            results.push({
              id: result.id,
              updated: result.updated,
              issues: `${result.lint.issues.filter((issue) => issue.level === 'error').length} errors, ${result.lint.issues.filter((issue) => issue.level === 'warning').length} warnings`,
            })
          }

          await saveState(ctx)

          if (results.length > 0) {
            console.log(
              table(
                ['Skill', 'Action', 'Lint'],
                results.map((result) => [
                  result.id,
                  result.updated ? 'updated' : 'installed',
                  result.issues,
                ]),
              ),
            )
          }

          if (missing.length > 0) {
            const suggestions = missing.map((id) => {
              const matches = searchRegistry(handle.index, id).slice(0, 3)
              if (matches.length === 0) return `  ${id}: not found in the registry.`
              return `  ${id}: did you mean ${matches
                .map((match) => `"${match.id}"`)
                .join(', ')}?`
            })
            throw new Error(
              `Skill(s) not found in the registry:\n${suggestions.join('\n')}\nRun \`apocryphon search <query>\` to explore ${truncate(handle.index.name, 40)}.`,
            )
          }

          if (options.sync !== false) {
            const report = await syncContext(ctx, {
              registryPacks: handle.index.packs,
            })
            printSyncReport(report)
          }
        })
      },
    )
}
