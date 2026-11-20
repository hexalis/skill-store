import path from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import {
  buildManifest,
  diffManifests,
  listBackups,
  recordSkillState,
  restoreBackup,
  pathExists,
} from '@hexalis/skill-store-core'
import { loadContext, saveState, syncContext } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { printJson, table } from '../lib/output.js'

export function backupsCommand(): Command {
  const command = new Command('backups').description(
    'List or restore the backups taken before skill updates',
  )

  addGlobalOptions(
    command
      .command('list')
    .description('List backups for a skill (newest first)')
    .argument('<id>', 'Skill id')
    .option('--json', 'Print machine-readable JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      await runSafely(async () => {
        const ui = uiFromArgv(Boolean(options.json))
        const ctx = await loadContext()
        const backups = await listBackups(ctx.paths, id)

        if (options.json) {
          printJson(backups)
          return
        }
        if (backups.length === 0) {
          ui.info(`No backups for "${id}".`)
          return
        }
        console.log(
          table(
            ['Timestamp', 'Path'],
            backups.map((backup) => [backup.timestamp, backup.dir]),
          ),
        )
      })
    }),
  )

  addGlobalOptions(
    command
      .command('restore')
    .description('Restore a backup into the vault (defaults to the newest one)')
    .argument('<id>', 'Skill id')
    .argument('[timestamp]', 'Backup timestamp (see `skill-store backups list`)')
    .action(async (id: string, timestamp?: string) => {
      await runSafely(async () => {
        const ui = uiFromArgv()
        const ctx = await loadContext()
        const vaultDir = path.join(ctx.paths.vault, id)
        if (!(await pathExists(vaultDir))) {
          throw new Error(`Skill "${id}" is not installed in the vault.`)
        }

        const ok = await ui.confirm(
          `Restore backup${timestamp ? ` ${timestamp}` : ''} of "${id}" into the vault?`,
        )
        if (!ok) {
          ui.info('Cancelled.')
          return
        }

        const restored = await restoreBackup(ctx.paths, id, timestamp)
        const [vaultManifest, pristineManifest] = await Promise.all([
          buildManifest(vaultDir),
          buildManifest(path.join(ctx.paths.pristine, id)),
        ])
        const customized = diffManifests(pristineManifest, vaultManifest).hasChanges
        const previous = ctx.state.skills[id]
        recordSkillState(ctx.state, id, vaultManifest, {
          customized,
          source: previous?.source ?? null,
          version: previous?.version,
        })
        await saveState(ctx)

        const report = await syncContext(ctx, { reporter: ui.reporter() })
        ui.success(`Restored ${id} from backup ${restored}. ${customized ? pc.yellow('(local changes)') : ''}`)
        void report
      })
    }),
  )

  addGlobalOptions(command)
  return command
}
