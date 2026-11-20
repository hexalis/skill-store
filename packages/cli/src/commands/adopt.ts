import path from 'node:path'
import { Command } from 'commander'
import { adoptBaseline, pathExists } from '@hexalis/skill-store-core'
import { loadContext, saveState } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'

export function adoptCommand(): Command {
  const command = new Command('adopt')
    .description('Use the current vault copy as the pristine baseline for a skill')
    .argument('<id>', 'Skill id')

  addGlobalOptions(command)

  return command.action(async (id: string) => {
    await runSafely(async () => {
      const ui = uiFromArgv()
      const ctx = await loadContext()
      const vaultDir = path.join(ctx.paths.vault, id)

      if (!(await pathExists(vaultDir))) {
        throw new Error(`Skill "${id}" is not installed in the vault.`)
      }

      const ok = await ui.confirm(
        `Adopt the current content of "${id}" as its new baseline? Future updates will merge against it.`,
      )
      if (!ok) {
        ui.info('Cancelled.')
        return
      }

      await adoptBaseline(ctx.paths, id, ctx.state)
      await saveState(ctx)
      ui.success(`Baseline for ${id} adopted.`)
    })
  })
}
