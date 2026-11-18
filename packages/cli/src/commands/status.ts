import { Command } from 'commander'
import pc from 'picocolors'
import { collectStatus, CLIENT_LABELS } from '@apocryphon/core'
import { loadContext, tryLoadRegistry } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { levelLabel, printJson, table, truncate } from '../lib/output.js'

interface StatusOptions {
  project?: string
  json?: boolean
}

export function statusCommand(): Command {
  const command = new Command('status')
    .description('Show clients, active skills, customization state and context budget')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .option('--json', 'Print machine-readable JSON')

  addGlobalOptions(command)

  return command.action(async (options: StatusOptions) => {
    await runSafely(async () => {
      const ui = uiFromArgv(Boolean(options.json))
      const ctx = await loadContext({ project: options.project })
      const registry = await tryLoadRegistry(ctx)
      const status = await collectStatus({
        paths: ctx.paths,
        config: ctx.config,
        state: ctx.state,
        projects: ctx.projects,
        projectRoot: ctx.projectRoot,
        registryPacks: registry?.index.packs ?? null,
        registry: registry?.snapshot ?? null,
      })

      if (options.json) {
        printJson(status)
        return
      }

      ui.info(`\n${pc.bold('Apocryphon')} ${pc.dim(status.home)}`)
      ui.info(`${pc.dim('Registry'.padEnd(14))}${status.registrySource ?? pc.dim('not configured')}`)
      ui.info(`${pc.dim('Project'.padEnd(14))}${status.projectRoot ?? pc.dim('none')}`)
      if (status.projectRoot) {
        ui.info(
          `${pc.dim('Registered'.padEnd(14))}${
            status.projectEntry ? pc.green('yes') : pc.dim('no (created on first change)')
          }`,
        )
      }

      ui.info(`\n${pc.bold('Clients')}`)
      ui.info(
        table(
          ['Client', 'Enabled', 'Covered by', 'Global', 'Project', 'Global dir'],
          status.clients.map((client) => [
            CLIENT_LABELS[client.id],
            client.enabled ? pc.green('yes') : pc.dim('no'),
            client.coveredBy ? CLIENT_LABELS[client.coveredBy] : '-',
            String(client.globalLinks),
            String(client.projectLinks),
            client.globalDir,
          ]),
        ),
      )

      ui.info(`\n${pc.bold('Skills')}`)
      ui.info(
        `  Global  (${status.active.global.length}): ${status.active.global.join(', ') || pc.dim('none')}`,
      )
      ui.info(
        `  Project (${status.active.project.length}): ${status.active.project.join(', ') || pc.dim('none')}`,
      )
      if (ctx.state.globalPacks.length > 0) {
        ui.info(`  Packs (global): ${ctx.state.globalPacks.join(', ')}`)
      }
      if ((status.projectEntry?.packs.length ?? 0) > 0) {
        ui.info(`  Packs (project): ${status.projectEntry?.packs.join(', ')}`)
      }
      if (status.active.unknownPacks.length > 0) {
        ui.warn(`Unknown packs: ${status.active.unknownPacks.join(', ')}`)
      }
      if (status.active.missingSkills.length > 0) {
        ui.warn(`Active skills missing from the vault: ${status.active.missingSkills.join(', ')}`)
      }

      const customized = status.skills.filter((row) => row.customized)
      const updatable = status.skills.filter((row) => row.updateAvailable)
      const unknownBaseline = status.skills.filter((row) => row.baseline === 'unknown')

      ui.info(`\n${pc.bold('Customization')}`)
      if (customized.length === 0 && updatable.length === 0 && unknownBaseline.length === 0) {
        ui.info(`  ${pc.green('All installed skills are clean and up to date.')}`)
      }
      if (customized.length > 0) {
        ui.info(`  ${pc.yellow('Customized:')} ${customized.map((row) => row.id).join(', ')}`)
      }
      if (updatable.length > 0) {
        ui.info(`  ${pc.cyan('Updates available:')} ${updatable.map((row) => row.id).join(', ')}`)
      }
      if (unknownBaseline.length > 0) {
        ui.info(
          `  ${pc.yellow('Baseline unknown:')} ${unknownBaseline.map((row) => row.id).join(', ')} ${pc.dim('(run `apocryphon adopt <id>`)')}`,
        )
      }

      ui.info(`\n${pc.bold('Context budget')}`)
      ui.info(
        `  ${status.budget.count} skill(s) · ~${status.budget.tokens} tokens · ${levelLabel(status.budget.level)} ${pc.dim(`(warn at ${status.budget.thresholds.warnAt}, fail above ${status.budget.thresholds.failAt})`)}`,
      )
      const top = status.budget.breakdown.slice(0, 5)
      if (top.length > 0) {
        ui.info(
          `  ${pc.dim('Heaviest:')} ${top.map((item) => `${item.id} (${item.tokens})`).join(', ')}`,
        )
      }

      const categories = Object.entries(status.categoryCounts).sort((a, b) => b[1] - a[1])
      if (categories.length > 0) {
        ui.info(`\n${pc.bold('Categories')}`)
        ui.info(`  ${categories.map(([name, count]) => `${name} (${count})`).join(' · ')}`)
      }

      ui.info(`\n${pc.bold('Repository hygiene')}`)
      if (status.exclude) {
        ui.info(`  Exclude file: ${status.exclude.file}`)
        ui.info(`  Managed entries: ${status.exclude.entries.length}`)
      } else {
        ui.info(`  ${pc.dim('No git repository detected for the current project.')}`)
      }

      const modified = status.integrity.filter((item) => item.status === 'modified')
      const unrecorded = status.integrity.filter((item) => item.status === 'unknown')
      if (modified.length > 0) {
        ui.warn(`Scripts modified since install: ${modified.map((item) => item.id).join(', ')}`)
      }
      if (unrecorded.length > 0) {
        ui.info(
          `  ${pc.dim(`Unrecorded scripts (run \`apocryphon sync\`): ${unrecorded.map((item) => item.id).join(', ')}`)}`,
        )
      }
      if (modified.length === 0 && unrecorded.length === 0) {
        ui.info(`  Integrity: ${pc.green('ok')}`)
      }

      if (status.lintIssues.length > 0) {
        ui.info(`\n${pc.bold('Lint')}`)
        for (const item of status.lintIssues) {
          const parts = [
            item.errors.length > 0 ? pc.red(`${item.errors.length} error(s)`) : '',
            item.warnings.length > 0 ? pc.yellow(`${item.warnings.length} warning(s)`) : '',
          ].filter(Boolean)
          ui.info(`  ${item.id}: ${parts.join(', ')}`)
          for (const warning of item.warnings.slice(0, 2)) {
            ui.info(`    ${pc.dim(truncate(warning, 100))}`)
          }
          for (const error of item.errors.slice(0, 2)) {
            ui.info(`    ${pc.red(truncate(error, 100))}`)
          }
        }
      }
    })
  })
}
