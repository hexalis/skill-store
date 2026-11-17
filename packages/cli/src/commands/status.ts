import { Command } from 'commander'
import pc from 'picocolors'
import {
  collectStatus,
  CLIENT_LABELS,
} from '@apocryphon/core'
import { loadContext, tryLoadRegistry } from '../lib/context.js'
import { runSafely } from '../lib/run.js'
import {
  heading,
  kv,
  levelLabel,
  printJson,
  table,
  truncate,
} from '../lib/output.js'

export function statusCommand(): Command {
  return new Command('status')
    .description('Show clients, active skills, context budget and repository hygiene')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { project?: string; json?: boolean }) => {
      await runSafely(async () => {
        const ctx = await loadContext({ project: options.project })
        const registry = await tryLoadRegistry(ctx)
        const status = await collectStatus({
          paths: ctx.paths,
          config: ctx.config,
          state: ctx.state,
          projects: ctx.projects,
          projectRoot: ctx.projectRoot,
          registryPacks: registry?.index.packs ?? null,
        })

        if (options.json) {
          printJson(status)
          return
        }

        console.log(`\n${pc.bold('Apocryphon')} ${pc.dim(status.home)}`)
        kv('Registry', status.registrySource ?? pc.dim('not configured'))
        kv('Project', status.projectRoot ?? pc.dim('none'))
        if (status.projectRoot) {
          kv(
            'Registered',
            status.projectEntry
              ? pc.green('yes')
              : pc.dim('no (will be created on first change)'),
          )
        }

        heading('Clients')
        console.log(
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

        heading('Skills')
        console.log(
          `  Global  (${status.active.global.length}): ${status.active.global.join(', ') || pc.dim('none')}`,
        )
        console.log(
          `  Project (${status.active.project.length}): ${status.active.project.join(', ') || pc.dim('none')}`,
        )
        if (ctx.state.globalPacks.length > 0) {
          console.log(`  Packs (global): ${ctx.state.globalPacks.join(', ')}`)
        }
        if ((status.projectEntry?.packs.length ?? 0) > 0) {
          console.log(`  Packs (project): ${status.projectEntry?.packs.join(', ')}`)
        }
        if (status.active.unknownPacks.length > 0) {
          console.log(
            `  ${pc.yellow('Unknown packs')}: ${status.active.unknownPacks.join(', ')}`,
          )
        }
        if (status.active.missingSkills.length > 0) {
          console.log(
            `  ${pc.yellow('Missing skills')}: ${status.active.missingSkills.join(', ')}`,
          )
        }

        heading('Context budget')
        console.log(
          `  ${status.budget.count} skill(s) · ~${status.budget.tokens} tokens · ${levelLabel(status.budget.level)} ${pc.dim(`(warn at ${status.budget.thresholds.warnAt}, fail above ${status.budget.thresholds.failAt})`)}`,
        )
        const top = status.budget.breakdown.slice(0, 5)
        if (top.length > 0) {
          console.log(
            `  ${pc.dim('Heaviest:')} ${top.map((item) => `${item.id} (${item.tokens})`).join(', ')}`,
          )
        }

        heading('Repository hygiene')
        if (status.exclude) {
          console.log(`  Exclude file: ${status.exclude.file}`)
          console.log(`  Managed entries: ${status.exclude.entries.length}`)
        } else {
          console.log(
            `  ${pc.dim('No git repository detected for the current project.')}`,
          )
        }

        const modified = status.integrity.filter((item) => item.status === 'modified')
        const unknown = status.integrity.filter((item) => item.status === 'unknown')
        if (modified.length > 0) {
          console.log(
            `  ${pc.yellow('Scripts modified since install:')} ${modified.map((item) => item.id).join(', ')}`,
          )
        }
        if (unknown.length > 0) {
          console.log(
            `  ${pc.dim(`Unrecorded scripts (run \`apocryphon sync\`): ${unknown.map((item) => item.id).join(', ')}`)}`,
          )
        }
        if (modified.length === 0 && unknown.length === 0) {
          console.log(`  Integrity: ${pc.green('ok')}`)
        }

        if (status.lintIssues.length > 0) {
          heading('Lint')
          for (const item of status.lintIssues) {
            const parts = [
              item.errors.length > 0 ? pc.red(`${item.errors.length} error(s)`) : '',
              item.warnings.length > 0
                ? pc.yellow(`${item.warnings.length} warning(s)`)
                : '',
            ].filter(Boolean)
            console.log(`  ${item.id}: ${parts.join(', ')}`)
            for (const warning of item.warnings.slice(0, 2)) {
              console.log(`    ${pc.dim(truncate(warning, 100))}`)
            }
            for (const error of item.errors.slice(0, 2)) {
              console.log(`    ${pc.red(truncate(error, 100))}`)
            }
          }
        }
      })
    })
}
