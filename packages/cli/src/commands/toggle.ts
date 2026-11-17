import { Command } from 'commander'
import { loadContext } from '../lib/context.js'
import { toggleItems } from '../lib/actions.js'
import { runSafely } from '../lib/run.js'
import { heading, printSyncReport } from '../lib/output.js'

export function createToggleCommand(enable: boolean): Command {
  const verb = enable ? 'Activate' : 'Deactivate'
  return new Command(enable ? 'enable' : 'disable')
    .description(`${verb} skills or packs globally or for the current project`)
    .argument('<items...>', 'Skill ids or pack names')
    .option('-g, --global', 'Apply to every project')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .action(
      async (
        items: string[],
        options: { global?: boolean; project?: string },
      ) => {
        await runSafely(async () => {
          const ctx = await loadContext({ project: options.project })
          const global = options.global ?? false
          const result = await toggleItems(ctx, items, { global, enable })

          if (!result.changed) {
            console.log('Nothing to do: the selected items were already in that state.')
            return
          }

          heading(
            `${enable ? 'Enabled' : 'Disabled'} ${[...result.skills, ...result.packs].join(', ')} ${global ? '(global)' : `(project ${ctx.projectRoot})`}`,
          )
          if (result.report) printSyncReport(result.report)
        })
      },
    )
}

export function enableCommand(): Command {
  return createToggleCommand(true)
}

export function disableCommand(): Command {
  return createToggleCommand(false)
}
