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
  type State,
} from './schemas.js'
import { expandHome, findRegisteredProject, normalizeProjectPath, type ApocryphonPaths } from './paths.js'
import { listVaultSkills } from './vault.js'
import { computeContextBudget, type ContextBudget } from './context-budget.js'
import { expandActiveSkills } from './packs.js'
import { coveredBy } from './clients.js'
import { readGitExclude } from './git-exclude.js'
import {
  verifySkillIntegrity,
  type IntegrityReport,
  type SkillLintResult,
} from './skill-linter.js'

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
  installed: boolean
  activeGlobal: boolean
  activeProject: boolean
  lintErrors: number
  lintWarnings: number
}

export interface StatusReport {
  home: string
  registrySource: string | null
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
}

export interface CollectStatusOptions {
  paths: ApocryphonPaths
  config: Config
  state: State
  projects: Projects
  projectRoot?: string | null
  registryPacks?: Record<string, Pack> | null
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
    warnings: skill.issues.filter((issue) => issue.level === 'warning').map((issue) => issue.message),
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

  const rows: SkillStatusRow[] = vaultSkills.map((skill) => {
    const summary = lintSummary(skill)
    return {
      id: skill.id,
      description: skill.frontmatter?.description ?? null,
      category: skill.frontmatter?.category ?? null,
      installed: true,
      activeGlobal: activeGlobal.has(skill.id),
      activeProject: activeProject.has(skill.id),
      lintErrors: summary.errors.length,
      lintWarnings: summary.warnings.length,
    }
  })

  for (const id of missingSkills) {
    rows.push({
      id,
      description: null,
      category: null,
      installed: false,
      activeGlobal: activeGlobal.has(id),
      activeProject: activeProject.has(id),
      lintErrors: 0,
      lintWarnings: 0,
    })
  }
  rows.sort((a, b) => a.id.localeCompare(b.id))

  const lintIssues = vaultSkills
    .map((skill) => ({ id: skill.id, ...lintSummary(skill) }))
    .filter((item) => item.errors.length > 0 || item.warnings.length > 0)

  const exclude = resolvedProject ? await readGitExclude(resolvedProject) : null

  return {
    home: paths.home,
    registrySource: config.registry?.source ?? null,
    projectRoot: resolvedProject,
    projectEntry: entry,
    clients,
    skills: rows,
    active: { ...active, missingSkills },
    budget,
    integrity,
    lintIssues,
    exclude,
  }
}
