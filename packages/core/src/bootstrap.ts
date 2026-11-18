import os from 'node:os'
import type { ApocryphonPaths } from './paths.js'
import {
  type ClientId,
  type Config,
  type ClientsConfig,
  type RegistryIndex,
  type State,
} from './schemas.js'
import { defaultClientsConfig } from './clients.js'
import {
  emptyProjects,
  emptyState,
  ensureDir,
  pathExists,
  readConfig,
  readProjects,
  readState,
  writeConfig,
  writeProjects,
  writeState,
} from './store.js'
import {
  ensureRegistry,
  readRegistryIndex,
  resolveRegistryLocation,
  type RegistryLocation,
} from './registry.js'
import type { ProgressReporter } from './progress.js'

export interface InitializeOptions {
  paths: ApocryphonPaths
  registrySource?: string | null
  enabledClients?: ClientId[]
  force?: boolean
  homeDir?: string
  reporter?: ProgressReporter
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

export function mergeRegistryPacks(state: State, index: RegistryIndex): State {
  const merged = { ...state.packs }
  for (const [name, pack] of Object.entries(index.packs)) {
    merged[name] = pack
  }
  return { ...state, packs: merged, updatedAt: new Date().toISOString() }
}

/**
 * Create (or repair) the Apocryphon home directory.
 *
 * Existing configuration is preserved unless `force` is set. When a registry is
 * provided, its pack definitions are imported into state.json so packs keep
 * working offline.
 */
export async function initializeHome(options: InitializeOptions): Promise<InitializeResult> {
  const { paths, registrySource = null, enabledClients = [], force = false } = options
  const createdDirs: string[] = []
  const createdFiles: string[] = []

  for (const dir of [paths.home, paths.vault, paths.pristine, paths.backups]) {
    if (!(await pathExists(dir))) createdDirs.push(dir)
    await ensureDir(dir)
  }

  let config: Config
  if (force || !(await pathExists(paths.config))) {
    config = {
      version: 1,
      dedupe: true,
      registry: registrySource ? { source: registrySource } : null,
      clients: buildClients(enabledClients),
      budget: { warnAt: 8, failAt: 15 },
    }
    await writeConfig(paths.config, config)
    createdFiles.push(paths.config)
  } else {
    config = await readConfig(paths.config)
    if (registrySource && config.registry?.source !== registrySource) {
      config = { ...config, registry: { source: registrySource } }
      await writeConfig(paths.config, config)
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

  if (!(await pathExists(paths.projects))) {
    await writeProjects(paths.projects, emptyProjects())
    createdFiles.push(paths.projects)
  } else {
    await readProjects(paths.projects)
  }

  let registry: InitializeResult['registry'] = null
  if (config.registry?.source) {
    const location = resolveRegistryLocation(
      config.registry.source,
      paths,
      options.homeDir ?? os.homedir(),
    )
    await ensureRegistry(location, { reporter: options.reporter })
    const index = await readRegistryIndex(location)
    state = mergeRegistryPacks(state, index)
    await writeState(paths.state, state)
    registry = { index, location }
  }

  return { createdDirs, createdFiles, config, state, registry }
}
