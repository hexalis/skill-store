import { Command } from 'commander'
import pc from 'picocolors'
import { collectStatus } from '@apocryphon/core'
import { loadContext, tryLoadRegistry } from '../lib/context.js'
import { runSafely } from '../lib/run.js'
import { printJson, table, truncate } from '../lib/output.js'

export function listCommand(): Command {
  return new Command('list')
    .description('List installed skills and their active scopes')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { project?: string; json?: boolean }) => {
      await runSafely(async () => {
        const ctx = await loadContext({ project: options.project })
        const registry = await tryLoadRegistry(ctx)
        const status = await collectStatus({
          paths: ctx.paths,
          config: ctx.config,
          state: ctx.state,
          projects: ctx.projects,
          projectRoot: ctx.projectRoot,
          registryPacks: registry?.index.packs ?? null,
        })

        if (options.json) {
          printJson(status.skills)
          return
        }

        if (status.skills.length === 0) {
          console.log(
            'The vault is empty. Run `apocryphon sync` or `apocryphon install <skill>`.',
          )
          return
        }

        console.log(
          table(
            ['Skill', 'Category', 'Global', 'Project', 'Lint', 'Description'],
            status.skills.map((skill) => [
              skill.id,
              skill.category ?? '-',
              skill.activeGlobal ? pc.green('yes') : pc.dim('no'),
              skill.activeProject ? pc.green('yes') : pc.dim('no'),
              skill.lintErrors > 0
                ? pc.red(`${skill.lintErrors} err`)
                : skill.lintWarnings > 0
                  ? pc.yellow(`${skill.lintWarnings} warn`)
                  : pc.green('ok'),
              truncate(skill.description ?? '', 60),
            ]),
          ),
        )
      })
    })
}
