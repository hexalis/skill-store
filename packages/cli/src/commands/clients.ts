import { Command } from 'commander'
import pc from 'picocolors'
import {
  CLIENT_IDS,
  CLIENT_LABELS,
  detectClientPresence,
  isClientId,
  type ClientId,
} from '@apocryphon/core'
import {
  loadContext,
  saveConfig,
  syncContext,
  type CliContext,
} from '../lib/context.js'
import { runSafely } from '../lib/run.js'
import { heading, printSyncReport, table } from '../lib/output.js'

async function setEnabled(
  ids: string[],
  enabled: boolean,
): Promise<void> {
  const ctx: CliContext = await loadContext()
  const parsed: ClientId[] = []

  for (const id of ids) {
    const normalized = id.toLowerCase()
    if (!isClientId(normalized)) {
      throw new Error(
        `Unknown client "${id}". Valid values: ${CLIENT_IDS.join(', ')}.`,
      )
    }
    parsed.push(normalized)
  }

  const nextClients = { ...ctx.config.clients }
  for (const id of parsed) {
    nextClients[id] = { ...nextClients[id], enabled }
  }

  ctx.config = { ...ctx.config, clients: nextClients }
  await saveConfig(ctx)

  const report = await syncContext(ctx)
  heading(`${enabled ? 'Enabled' : 'Disabled'} ${parsed.map((id) => CLIENT_LABELS[id]).join(', ')}`)
  printSyncReport(report)
}

export function clientsCommand(): Command {
  const command = new Command('clients').description(
    'Inspect or enable/disable the coding clients Apocryphon manages',
  )

  command
    .command('list')
    .description('Show detected and enabled clients, their directories and link counts')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { json?: boolean }) => {
      await runSafely(async () => {
        const ctx = await loadContext()
        const detected = await detectClientPresence()

        const rows = CLIENT_IDS.map((id) => {
          const settings = ctx.config.clients[id]
          return {
            id,
            label: CLIENT_LABELS[id],
            detected: detected[id],
            enabled: settings.enabled,
            globalDir: settings.globalDir,
            projectDir: settings.projectDir,
          }
        })

        if (options.json) {
          console.log(JSON.stringify(rows, null, 2))
          return
        }

        console.log(
          table(
            ['Client', 'Detected', 'Enabled', 'Global dir', 'Project dir'],
            rows.map((row) => [
              row.label,
              row.detected ? 'yes' : 'no',
              row.enabled ? pc.green('yes') : pc.dim('no'),
              row.globalDir,
              row.projectDir,
            ]),
          ),
        )
      })
    })

  command
    .command('enable')
    .description('Enable one or more clients and create their symlinks')
    .argument('<clients...>', 'claude, cursor, opencode or all')
    .action(async (clients: string[]) => {
      await runSafely(() => setEnabled(clients, true))
    })

  command
    .command('disable')
    .description('Disable one or more clients and remove their managed symlinks')
    .argument('<clients...>', 'claude, cursor, opencode or all')
    .action(async (clients: string[]) => {
      await runSafely(() => setEnabled(clients, false))
    })

  return command
}
