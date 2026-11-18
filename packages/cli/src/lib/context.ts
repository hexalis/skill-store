import path from 'node:path'
import {
  ensureRegistry,
  findRegisteredProject,
  mergeRegistryPacks,
  normalizeProjectPath,
  readConfig,
  readProjects,
  readRegistryIndex,
  readState,
  resolvePaths,
  resolveRegistryLocation,
  syncSkills,
  writeConfig,
  writeProjects,
  writeState,
  type ApocryphonPaths,
  type Config,
  type Pack,
  type ProjectEntry,
  type Projects,
  type RegistryIndex,
  type RegistryLocation,
  type State,
  type SyncReport,
  type ProgressReporter,
} from '@apocryphon/core'

export interface CliContext {
  paths: ApocryphonPaths
  config: Config
  state: State
  projects: Projects
  projectRoot: string
  entry: ProjectEntry | null
  registeredRoot: string | null
}

export interface LoadContextOptions {
  project?: string | undefined
}

export async function loadContext(options: LoadContextOptions = {}): Promise<CliContext> {
  const paths = resolvePaths()
  const config = await readConfig(paths.config)
  const state = await readState(paths.state)
  const projects = await readProjects(paths.projects)
  const projectRoot = normalizeProjectPath(options.project ?? process.cwd())
  const registered = findRegisteredProject(projects.projects, projectRoot)

  return {
    paths,
    config,
    state,
    projects,
    projectRoot,
    entry: registered?.entry ?? null,
    registeredRoot: registered?.root ?? null,
  }
}

export async function saveState(ctx: CliContext): Promise<void> {
  ctx.state = { ...ctx.state, updatedAt: new Date().toISOString() }
  await writeState(ctx.paths.state, ctx.state)
}

export async function saveConfig(ctx: CliContext): Promise<void> {
  await writeConfig(ctx.paths.config, ctx.config)
}

export function ensureEntry(ctx: CliContext): ProjectEntry {
  return (
    ctx.entry ?? {
      skills: [],
      packs: [],
      updatedAt: new Date().toISOString(),
    }
  )
}

export async function saveProjectEntry(
  ctx: CliContext,
  entry: ProjectEntry,
): Promise<void> {
  const next: ProjectEntry = { ...entry, updatedAt: new Date().toISOString() }
  ctx.projects = {
    ...ctx.projects,
    projects: { ...ctx.projects.projects, [ctx.projectRoot]: next },
  }
  ctx.entry = next
  ctx.registeredRoot = ctx.projectRoot
  await writeProjects(ctx.paths.projects, ctx.projects)
}

export interface RegistryHandle {
  location: RegistryLocation
  index: RegistryIndex
  /** Snapshot consumable by `collectStatus`. */
  snapshot: { dir: string; index: RegistryIndex }
}

export async function loadRegistry(
  ctx: CliContext,
  options: { pull?: boolean; reporter?: ProgressReporter } = {},
): Promise<RegistryHandle | null> {
  const source = ctx.config.registry?.source
  if (!source) return null

  const location = resolveRegistryLocation(source, ctx.paths)
  await ensureRegistry(location, { pull: options.pull ?? false, reporter: options.reporter })
  const index = await readRegistryIndex(location)
  ctx.state = mergeRegistryPacks(ctx.state, index)
  return { location, index, snapshot: { dir: location.dir, index } }
}

export async function tryLoadRegistry(
  ctx: CliContext,
  options: { pull?: boolean; reporter?: ProgressReporter } = {},
): Promise<RegistryHandle | null> {
  try {
    return await loadRegistry(ctx, options)
  } catch {
    return null
  }
}

export async function requireRegistry(ctx: CliContext): Promise<RegistryHandle> {
  const handle = await loadRegistry(ctx)
  if (!handle) {
    throw new Error(
      'No skill registry configured. Run `apocryphon init --registry <git-url-or-path>` first.',
    )
  }
  return handle
}

/** Merge pack definitions, registry taking precedence over the local cache. */
export function availablePacks(
  ctx: CliContext,
  registryPacks?: Record<string, Pack> | null,
): Record<string, Pack> {
  const merged: Record<string, Pack> = { ...ctx.state.packs }
  if (registryPacks) {
    for (const [name, pack] of Object.entries(registryPacks)) merged[name] = pack
  }
  return merged
}

export interface SyncContextOptions {
  projectRoot?: string | null
  entry?: ProjectEntry | null
  registryPacks?: Record<string, Pack> | null
  dryRun?: boolean
  reporter?: ProgressReporter
}

export async function syncContext(
  ctx: CliContext,
  options: SyncContextOptions = {},
): Promise<SyncReport> {
  return syncSkills({
    paths: ctx.paths,
    config: ctx.config,
    state: ctx.state,
    projectRoot: options.projectRoot === undefined ? ctx.projectRoot : options.projectRoot,
    entry: options.entry === undefined ? ctx.entry : options.entry,
    registryPacks: options.registryPacks ?? null,
    dryRun: options.dryRun ?? false,
    reporter: options.reporter,
  })
}

export function activePacks(ctx: CliContext, global: boolean): string[] {
  return global ? ctx.state.globalPacks : (ctx.entry?.packs ?? [])
}

export function activeSkills(ctx: CliContext, global: boolean): string[] {
  return global ? ctx.state.globalSkills : (ctx.entry?.skills ?? [])
}

export function projectLabel(ctx: CliContext): string {
  return ctx.registeredRoot ?? `${ctx.projectRoot} ${'(not registered yet)'}`
}

export function skillDir(ctx: CliContext, id: string): string {
  return path.join(ctx.paths.vault, id)
}
