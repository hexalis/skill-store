import { Command } from 'commander'
import type { ProjectEntry } from '@apocryphon/core'
import {
  activePacks,
  availablePacks,
  ensureEntry,
  loadContext,
  saveProjectEntry,
  saveState,
  syncContext,
  tryLoadRegistry,
} from '../lib/context.js'
import { addGlobalOptions } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { heading, printJson, printSyncReport, table, truncate } from '../lib/output.js'

export function packCommand(): Command {
  const command = new Command('pack').description(
    'Inspect and apply packs (named groups of skills)',
  )

  const list = command
    .command('list')
    .description('List packs known locally or in the registry')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { project?: string; json?: boolean }) => {
      await runSafely(async () => {
        const ctx = await loadContext({ project: options.project })
        const registry = await tryLoadRegistry(ctx)
        const packs = availablePacks(ctx, registry?.index.packs)
        const names = Object.keys(packs).sort((a, b) => a.localeCompare(b))

        const globalActive = new Set(activePacks(ctx, true))
        const projectActive = new Set(activePacks(ctx, false))

        const rows = names.map((name) => {
          const pack = packs[name]
          return {
            name,
            skills: pack?.skills ?? [],
            description: pack?.description ?? '',
            activeGlobal: globalActive.has(name),
            activeProject: projectActive.has(name),
          }
        })

        if (options.json) {
          printJson(rows)
          return
        }

        if (rows.length === 0) {
          console.log(
            'No packs known. Configure a registry with `apocryphon init --registry <source>`.',
          )
          return
        }

        console.log(
          table(
            ['Pack', 'Skills', 'Active', 'Description'],
            rows.map((row) => [
              row.name,
              String(row.skills.length),
              [
                row.activeGlobal ? 'global' : '',
                row.activeProject ? 'project' : '',
              ]
                .filter(Boolean)
                .join(', ') || '-',
              truncate(row.description, 60),
            ]),
          ),
        )
      })
    })

  const apply = command
    .command('apply')
    .description('Activate one or more packs')
    .argument('<packs...>', 'Pack names')
    .option('-g, --global', 'Apply to every project')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .action(
      async (
        names: string[],
        options: { global?: boolean; project?: string },
      ) => {
        await runSafely(async () => {
          const ctx = await loadContext({ project: options.project })
          const registry = await tryLoadRegistry(ctx)
          const packs = availablePacks(ctx, registry?.index.packs)

          const unknown = names.filter((name) => !(name in packs))
          if (unknown.length > 0) {
            throw new Error(
              `Unknown pack(s): ${unknown.join(', ')}. Run \`apocryphon pack list\`.`,
            )
          }

          if (options.global) {
            ctx.state = {
              ...ctx.state,
              globalPacks: [...new Set([...ctx.state.globalPacks, ...names])],
              updatedAt: new Date().toISOString(),
            }
            await saveState(ctx)
          } else {
            const entry: ProjectEntry = {
              ...ensureEntry(ctx),
              packs: [...new Set([...activePacks(ctx, false), ...names])],
              updatedAt: new Date().toISOString(),
            }
            await saveProjectEntry(ctx, entry)
          }

          const report = await syncContext(ctx, {
            registryPacks: registry?.index.packs ?? null,
          })
          heading(`Applied pack(s): ${names.join(', ')}`)
          printSyncReport(report)
        })
      },
    )

  const remove = command
    .command('remove')
    .description('Deactivate one or more packs')
    .argument('<packs...>', 'Pack names')
    .option('-g, --global', 'Apply to every project')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .action(
      async (
        names: string[],
        options: { global?: boolean; project?: string },
      ) => {
        await runSafely(async () => {
          const ctx = await loadContext({ project: options.project })

          if (options.global) {
            ctx.state = {
              ...ctx.state,
              globalPacks: ctx.state.globalPacks.filter((name) => !names.includes(name)),
              updatedAt: new Date().toISOString(),
            }
            await saveState(ctx)
          } else {
            const entry: ProjectEntry = {
              ...ensureEntry(ctx),
              packs: activePacks(ctx, false).filter((name) => !names.includes(name)),
              updatedAt: new Date().toISOString(),
            }
            await saveProjectEntry(ctx, entry)
          }

          const report = await syncContext(ctx)
          heading(`Removed pack(s): ${names.join(', ')}`)
          printSyncReport(report)
        })
      },
    )

  addGlobalOptions(list)
  addGlobalOptions(apply)
  addGlobalOptions(remove)
  addGlobalOptions(command)
  return command
}
