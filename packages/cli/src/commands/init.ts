import path from 'node:path'
import { Command } from 'commander'
import * as p from '@clack/prompts'
import { c as pc } from '../lib/colors.js'
import {
  CLIENT_IDS,
  CLIENT_LABELS,
  detectClientPresence,
  expandHome,
  initializeHome,
  isGitSource,
  parseClientList,
  resolvePaths,
  type ClientId,
} from '@hexalis/skill-store-core'
import { runSafely, isInteractive } from '../lib/run.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { bullet, heading, kv } from '../lib/output.js'

async function chooseClients(
  detected: Record<ClientId, boolean>,
): Promise<ClientId[] | null> {
  const selection = await p.multiselect<ClientId>({
    message: 'Which clients should Skill Store manage?',
    options: CLIENT_IDS.map((id) => ({
      value: id,
      label: CLIENT_LABELS[id],
      hint: detected[id] ? 'detected' : 'not detected',
    })),
    initialValues: CLIENT_IDS.filter((id) => detected[id]),
    required: false,
  })
  if (p.isCancel(selection)) return null
  return selection
}

export function initCommand(): Command {
  const command = new Command('init')
    .description(
      'Create ~/.skill-store, configure clients and optionally connect a skill registry',
    )
    .option('-r, --registry <source>', 'Git URL or local path of the skill registry (defaults to the Hexalis registry)')
    .option('--ref <ref>', 'Branch, tag or commit to pin (Git sources only)')
    .option('--skip-registry', 'Do not fetch the registry during init')
    .option(
      '-c, --clients <list>',
      'Clients to enable: claude,cursor,opencode,all (default: detected)',
    )
    .option('--force', 'Overwrite an existing config.json')
    .option('-y, --yes', 'Do not prompt; use detected clients')
    .action(
      async (options: {
        registry?: string
        ref?: string
        skipRegistry?: boolean
        clients?: string
        force?: boolean
        yes?: boolean
      }) => {
        await runSafely(async () => {
          const ui = uiFromArgv()
          const paths = resolvePaths()
          if (options.ref && !options.registry) {
            throw new Error('--ref requires --registry <source>.')
          }
          const detected = await detectClientPresence()

          let enabled: ClientId[]
          if (options.clients) {
            enabled = parseClientList(options.clients)
          } else if (isInteractive() && !options.yes) {
            const picked = await chooseClients(detected)
            if (!picked) {
              p.cancel('Initialization cancelled.')
              return
            }
            enabled = picked
          } else {
            enabled = CLIENT_IDS.filter((id) => detected[id])
          }

          const registrySource = options.registry
            ? isGitSource(options.registry.trim())
              ? options.registry.trim()
              : path.resolve(expandHome(options.registry.trim()))
            : null
          const result = await initializeHome({
            paths,
            registrySource,
            registryRef: options.ref,
            loadRegistry: !options.skipRegistry,
            enabledClients: enabled,
            force: options.force ?? false,
            reporter: ui.reporter(),
          })

          heading('Skill Store initialized')
          kv('Home', paths.home)
          kv('Vault', paths.vault)
          kv(
            'Clients',
            CLIENT_IDS.map(
              (id) =>
                `${CLIENT_LABELS[id]} ${result.config.clients[id].enabled ? pc.green('on') : pc.dim('off')}`,
            ).join(' · '),
          )

          for (const client of CLIENT_IDS) {
            const settings = result.config.clients[client]
            if (!settings.enabled) continue
            bullet(`${CLIENT_LABELS[client]}: ${settings.globalDir} + ${settings.projectDir}`)
          }

          if (result.registry) {
            const { index, location } = result.registry
            const isDefault = result.config.registry === null
            kv('Registry', `${index.name} ${pc.dim(`(${location.kind})`)}`)
            kv(
              'Source',
              `${location.source}${location.ref ? ` @ ${location.ref}` : ''}${isDefault ? pc.green(' (default)') : ''}`,
            )
            kv(
              'Catalog',
              `${index.skills.length} skill(s) · ${Object.keys(index.packs).length} pack(s)`,
            )
            if (Object.keys(index.packs).length > 0) {
              bullet(`Packs: ${Object.keys(index.packs).join(', ')}`)
            }
          } else {
            kv('Registry', pc.dim('not fetched'))
            bullet(
              result.config.registry
                ? `Configured source: ${result.config.registry.source}`
                : 'The built-in default will be used on the next command.',
            )
          }

          heading('Next steps')
          bullet('skill-store search <query>     # explore the catalog')
          bullet('skill-store install <skill>     # copy a skill into the vault')
          bullet('skill-store use                # pick skills for this project (TUI)')
          bullet('skill-store status             # clients, links and context budget')
        })
      },
    )

  addGlobalOptions(command)
  return command
}
