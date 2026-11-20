import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import {
  buildManifest,
  diffManifests,
  pathExists,
  planSkillUpdate,
  registrySkillDir,
  summarizeDiff,
} from '@hexalis/skill-store-core'
import { loadContext, tryLoadRegistry } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'

interface DiffOptions {
  upstream?: boolean
}

function gitDiff(left: string, right: string, label: string): void {
  console.log(`\n${pc.bold(label)}`)
  const result = spawnSync(
    'git',
    ['diff', '--no-index', '--color=auto', '--stat', left, right],
    { stdio: 'inherit' },
  )
  // --no-index exits 1 when there are differences; that is expected.
  void result
  spawnSync('git', ['diff', '--no-index', '--color=auto', left, right], {
    stdio: 'inherit',
  })
}

export function diffCommand(): Command {
  const command = new Command('diff')
    .description('Show local changes and registry changes for an installed skill')
    .argument('<id>', 'Skill id')
    .option('--upstream', 'Only show registry changes since the installed version')

  addGlobalOptions(command)

  return command.action(async (id: string, options: DiffOptions) => {
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
          `Skill "${id}" has no pristine baseline. Run \`skill-store adopt ${id}\` to set the current copy as the baseline.`,
        )
      }

      const [base, current] = await Promise.all([
        buildManifest(pristineDir),
        buildManifest(vaultDir),
      ])
      const local = diffManifests(base, current)

      if (!options.upstream) {
        if (!local.hasChanges) {
          ui.info('No local changes: the vault matches the installed version.')
        } else {
          ui.info(`Local changes: ${summarizeDiff(local)}`)
          gitDiff(pristineDir, vaultDir, `Local changes in ${id}`)
        }
      }

      const registry = await tryLoadRegistry(ctx)
      const entry = registry?.index.skills.find((skill) => skill.id === id)
      if (registry && entry) {
        const sourceDir = registrySkillDir(registry.location, entry)
        const plan = await planSkillUpdate({
          paths: ctx.paths,
          id,
          sourceDir,
          installed: ctx.state.skills[id],
          registryVersion: entry.version,
        })
        if (plan.upstream && plan.upstream.hasChanges) {
          ui.info(`Registry changes: ${summarizeDiff(plan.upstream)}`)
          gitDiff(pristineDir, sourceDir, `Registry changes in ${id}`)
        } else {
          ui.info('No registry changes since the installed version.')
        }
      } else if (options.upstream) {
        ui.warn('No registry entry found for this skill.')
      }
    })
  })
}
