import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  CLIENT_IDS,
  type ClientId,
  type Config,
  type Pack,
  type ProjectEntry,
  type Projects,
  type RegistryIndex,
  type State,
} from './schemas.js'
import { expandHome, findRegisteredProject, normalizeProjectPath, type SkillStorePaths } from './paths.js'
import { type SkillLintResult } from './skill-linter.js'
import { listVaultSkills } from './vault.js'
import { computeContextBudget, type ContextBudget } from './context-budget.js'
import { expandActiveSkills } from './packs.js'
import { coveredBy } from './clients.js'
import { readGitExclude } from './git-exclude.js'
import { verifySkillIntegrity, type IntegrityReport } from './skill-linter.js'
import { buildManifest } from './skill-files.js'
import { pathExists } from './store.js'
import { diffManifests } from './skill-diff.js'
import { planSkillUpdate } from './skill-updates.js'
import { registrySkillDir } from './registry.js'
import { effectiveRegistryConfig } from './registry-config.js'

export interface ClientStatus {
  id: ClientId
  enabled: boolean
  coveredBy: ClientId | null
  globalDir: string
  projectDir: string | null
  globalLinks: number
  projectLinks: number
}

export interface SkillStatusRow {
  id: string
  description: string | null
  category: string | null
  tags: string[]
  version: string | null
  installed: boolean
  activeGlobal: boolean
  activeProject: boolean
  lintErrors: number
  lintWarnings: number
  customized: boolean
  updateAvailable: boolean
  baseline: 'known' | 'unknown'
}

export interface StatusReport {
  home: string
  registrySource: string
  registryRef: string | null
  registryIsDefault: boolean
  projectRoot: string | null
  projectEntry: ProjectEntry | null
  clients: ClientStatus[]
  skills: SkillStatusRow[]
  active: {
    global: string[]
    project: string[]
    unknownPacks: string[]
    missingSkills: string[]
  }
  budget: ContextBudget
  integrity: IntegrityReport[]
  lintIssues: Array<{ id: string; errors: string[]; warnings: string[] }>
  exclude: { file: string; entries: string[] } | null
  categoryCounts: Record<string, number>
}

export interface RegistrySnapshot {
  dir: string
  index: RegistryIndex
}

export interface CollectStatusOptions {
  paths: SkillStorePaths
  config: Config
  state: State
  projects: Projects
  projectRoot?: string | null
  registryPacks?: Record<string, Pack> | null
  registry?: RegistrySnapshot | null
  homeDir?: string
}

async function dirExists(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function countManagedLinks(dir: string, vaultDir: string): Promise<number> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }

  let count = 0
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue
    try {
      const resolved = await fs.realpath(path.join(dir, entry.name))
      if (isInside(resolved, vaultDir)) count += 1
    } catch {
      // Dangling symlink: not counted, but `sync` will prune it.
    }
  }
  return count
}

function lintSummary(skill: SkillLintResult): { errors: string[]; warnings: string[] } {
  return {
    errors: skill.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message),
    warnings: skill.issues
      .filter((issue) => issue.level === 'warning')
      .map((issue) => issue.message),
  }
}

interface CustomizationInfo {
  customized: boolean
  updateAvailable: boolean
  baseline: 'known' | 'unknown'
}

async function customizationInfo(options: {
  paths: SkillStorePaths
  id: string
  state: State
  registry?: RegistrySnapshot | null
}): Promise<CustomizationInfo> {
  const { paths, id, state, registry } = options
  const installed = state.skills[id]
  const vaultDir = path.join(paths.vault, id)
  const pristineDir = path.join(paths.pristine, id)

  if (!(await pathExists(pristineDir))) {
    return {
      customized: true,
      updateAvailable: Boolean(registry?.index.skills.some((skill) => skill.id === id)),
      baseline: 'unknown',
    }
  }

  const registryEntry = registry?.index.skills.find((skill) => skill.id === id)
  if (registry && registryEntry) {
    try {
      const plan = await planSkillUpdate({
        paths,
        id,
        // path is validated by the caller that built the snapshot
        sourceDir: registrySkillDir(
          { kind: 'local', dir: registry.dir, source: registry.dir },
          registryEntry,
        ),
        installed,
        registryVersion: registryEntry.version,
      })
      return {
        customized: plan.customized,
        updateAvailable: plan.updateAvailable,
        baseline: plan.baseline,
      }
    } catch {
      // Fall through to local-only detection.
    }
  }

  if (!(await pathExists(vaultDir))) {
    return { customized: false, updateAvailable: false, baseline: 'known' }
  }

  const [base, current] = await Promise.all([
    buildManifest(pristineDir),
    buildManifest(vaultDir),
  ])
  return {
    customized: diffManifests(base, current).hasChanges,
    updateAvailable: false,
    baseline: 'known',
  }
}

/**
 * Build the complete status report consumed by the CLI (and, later, by the UI).
 */
export async function collectStatus(options: CollectStatusOptions): Promise<StatusReport> {
  const {
    paths,
    config,
    state,
    projects,
    projectRoot = null,
    registryPacks = null,
    registry = null,
    homeDir = os.homedir(),
  } = options

  const resolvedProject = projectRoot ? normalizeProjectPath(projectRoot) : null
  const registered = resolvedProject
    ? findRegisteredProject(projects.projects, resolvedProject)
    : null
  const entry = registered?.entry ?? null

  const vaultSkills = await listVaultSkills(paths.vault)
  const vaultById = new Map(vaultSkills.map((skill) => [skill.id, skill]))
  const active = expandActiveSkills(state, entry, registryPacks)

  const activeGlobal = new Set(active.global)
  const activeProject = new Set(active.project)
  const activeIds = [...new Set([...active.global, ...active.project])]

  const missingSkills = activeIds.filter((id) => !vaultById.has(id))

  // Only installed skills reach the model: missing ones are reported separately
  // and must not inflate the prompt budget.
  const budget = computeContextBudget(
    activeIds
      .filter((id) => vaultById.has(id))
      .map((id) => {
        const skill = vaultById.get(id)
        return {
          id,
          name: skill?.frontmatter?.name,
          description: skill?.frontmatter?.description,
        }
      }),
    config.budget,
  )

  const clients: ClientStatus[] = []
  for (const client of CLIENT_IDS) {
    const settings = config.clients[client]
    const globalDir = path.resolve(expandHome(settings.globalDir, homeDir))
    const clientProjectDir = resolvedProject
      ? path.isAbsolute(settings.projectDir)
        ? settings.projectDir
        : path.join(resolvedProject, settings.projectDir)
      : null

    clients.push({
      id: client,
      enabled: settings.enabled,
      coveredBy: settings.enabled ? coveredBy(client, config.clients, config.dedupe) : null,
      globalDir,
      projectDir: clientProjectDir,
      globalLinks: (await dirExists(globalDir))
        ? await countManagedLinks(globalDir, paths.vault)
        : 0,
      projectLinks:
        clientProjectDir && (await dirExists(clientProjectDir))
          ? await countManagedLinks(clientProjectDir, paths.vault)
          : 0,
    })
  }

  const integrity: IntegrityReport[] = []
  for (const [id, installed] of Object.entries(state.skills)) {
    if (!vaultById.has(id)) continue
    integrity.push(
      await verifySkillIntegrity(path.join(paths.vault, id), installed.scriptChecksums),
    )
  }

  const rows: SkillStatusRow[] = []
  for (const skill of vaultSkills) {
    const summary = lintSummary(skill)
    const customization = await customizationInfo({
      paths,
      id: skill.id,
      state,
      registry,
    })
    rows.push({
      id: skill.id,
      description: skill.frontmatter?.description ?? null,
      category: skill.frontmatter?.category ?? null,
      tags: skill.frontmatter?.tags ?? [],
      version: skill.frontmatter?.version ?? state.skills[skill.id]?.version ?? null,
      installed: true,
      activeGlobal: activeGlobal.has(skill.id),
      activeProject: activeProject.has(skill.id),
      lintErrors: summary.errors.length,
      lintWarnings: summary.warnings.length,
      ...customization,
    })
  }

  for (const id of missingSkills) {
    rows.push({
      id,
      description: null,
      category: null,
      tags: [],
      version: null,
      installed: false,
      activeGlobal: activeGlobal.has(id),
      activeProject: activeProject.has(id),
      lintErrors: 0,
      lintWarnings: 0,
      customized: false,
      updateAvailable: false,
      baseline: 'unknown',
    })
  }
  rows.sort((a, b) => a.id.localeCompare(b.id))

  const lintIssues = vaultSkills
    .map((skill) => ({ id: skill.id, ...lintSummary(skill) }))
    .filter((item) => item.errors.length > 0 || item.warnings.length > 0)

  const exclude = resolvedProject ? await readGitExclude(resolvedProject) : null

  const categoryCounts: Record<string, number> = {}
  for (const row of rows) {
    if (!row.installed) continue
    const key = row.category ?? 'uncategorized'
    categoryCounts[key] = (categoryCounts[key] ?? 0) + 1
  }

  const effectiveRegistry = effectiveRegistryConfig(config)
  return {
    home: paths.home,
    registrySource: effectiveRegistry.source,
    registryRef: effectiveRegistry.ref ?? null,
    registryIsDefault: config.registry === null,
    projectRoot: resolvedProject,
    projectEntry: entry,
    clients,
    skills: rows,
    active: { ...active, missingSkills },
    budget,
    integrity,
    lintIssues,
    exclude,
    categoryCounts,
  }
}
