import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  CLIENT_IDS,
  type ClientId,
  type Config,
  type Pack,
  type ProjectEntry,
  type State,
} from './schemas.js'
import type { ApocryphonPaths } from './paths.js'
import { expandHome } from './paths.js'
import { ensureDir } from './store.js'
import { expandActiveSkills } from './packs.js'
import { coveredBy } from './clients.js'
import { updateGitExclude, type GitExcludeResult } from './git-exclude.js'

export interface SyncLink {
  client: ClientId
  scope: 'global' | 'project'
  skill: string
  path: string
}

export interface SyncSkip {
  path: string
  reason: string
}

export interface SyncReport {
  created: SyncLink[]
  unchanged: SyncLink[]
  removed: string[]
  skipped: SyncSkip[]
  warnings: string[]
  active: {
    global: string[]
    project: string[]
    unknownPacks: string[]
    missingSkills: string[]
  }
  exclude: GitExcludeResult | null
  dryRun: boolean
}

export interface SyncOptions {
  paths: ApocryphonPaths
  config: Config
  state: State
  projectRoot?: string | null
  entry?: ProjectEntry | null
  registryPacks?: Record<string, Pack> | null
  homeDir?: string
  dryRun?: boolean
}

async function lstatOrNull(target: string): Promise<import('node:fs').Stats | null> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target)
  } catch {
    return null
  }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) =>
    process.platform === 'win32' ? value.toLowerCase() : value
  return normalize(path.resolve(a)) === normalize(path.resolve(b))
}

async function createSkillSymlink(target: string, linkPath: string): Promise<void> {
  if (process.platform === 'win32') {
    await fs.symlink(target, linkPath, 'junction')
  } else {
    await fs.symlink(target, linkPath, 'dir')
  }
}

async function readDirSafe(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

interface DirSyncContext {
  scope: 'global' | 'project'
  client: ClientId
  report: SyncReport
  vaultDir: string
  dryRun: boolean
}

/**
 * Reconcile the managed symlinks of a single target directory.
 *
 * Only symlinks that resolve inside the Apocryphon vault are ever removed.
 * Real files or directories are never destroyed: they are reported as skipped.
 */
async function syncManagedDir(
  dir: string,
  desiredSkills: Iterable<string>,
  ctx: DirSyncContext,
): Promise<string[]> {
  const desired = new Set(desiredSkills)
  await ensureDir(dir)

  const managedLinks: string[] = []

  // 1. Prune symlinks that point into the vault but are no longer desired.
  for (const dirent of await readDirSafe(dir)) {
    if (!dirent.isSymbolicLink()) continue
    const full = path.join(dir, dirent.name)
    const resolved = await realpathOrNull(full)
    if (!resolved || !isInside(resolved, ctx.vaultDir)) continue

    if (!desired.has(dirent.name)) {
      if (!ctx.dryRun) await fs.unlink(full)
      ctx.report.removed.push(full)
      continue
    }

    managedLinks.push(full)
  }

  // 2. Create or repair the desired symlinks.
  for (const skill of desired) {
    const linkPath = path.join(dir, skill)
    const target = path.join(ctx.vaultDir, skill)
    const existing = await lstatOrNull(linkPath)
    const link: SyncLink = {
      client: ctx.client,
      scope: ctx.scope,
      skill,
      path: linkPath,
    }

    if (!existing) {
      if (!ctx.dryRun) await createSkillSymlink(target, linkPath)
      ctx.report.created.push(link)
      managedLinks.push(linkPath)
      continue
    }

    if (existing.isSymbolicLink()) {
      const resolved = await realpathOrNull(linkPath)
      if (resolved && samePath(resolved, target)) {
        ctx.report.unchanged.push(link)
        managedLinks.push(linkPath)
        continue
      }

      const rawTarget = await fs.readlink(linkPath).catch(() => null)
      const absoluteRawTarget = rawTarget
        ? path.resolve(path.dirname(linkPath), rawTarget)
        : null
      const managed =
        absoluteRawTarget !== null &&
        (isInside(absoluteRawTarget, ctx.vaultDir) ||
          isInside((await realpathOrNull(absoluteRawTarget)) ?? '', ctx.vaultDir))

      if (!managed) {
        ctx.report.skipped.push({
          path: linkPath,
          reason: 'Existing symlink is not managed by Apocryphon (left untouched).',
        })
        continue
      }

      if (!ctx.dryRun) {
        await fs.unlink(linkPath)
        await createSkillSymlink(target, linkPath)
      }
      ctx.report.created.push(link)
      managedLinks.push(linkPath)
      continue
    }

    ctx.report.skipped.push({
      path: linkPath,
      reason: 'A real file or directory already exists at this path (left untouched).',
    })
  }

  return managedLinks
}

async function pruneManagedDir(dir: string, ctx: DirSyncContext): Promise<void> {
  for (const dirent of await readDirSafe(dir)) {
    if (!dirent.isSymbolicLink()) continue
    const full = path.join(dir, dirent.name)
    const resolved = await realpathOrNull(full)
    if (!resolved || !isInside(resolved, ctx.vaultDir)) continue
    if (!ctx.dryRun) await fs.unlink(full)
    ctx.report.removed.push(full)
  }
}

async function listManagedLinks(dir: string, vaultDir: string): Promise<string[]> {
  const links: string[] = []
  for (const dirent of await readDirSafe(dir)) {
    if (!dirent.isSymbolicLink()) continue
    const full = path.join(dir, dirent.name)
    const resolved = await realpathOrNull(full)
    if (resolved && isInside(resolved, vaultDir)) links.push(full)
  }
  return links
}

/**
 * Make the client directories match the desired skill state.
 *
 * Global skills go to `<client>/{globalDir}`, project skills go to
 * `<project>/{client projectDir}`. Project links are registered in
 * `<repo>/.git/info/exclude` so `git status` stays clean.
 */
export async function syncSkills(options: SyncOptions): Promise<SyncReport> {
  const {
    paths,
    config,
    state,
    projectRoot = null,
    entry = null,
    registryPacks = null,
    homeDir = os.homedir(),
    dryRun = false,
  } = options

  const report: SyncReport = {
    created: [],
    unchanged: [],
    removed: [],
    skipped: [],
    warnings: [],
    active: { global: [], project: [], unknownPacks: [], missingSkills: [] },
    exclude: null,
    dryRun,
  }

  const active = expandActiveSkills(state, entry, registryPacks)
  report.active.global = active.global
  report.active.project = active.project
  report.active.unknownPacks = active.unknownPacks

  for (const packName of active.unknownPacks) {
    report.warnings.push(`Pack "${packName}" is active but its definition is unknown.`)
  }

  // Only installable skills (present in the vault) become symlinks.
  const installed = new Set<string>()
  for (const dirent of await readDirSafe(paths.vault)) {
    if (dirent.isDirectory() || dirent.isSymbolicLink()) installed.add(dirent.name)
  }

  const globalSkills: string[] = []
  for (const skill of active.global) {
    if (installed.has(skill)) globalSkills.push(skill)
    else report.active.missingSkills.push(skill)
  }

  const projectSkills: string[] = []
  for (const skill of active.project) {
    if (installed.has(skill)) projectSkills.push(skill)
    else report.active.missingSkills.push(skill)
  }

  if (report.active.missingSkills.length > 0) {
    report.warnings.push(
      `Active skills not installed in the vault: ${[...new Set(report.active.missingSkills)].join(', ')}. Run \`apocryphon install <id>\`.`,
    )
  }

  const projectLinkPaths: string[] = []

  for (const client of CLIENT_IDS) {
    const settings = config.clients[client]
    const covered = settings.enabled ? coveredBy(client, config.clients, config.dedupe) : null
    const ctx: DirSyncContext = {
      scope: 'global',
      client,
      report,
      vaultDir: paths.vault,
      dryRun,
    }

    // Global scope
    const globalDir = path.resolve(expandHome(settings.globalDir, homeDir))
    if (settings.enabled && !covered) {
      await syncManagedDir(globalDir, globalSkills, ctx)
    } else {
      await pruneManagedDir(globalDir, ctx)
    }

    // Project scope
    if (projectRoot) {
      const projectCtx: DirSyncContext = { ...ctx, scope: 'project' }
      const projectDir = path.isAbsolute(settings.projectDir)
        ? settings.projectDir
        : path.join(projectRoot, settings.projectDir)

      if (settings.enabled && !covered) {
        projectLinkPaths.push(...(await syncManagedDir(projectDir, projectSkills, projectCtx)))
      } else {
        await pruneManagedDir(projectDir, projectCtx)
      }
    }
  }

  // Keep the git exclude block in sync with the links that actually exist.
  if (projectRoot) {
    const existingLinks: string[] = []
    for (const client of CLIENT_IDS) {
      const settings = config.clients[client]
      const projectDir = path.isAbsolute(settings.projectDir)
        ? settings.projectDir
        : path.join(projectRoot, settings.projectDir)
      existingLinks.push(...(await listManagedLinks(projectDir, paths.vault)))
    }
    report.exclude = await updateGitExclude(projectRoot, existingLinks)
    if (report.exclude?.skipped.length) {
      report.warnings.push(
        `Could not add ${report.exclude.skipped.length} path(s) to .git/info/exclude (outside the repository).`,
      )
    }
  }

  return report
}
