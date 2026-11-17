import { promises as fs } from 'node:fs'
import { Command } from 'commander'
import pc from 'picocolors'
import {
  updateInstalledSkills,
  type RegistryIndex,
  type SyncReport,
  type UpdateInstalledResult,
} from '@apocryphon/core'
import {
  loadContext,
  saveState,
  syncContext,
} from '../lib/context.js'
import { runSafely } from '../lib/run.js'
import { heading, printJson, printSyncReport } from '../lib/output.js'

async function dirExists(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

interface SyncReportEntry {
  project: string | null
  report: SyncReport
}

export function syncCommand(): Command {
  return new Command('sync')
    .description(
      'Update installed skills from the registry and reconcile client symlinks',
    )
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .option('--all', 'Sync every registered project')
    .option('--offline', 'Do not pull the registry or update installed skills')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (options: { project?: string; all?: boolean; offline?: boolean; json?: boolean }) => {
        await runSafely(async () => {
          const ctx = await loadContext({ project: options.project })

          let index: RegistryIndex | null = null
          let updates: UpdateInstalledResult | null = null

          if (ctx.config.registry?.source && !options.offline) {
            const { loadRegistry } = await import('../lib/context.js')
            const handle = await loadRegistry(ctx, { pull: true })
            if (handle) {
              index = handle.index
              updates = await updateInstalledSkills({
                location: handle.location,
                index,
                paths: ctx.paths,
                state: ctx.state,
              })
              await saveState(ctx)
            }
          }

          const reports: SyncReportEntry[] = []

          if (options.all) {
            for (const [root, entry] of Object.entries(ctx.projects.projects)) {
              if (!(await dirExists(root))) {
                console.error(`${pc.yellow('skip')} ${root} (directory not found)`)
                continue
              }
              reports.push({
                project: root,
                report: await syncContext(ctx, {
                  projectRoot: root,
                  entry,
                  registryPacks: index?.packs ?? null,
                }),
              })
            }
          } else {
            reports.push({
              project: ctx.projectRoot,
              report: await syncContext(ctx, {
                registryPacks: index?.packs ?? null,
              }),
            })
          }

          await saveState(ctx)

          if (options.json) {
            printJson({ updates, reports })
            return
          }

          if (updates) {
            heading('Registry')
            console.log(
              `  Updated: ${updates.updated.length} · Removed from registry: ${updates.removedFromRegistry.length} · Failed: ${updates.failed.length}`,
            )
            for (const failure of updates.failed) {
              console.log(`  ${pc.red('error')} ${failure.id}: ${failure.error}`)
            }
            for (const id of updates.removedFromRegistry) {
              console.log(
                `  ${pc.yellow('warn')} "${id}" is installed but no longer exists in the registry.`,
              )
            }
          }

          heading('Sync')
          for (const entry of reports) {
            console.log(`\n  ${pc.bold(entry.project ?? 'global')}`)
            printSyncReport(entry.report)
          }
        })
      },
    )
}
