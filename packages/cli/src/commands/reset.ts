import path from 'node:path'
import { Command } from 'commander'
import {
  buildManifest,
  pathExists,
  recordSkillState,
  restorePristine,
  backupSkill,
} from '@apocryphon/core'
import { loadContext, saveState, syncContext } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { printSyncReport } from '../lib/output.js'

export function resetCommand(): Command {
  const command = new Command('reset')
    .description('Discard local changes and restore the installed (pristine) version')
    .argument('<id>', 'Skill id')

  addGlobalOptions(command)

  return command.action(async (id: string) => {
    await runSafely(async () => {
      const ui = uiFromArgv()
      const ctx = await loadContext()
      const vaultDir = path.join(ctx.paths.vault, id)
      const pristineDir = path.join(ctx.paths.pristine, id)

      if (!(await pathExists(vaultDir))) {
        throw new Error(`Skill "${id}" is not installed in the vault.`)
      }
      if (!(await pathExists(pristineDir))) {
        throw new Error(
          `Skill "${id}" has no pristine baseline. Run \`apocryphon adopt ${id}\` instead.`,
        )
      }

      const ok = await ui.confirm(`Discard all local changes in "${id}"?`)
      if (!ok) {
        ui.info('Cancelled.')
        return
      }

      const backup = await backupSkill(ctx.paths, id)
      if (backup) ui.debug(`Backup: ${backup.dir}`)

      await restorePristine(ctx.paths, id)
      const manifest = await buildManifest(vaultDir)
      const previous = ctx.state.skills[id]
      recordSkillState(ctx.state, id, manifest, {
        customized: false,
        source: previous?.source ?? null,
        version: previous?.version,
      })
      await saveState(ctx)

      const report = await syncContext(ctx, { reporter: ui.reporter() })
      ui.success(`Restored ${id} from its pristine baseline.`)
      if (backup) ui.info(`Backup kept at ${backup.dir}`)
      printSyncReport(report)
    })
  })
}
