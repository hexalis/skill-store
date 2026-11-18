import { promises as fs } from 'node:fs'
import { Command } from 'commander'
import pc from 'picocolors'
import {
  applySkillUpdate,
  prepareInstalledUpdates,
  type SkillUpdatePlan,
  type UpdateResolution,
} from '@apocryphon/core'
import {
  loadContext,
  loadRegistry,
  saveState,
  syncContext,
  type CliContext,
  type RegistryHandle,
} from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { printSyncReport } from '../lib/output.js'
import { planSummary, resolveUpdate } from '../lib/update-flow.js'
import type { Ui } from '../lib/ui.js'

interface SyncOptions {
  project?: string
  all?: boolean
  offline?: boolean
  json?: boolean
  dryRun?: boolean
  force?: boolean
  keep?: boolean
  merge?: boolean
}

interface Decision {
  plan: SkillUpdatePlan
  resolution: UpdateResolution
  fileChoices?: Record<string, 'ours' | 'theirs' | 'merge'>
}

async function dirExists(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function decideUpdates(
  ui: Ui,
  plans: SkillUpdatePlan[],
  options: SyncOptions,
  dryRun: boolean,
): Promise<Decision[]> {
  const decisions: Decision[] = []

  for (const plan of plans) {
    if (!plan.updateAvailable) continue

    if (dryRun) {
      decisions.push({ plan, resolution: plan.customized ? 'keep' : 'overwrite' })
      continue
    }

    if (!plan.customized || plan.suggestedAction === 'fast-forward') {
      decisions.push({ plan, resolution: 'overwrite' })
      continue
    }

    const resolved = await resolveUpdate(ui, plan, {
      force: options.force,
      keep: options.keep,
      merge: options.merge,
    })
    if (!resolved) {
      throw new Error('Cancelled: no changes were applied.')
    }
    decisions.push({ plan, resolution: resolved.resolution, fileChoices: resolved.fileChoices })
  }

  return decisions
}

function printDryRun(ui: Ui, plans: SkillUpdatePlan[], handle: RegistryHandle | null): void {
  if (!handle) {
    ui.info('Registry updates skipped (--offline): only symlinks will be reconciled.')
    return
  }
  if (plans.length === 0) {
    ui.info('No installed skills found in the registry.')
    return
  }

  ui.info(`\n${pc.bold('Update plan')}`)
  for (const plan of plans) {
    const action = !plan.updateAvailable
      ? pc.dim('up to date')
      : plan.suggestedAction === 'fast-forward'
        ? pc.green('fast-forward')
        : plan.customized
          ? pc.yellow('needs decision')
          : pc.dim('skip')
    ui.info(`  ${planSummary(plan)} → ${action}`)
  }
}

async function applyDecisions(
  ctx: CliContext,
  handle: RegistryHandle,
  decisions: Decision[],
  ui: Ui,
): Promise<{ conflicts: number; backups: number }> {
  let conflicts = 0
  let backups = 0

  for (const decision of decisions) {
    const entry = handle.index.skills.find((skill) => skill.id === decision.plan.id)
    if (!entry) continue

    const applied = await applySkillUpdate({
      paths: ctx.paths,
      id: decision.plan.id,
      sourceDir: decision.plan.sourceDir,
      plan: decision.plan,
      resolution: decision.resolution,
      state: ctx.state,
      version: entry.version,
      source: { type: 'registry', ref: handle.location.source },
      fileChoices: decision.fileChoices,
    })

    if (applied.backup) backups += 1
    if (applied.conflicts.length > 0) {
      conflicts += applied.conflicts.length
      ui.warn(
        `${decision.plan.id}: conflicts in ${applied.conflicts.join(', ')} (markers preserved).`,
      )
    } else if (decision.resolution !== 'keep') {
      ui.debug(`${decision.plan.id}: ${decision.resolution} applied`)
    }
    await saveState(ctx)
  }

  return { conflicts, backups }
}

export async function runSync(options: SyncOptions, ui: Ui = uiFromArgv(Boolean(options.json))): Promise<void> {
  const ctx = await loadContext({ project: options.project })
  const reporter = ui.reporter()
  const dryRun = options.dryRun ?? false

  let handle: RegistryHandle | null = null
  if (!options.offline) {
    handle = await loadRegistry(ctx, { pull: !dryRun, reporter })
  }

  let plans: SkillUpdatePlan[] = []
  let removedFromRegistry: string[] = []

  if (handle) {
    const prepared = await prepareInstalledUpdates({
      location: handle.location,
      index: handle.index,
      paths: ctx.paths,
      state: ctx.state,
      reporter,
    })
    plans = prepared.plans
    removedFromRegistry = prepared.removedFromRegistry
  }

  if (handle && plans.length > 0) {
    printDryRun(ui, plans, handle)
  }

  const decisions = await decideUpdates(ui, plans, options, dryRun)

  let conflicts = 0
  let backups = 0

  if (!dryRun && handle) {
    const applied = await applyDecisions(ctx, handle, decisions, ui)
    conflicts = applied.conflicts
    backups = applied.backups
  }

  // Reconcile symlinks (and project excludes) for the current project, or all
  // registered projects with --all.
  const reports: Array<{ project: string | null; report: Awaited<ReturnType<typeof syncContext>> }> = []

  if (options.all) {
    for (const [root, entry] of Object.entries(ctx.projects.projects)) {
      if (!(await dirExists(root))) {
        ui.warn(`Skipping ${root} (directory not found).`)
        continue
      }
      reports.push({
        project: root,
        report: await syncContext(ctx, {
          projectRoot: root,
          entry,
          registryPacks: handle?.index.packs ?? null,
          dryRun,
          reporter,
        }),
      })
    }
  } else {
    reports.push({
      project: ctx.projectRoot,
      report: await syncContext(ctx, {
        registryPacks: handle?.index.packs ?? null,
        dryRun,
        reporter,
      }),
    })
  }

  await saveState(ctx)

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          dryRun,
          plans: plans.map((plan) => ({
            id: plan.id,
            customized: plan.customized,
            updateAvailable: plan.updateAvailable,
            conflicted: plan.conflicted,
            suggestedAction: plan.suggestedAction,
            local: plan.local
              ? { added: plan.local.added, modified: plan.local.modified, deleted: plan.local.deleted }
              : null,
            upstream: plan.upstream
              ? {
                  added: plan.upstream.added,
                  modified: plan.upstream.modified,
                  deleted: plan.upstream.deleted,
                }
              : null,
          })),
          decisions: decisions.map((decision) => ({
            id: decision.plan.id,
            resolution: decision.resolution,
          })),
          removedFromRegistry,
          reports,
        },
        null,
        2,
      ),
    )
    if (conflicts > 0) process.exitCode = 1
    return
  }

  if (handle) {
    if (removedFromRegistry.length > 0) {
      for (const id of removedFromRegistry) {
        ui.warn(`"${id}" is installed but no longer exists in the registry.`)
      }
    }
    if (!dryRun && (decisions.length > 0 || backups > 0)) {
      ui.success(
        `Updates applied: ${decisions.filter((d) => d.resolution !== 'keep').length} · backups: ${backups}`,
      )
    }
  }

  for (const entry of reports) {
    console.log(`\n  ${pc.bold(entry.project ?? 'global')}${dryRun ? pc.dim(' (dry run)') : ''}`)
    printSyncReport(entry.report)
  }

  if (dryRun) {
    ui.info(`\n${pc.dim('Dry run: nothing was written. Re-run without --dry-run to apply.')}`)
  }

  if (conflicts > 0) process.exitCode = 1
}

export function syncCommand(): Command {
  const command = new Command('sync')
    .description('Update installed skills and reconcile client symlinks')
    .option('-p, --project <dir>', 'Project directory (defaults to cwd)')
    .option('--all', 'Sync every registered project')
    .option('--offline', 'Do not pull the registry or compare updates')
    .option('--dry-run', 'Print the plan without touching disk')
    .option('-f, --force', 'Registry wins for every conflicting file (creates a backup)')
    .option('--keep', 'Keep local changes and skip conflicting updates')
    .option('--merge', 'Three-way merge conflicting updates')
    .option('--json', 'Print machine-readable JSON')

  addGlobalOptions(command)

  return command.action(async (options: SyncOptions) => {
    await runSafely(() => runSync(options))
  })
}
