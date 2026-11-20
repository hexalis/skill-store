import { Command } from 'commander'
import * as p from '@clack/prompts'
import { c as pc } from '../lib/colors.js'
import {
  applySkillUpdate,
  findRegistrySkill,
  installSkillFromRegistry,
  planSkillUpdate,
  registrySkillDir,
  searchRegistry,
  type SkillUpdatePlan,
} from '@hexalis/skill-store-core'
import {
  loadContext,
  requireRegistry,
  saveState,
  syncContext,
  type RegistryHandle,
} from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { fuzzyScore } from '../lib/fuzzy.js'
import { resolveUpdate } from '../lib/update-flow.js'
import { printIssues, printSyncReport, table, truncate } from '../lib/output.js'
import type { Ui } from '../lib/ui.js'

interface InstallOptions {
  filter?: string
  all?: boolean
  force?: boolean
  keep?: boolean
  merge?: boolean
  sync?: boolean
}


async function chooseSkills(
  handle: RegistryHandle,
  installedSkills: Record<string, { customized?: boolean }>,
  filter: string | undefined,
): Promise<string[] | null> {
  const catalog = filter
    ? handle.index.skills.filter(
        (entry) =>
          fuzzyScore(
            filter,
            `${entry.id} ${entry.description ?? ''} ${entry.category ?? ''} ${(entry.tags ?? []).join(' ')}`,
          ) > 0,
      )
    : handle.index.skills

  if (catalog.length === 0) {
    throw new Error(`No catalog skills match "${filter}".`)
  }

  const options = catalog.map((entry) => {
    const installed = Boolean(installedSkills[entry.id])
    const customized = installedSkills[entry.id]?.customized ?? false
    return {
      value: entry.id,
      label: entry.id,
      hint: truncate(
        [
          installed ? (customized ? 'installed · customized' : 'installed') : 'new',
          entry.category ?? '',
          (entry.tags ?? []).slice(0, 2).join(', '),
          entry.version ? `v${entry.version}` : '',
          entry.description ?? '',
        ]
          .filter(Boolean)
          .join(' · '),
        90,
      ),
    }
  })

  if (options.length === 0) throw new Error('The registry has no skills to install.')

  const answer = await p.autocompleteMultiselect<string>({
    message: filter ? `Skills matching "${filter}"` : 'Select skills to install',
    options,
    required: false,
    placeholder: 'Type to filter…',
    filter: (search, option) =>
      fuzzyScore(search, `${option.label} ${option.hint ?? ''}`) > 0,
  })
  if (p.isCancel(answer)) return null
  return answer
}

export async function runInstall(
  ids: string[],
  options: InstallOptions,
  ui: Ui = uiFromArgv(),
): Promise<void> {
  const ctx = await loadContext()
  const handle = await requireRegistry(ctx)
  const reporter = ui.reporter()

  let selected = ids

  if (selected.length === 0) {
    if (options.all) {
      selected = handle.index.skills.map((entry) => entry.id)
    } else {
      if (!ui.interactive) {
        throw new Error(
          'No skills specified. Pass skill ids, use `--all`, or run this command in a terminal to pick from the catalog.',
        )
      }
      const picked = await chooseSkills(handle, ctx.state.skills, options.filter)
      if (!picked) {
        ui.info('Cancelled.')
        return
      }
      selected = picked
    }
  }

  if (selected.length === 0) {
    ui.info('Nothing to install.')
    return
  }

  const missing: string[] = []
  const results: Array<{ id: string; action: string; lint: string }> = []
  let changed = false

  for (const id of selected) {
    const entry = findRegistrySkill(handle.index, id)
    if (!entry) {
      missing.push(id)
      continue
    }

    const installed = ctx.state.skills[id]
    const sourceDir = registrySkillDir(handle.location, entry)

    if (!installed) {
      const spinner = ui.spinner(`Installing ${id}`)
      try {
        const result = await installSkillFromRegistry({
          location: handle.location,
          entry,
          paths: ctx.paths,
          state: ctx.state,
          force: options.force ?? false,
          reporter,
        })
        spinner.stop(`${id} installed`)
        if (result.lint.issues.length > 0) printIssues(result.lint.issues)
        results.push({
          id,
          action: 'installed',
          lint: `${result.lint.issues.filter((issue) => issue.level === 'error').length} errors, ${result.lint.issues.filter((issue) => issue.level === 'warning').length} warnings`,
        })
        changed = true
        await saveState(ctx)
      } catch (error) {
        spinner.stop(`${id} ${pc.red('failed')}`)
        throw error
      }
      continue
    }

    const plan = await planSkillUpdate({
      paths: ctx.paths,
      id,
      sourceDir,
      installed,
      registryVersion: entry.version,
    })

    if (!plan.updateAvailable) {
      results.push({ id, action: 'up to date', lint: '-' })
      continue
    }

    if (plan.suggestedAction === 'fast-forward') {
      const applied = await applySkillUpdate({
        paths: ctx.paths,
        id,
        sourceDir,
        plan,
        resolution: 'overwrite',
        state: ctx.state,
        version: entry.version,
        source: { type: 'registry', ref: handle.location.source },
      })
      results.push({ id, action: 'updated', lint: applied.conflicts.length > 0 ? 'conflicts' : '-' })
      changed = true
      await saveState(ctx)
      continue
    }

    const decision = await resolveUpdate(ui, plan, options)
    if (!decision) {
      ui.info(`Skipped ${id}.`)
      results.push({ id, action: 'skipped', lint: '-' })
      continue
    }

    if (decision.resolution === 'keep') {
      results.push({ id, action: 'kept local', lint: '-' })
      continue
    }

    const applied = await applySkillUpdate({
      paths: ctx.paths,
      id,
      sourceDir,
      plan,
      resolution: decision.resolution,
      state: ctx.state,
      version: entry.version,
      source: { type: 'registry', ref: handle.location.source },
      fileChoices: decision.fileChoices,
    })

    if (applied.backup) {
      ui.debug(`Backup: ${applied.backup.dir}`)
    }
    if (applied.conflicts.length > 0) {
      ui.warn(
        `Conflicts in ${id}: ${applied.conflicts.join(', ')}. Edit the files (markers preserved) and run \`skill-store sync\`.`,
      )
    }

    results.push({
      id,
      action: decision.resolution === 'merge' ? 'merged' : 'overwritten',
      lint: applied.conflicts.length > 0 ? `${applied.conflicts.length} conflicts` : '-',
    })
    changed = true
    await saveState(ctx)
  }

  if (results.length > 0) {
    ui.info(
      `\n${table(
        ['Skill', 'Action', 'Notes'],
        results.map((result) => [result.id, result.action, result.lint]),
      )}`,
    )
  }

  if (missing.length > 0) {
    const suggestions = missing.map((id) => {
      const matches = searchRegistry(handle.index, id).slice(0, 3)
      if (matches.length === 0) return `  ${id}: not found in the registry.`
      return `  ${id}: did you mean ${matches.map((match) => `"${match.id}"`).join(', ')}?`
    })
    throw new Error(
      `Skill(s) not found in the registry:\n${suggestions.join('\n')}\nRun \`skill-store search <query>\` to explore the catalog.`,
    )
  }

  if (changed && options.sync !== false) {
    const report = await syncContext(ctx, {
      registryPacks: handle.index.packs,
      reporter,
    })
    printSyncReport(report)
  }
}

export function installCommand(): Command {
  const command = new Command('install')
    .description('Install or update skills from the configured registry')
    .argument('[skills...]', 'Skill ids (omit to pick from the catalog)')
    .option('--filter <query>', 'Pre-filter the interactive catalog')
    .option('--all', 'Install every skill in the catalog')
    .option('-f, --force', 'Registry wins for every file (creates a backup)')
    .option('--keep', 'Keep local changes and skip the update')
    .option('--merge', 'Three-way merge with the registry version')
    .option('--no-sync', 'Do not refresh symlinks after installing')

  addGlobalOptions(command)

  return command.action(async (ids: string[], options: InstallOptions) => {
    await runSafely(() => runInstall(ids, options))
  })
}
