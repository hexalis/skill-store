import os from 'node:os'
import type { ApocryphonPaths } from './paths.js'
import {
  type ClientId,
  type Config,
  type ClientsConfig,
  type Projects,
  type RegistryIndex,
  type State,
} from './schemas.js'
import { defaultClientsConfig } from './clients.js'
import {
  emptyProjects,
  emptyState,
  ensureDir,
  nowIso,
  pathExists,
  readConfig,
  readProjects,
  readState,
  writeConfig,
  writeProjects,
  writeState,
} from './store.js'
import { prepareRegistrySource, type RegistryLocation } from './registry.js'
import { effectiveRegistryConfig } from './registry-config.js'
import { collectActivePacks, registryPackSet } from './packs.js'
import type { ProgressReporter } from './progress.js'

export interface InitializeOptions {
  paths: ApocryphonPaths
  registrySource?: string | null
  registryRef?: string
  enabledClients?: ClientId[]
  force?: boolean
  homeDir?: string
  reporter?: ProgressReporter
  /**
   * Fetch and validate the active registry during init. Defaults to true when
   * an explicit source is provided; the CLI passes true to fetch the default.
   */
  loadRegistry?: boolean
}

export interface InitializeResult {
  createdDirs: string[]
  createdFiles: string[]
  config: Config
  state: State
  registry: { index: RegistryIndex; location: RegistryLocation } | null
}

function buildClients(enabled: ClientId[]): ClientsConfig {
  return defaultClientsConfig(enabled)
}

/** Merge new pack definitions, keeping old ones that are no longer defined. */
export function mergeRegistryPacks(state: State, index: RegistryIndex): State {
  const merged = { ...state.packs }
  for (const [name, pack] of Object.entries(index.packs)) {
    merged[name] = pack
  }
  return { ...state, packs: merged, updatedAt: nowIso() }
}

/**
 * Create (or repair) the Apocryphon home directory.
 *
 * Existing configuration is preserved unless `force` is set. The active
 * registry is the explicit source, the configured override, or the built-in
 * default. Pack definitions are replaced by the new catalog while preserving
 * packs that are still active.
 */
export async function initializeHome(options: InitializeOptions): Promise<InitializeResult> {
  const {
    paths,
    registrySource = null,
    registryRef,
    enabledClients = [],
    force = false,
    reporter,
  } = options
  const createdDirs: string[] = []
  const createdFiles: string[] = []
  const trimmedRef = registryRef?.trim() || undefined
  const explicitRegistry =
    registrySource && registrySource.trim() !== ''
      ? {
          source: registrySource.trim(),
          ...(trimmedRef ? { ref: trimmedRef } : {}),
        }
      : null

  for (const dir of [paths.home, paths.vault, paths.pristine, paths.backups, paths.registries]) {
    if (!(await pathExists(dir))) createdDirs.push(dir)
    await ensureDir(dir)
  }

  let config: Config
  if (force || !(await pathExists(paths.config))) {
    config = {
      version: 1,
      dedupe: true,
      registry: explicitRegistry,
      clients: buildClients(enabledClients),
      budget: { warnAt: 8, failAt: 15 },
    }
    await writeConfig(paths.config, config)
    createdFiles.push(paths.config)
  } else {
    config = await readConfig(paths.config)
    if (explicitRegistry) {
      const same =
        config.registry?.source === explicitRegistry.source &&
        config.registry?.ref === explicitRegistry.ref
      if (!same) {
        config = { ...config, registry: explicitRegistry }
        await writeConfig(paths.config, config)
      }
    }
  }

  let state: State
  if (await pathExists(paths.state)) {
    state = await readState(paths.state)
  } else {
    state = emptyState()
    await writeState(paths.state, state)
    createdFiles.push(paths.state)
  }

  let projects: Projects
  if (!(await pathExists(paths.projects))) {
    projects = emptyProjects()
    await writeProjects(paths.projects, projects)
    createdFiles.push(paths.projects)
  } else {
    projects = await readProjects(paths.projects)
  }

  let registry: InitializeResult['registry'] = null
  const shouldLoad =
    options.loadRegistry ??
    Boolean(explicitRegistry || config.registry?.source)

  if (shouldLoad) {
    const effective = explicitRegistry ?? effectiveRegistryConfig(config)
    const { location, index } = await prepareRegistrySource({
      paths,
      source: effective.source,
      ref: effective.ref,
      homeDir: options.homeDir ?? os.homedir(),
      reporter,
    })
    state = {
      ...state,
      packs: registryPackSet(state.packs, index.packs, collectActivePacks(state, projects)),
      updatedAt: nowIso(),
    }
    await writeState(paths.state, state)
    registry = { index, location }
  }

  return { createdDirs, createdFiles, config, state, registry }
}
