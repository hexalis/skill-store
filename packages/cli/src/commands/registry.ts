import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import {
  collectActivePacks,
  defaultRegistrySource,
  effectiveRegistryConfig,
  expandHome,
  isDefaultRegistrySource,
  isGitSource,
  pathExists,
  prepareRegistrySource,
  readRegistryIndex,
  registryPackSet,
  resolveRegistryLocation,
  type RegistryIndex,
} from '@apocryphon/core'
import {
  loadContext,
  saveConfig,
  saveState,
  syncContext,
  type CliContext,
} from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { printJson, printSyncReport } from '../lib/output.js'
import type { Ui } from '../lib/ui.js'

interface ShowOptions {
  json?: boolean
}

interface UseOptions {
  ref?: string
  json?: boolean
}

interface RegistryInfo {
  source: string
  ref: string | null
  isDefault: boolean
  matchesDefault: boolean
  kind: 'git' | 'local'
  cacheDir: string
  exists: boolean
  skills: number | null
  packs: number | null
  error?: string
}

async function registryInfo(
  ctx: CliContext,
  source: string,
  ref: string | undefined,
  isDefault: boolean,
): Promise<RegistryInfo> {
  const location = resolveRegistryLocation(source, ctx.paths, os.homedir(), ref)
  const exists = await pathExists(location.dir)
  let index: RegistryIndex | null = null
  let error: string | undefined

  if (exists) {
    try {
      index = await readRegistryIndex(location)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  return {
    source,
    ref: ref ?? null,
    isDefault,
    matchesDefault: isDefaultRegistrySource(source),
    kind: location.kind,
    cacheDir: location.dir,
    exists,
    skills: index?.skills.length ?? null,
    packs: index ? Object.keys(index.packs).length : null,
    ...(error ? { error } : {}),
  }
}

function printRegistryInfo(ui: Ui, info: RegistryInfo): void {
  const label = info.isDefault ? pc.green('default') : pc.cyan('override')
  ui.info(`\n${pc.bold('Registry')} ${pc.dim(label)}`)
  ui.info(`  Source: ${info.source}`)
  if (info.ref) ui.info(`  Ref:    ${info.ref}`)
  ui.info(`  Type:   ${info.kind}`)
  ui.info(`  Cache:  ${info.cacheDir} ${info.exists ? pc.green('(fetched)') : pc.yellow('(not fetched)')}`)
  if (info.skills !== null) {
    ui.info(`  Catalog: ${info.skills} skill(s) · ${info.packs ?? 0} pack(s)`)
  } else if (info.error) {
    ui.warn(`  Cache exists but the index is invalid: ${info.error}`)
  } else {
    ui.info(`  ${pc.dim('Run `apocryphon sync` to fetch the catalog.')}`)
  }
  if (info.matchesDefault && !info.isDefault) {
    ui.info(`  ${pc.dim('This source matches the built-in default. `registry default` clears the override.')}`)
  }
}

async function switchRegistry(
  ctx: CliContext,
  ui: Ui,
  source: string,
  ref: string | undefined,
  forceDefault: boolean,
  json: boolean,
): Promise<void> {
  const trimmedSource = source.trim()
  const trimmedRef = ref?.trim() || undefined
  if (!trimmedSource) throw new Error('The registry source cannot be empty.')
  if (trimmedRef && !isGitSource(trimmedSource)) {
    throw new Error('--ref only applies to Git sources, not local paths.')
  }

  // Local paths are persisted as absolute paths so later commands work from
  // any working directory.
  const normalizedSource = isGitSource(trimmedSource)
    ? trimmedSource
    : path.resolve(expandHome(trimmedSource))

  // Prepare and validate before writing any config/state.
  const prepared = await prepareRegistrySource({
    paths: ctx.paths,
    source: normalizedSource,
    ref: trimmedRef,
    homeDir: os.homedir(),
    reporter: ui.reporter(),
  })

  const clearsToDefault =
    forceDefault || (!trimmedRef && isDefaultRegistrySource(normalizedSource))

  ctx.config = {
    ...ctx.config,
    registry: clearsToDefault
      ? null
      : {
          source: normalizedSource,
          ...(trimmedRef ? { ref: trimmedRef } : {}),
        },
  }
  ctx.state = {
    ...ctx.state,
    packs: registryPackSet(
      ctx.state.packs,
      prepared.index.packs,
      collectActivePacks(ctx.state, ctx.projects),
    ),
    updatedAt: new Date().toISOString(),
  }
  await saveConfig(ctx)
  await saveState(ctx)

  const report = await syncContext(ctx, {
    registryPacks: prepared.index.packs,
    reporter: ui.reporter(),
  })

  const payload = {
    source: normalizedSource,
    ref: trimmedRef ?? null,
    isDefault: clearsToDefault,
    kind: prepared.location.kind,
    cacheDir: prepared.location.dir,
    skills: prepared.index.skills.length,
    packs: Object.keys(prepared.index.packs).length,
    installed: Object.keys(ctx.state.skills).length,
  }

  if (json) {
    printJson(payload)
    return
  }

  ui.success(
    `Registry source set to ${pc.bold(normalizedSource)}${trimmedRef ? ` @ ${trimmedRef}` : ''} ${clearsToDefault ? pc.dim('(default)') : ''}`,
  )
  ui.info(
    `  ${prepared.index.skills.length} skill(s) · ${Object.keys(prepared.index.packs).length} pack(s) · ${payload.installed} installed skill(s) preserved`,
  )
  printSyncReport(report)
}

export function registryCommand(): Command {
  const command = new Command('registry').description(
    'Inspect or change the active skill registry (default or override)',
  )

  const show = command
    .command('show')
    .description('Show the active registry, its cache and catalog summary')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: ShowOptions) => {
      await runSafely(async () => {
        const ui = uiFromArgv(Boolean(options.json))
        const ctx = await loadContext()
        const effective = effectiveRegistryConfig(ctx.config)
        const info = await registryInfo(
          ctx,
          effective.source,
          effective.ref,
          ctx.config.registry === null,
        )
        if (options.json) {
          printJson(info)
          return
        }
        printRegistryInfo(ui, info)
      })
    })

  const use = command
    .command('use')
    .description('Switch to a local path or Git registry, validating it first')
    .argument('<source>', 'Local path, Git URL (GitHub, Azure, file://)')
    .option('--ref <ref>', 'Branch, tag or commit to pin (Git sources only)')
    .option('--json', 'Print machine-readable JSON')
    .action(async (source: string, options: UseOptions) => {
      await runSafely(async () => {
        const ui = uiFromArgv(Boolean(options.json))
        const ctx = await loadContext()
        await switchRegistry(ctx, ui, source, options.ref, false, Boolean(options.json))
      })
    })

  const reset = command
    .command('default')
    .description('Restore the built-in default registry and remove the override')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: ShowOptions) => {
      await runSafely(async () => {
        const ui = uiFromArgv(Boolean(options.json))
        const ctx = await loadContext()
        await switchRegistry(
          ctx,
          ui,
          defaultRegistrySource(),
          undefined,
          true,
          Boolean(options.json),
        )
      })
    })

  addGlobalOptions(show)
  addGlobalOptions(use)
  addGlobalOptions(reset)
  addGlobalOptions(command)
  return command
}
