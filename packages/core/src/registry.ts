import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  RegistryIndexSchema,
  type InstalledSkill,
  type RegistryIndex,
  type RegistrySkillEntry,
  type State,
} from './schemas.js'
import type { ApocryphonPaths } from './paths.js'
import { expandHome } from './paths.js'
import { ensureDir, formatZodError, nowIso, pathExists, readRawJson } from './store.js'
import { lintSkillDir, type SkillLintResult } from './skill-linter.js'
import { JUNK_NAMES } from './skill-linter.js'

export const REGISTRY_FILE = 'registry.json'

export interface RegistryLocation {
  kind: 'git' | 'local'
  dir: string
  source: string
}

export function isGitSource(source: string): boolean {
  if (/^git@/.test(source)) return true
  if (/^(ssh|git|https?):\/\//.test(source)) return true
  if (source.endsWith('.git')) return true
  return false
}

export function resolveRegistryLocation(
  source: string,
  paths: ApocryphonPaths,
  homeDir: string = os.homedir(),
): RegistryLocation {
  if (isGitSource(source)) {
    return { kind: 'git', dir: paths.registry, source }
  }
  return {
    kind: 'local',
    dir: path.resolve(expandHome(source, homeDir)),
    source,
  }
}

function runGit(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? result.error?.message ?? '',
  }
}

export interface EnsureRegistryOptions {
  pull?: boolean
}

/**
 * Make the registry available locally.
 *
 * - Git sources are cloned (shallow) into `~/.apocryphon/registry` and updated
 *   with `git pull --ff-only`.
 * - Local paths are used in place, which makes development and testing easy.
 */
export async function ensureRegistry(
  location: RegistryLocation,
  options: EnsureRegistryOptions = {},
): Promise<{ pulled: boolean; cloned: boolean }> {
  if (location.kind === 'local') {
    const indexFile = path.join(location.dir, REGISTRY_FILE)
    if (!(await pathExists(indexFile))) {
      throw new Error(`Local registry not found or missing ${REGISTRY_FILE}: ${location.dir}`)
    }
    return { pulled: false, cloned: false }
  }

  const isRepo = await pathExists(path.join(location.dir, '.git'))
  if (!isRepo) {
    await ensureDir(path.dirname(location.dir))
    const clone = runGit(
      ['clone', '--depth', '1', location.source, location.dir],
      path.dirname(location.dir),
    )
    if (!clone.ok) {
      throw new Error(`Could not clone registry "${location.source}":\n${clone.stderr}`)
    }
    return { pulled: true, cloned: true }
  }

  if (options.pull) {
    const pull = runGit(['pull', '--ff-only'], location.dir)
    if (!pull.ok) {
      throw new Error(`Could not update registry "${location.source}":\n${pull.stderr}`)
    }
    return { pulled: true, cloned: false }
  }

  return { pulled: false, cloned: false }
}

export async function readRegistryIndex(location: RegistryLocation): Promise<RegistryIndex> {
  const indexFile = path.join(location.dir, REGISTRY_FILE)
  if (!(await pathExists(indexFile))) {
    throw new Error(`Registry index not found: ${indexFile}`)
  }
  const raw = await readRawJson(indexFile)
  const parsed = RegistryIndexSchema.safeParse(raw)
  if (!parsed.success) throw new Error(formatZodError(parsed.error, indexFile))
  return parsed.data
}

export function findRegistrySkill(
  index: RegistryIndex,
  id: string,
): RegistrySkillEntry | undefined {
  return index.skills.find((skill) => skill.id === id)
}

function copyFilter(source: string): boolean {
  const name = path.basename(source)
  return !JUNK_NAMES.has(name)
}

async function copyDir(source: string, destination: string): Promise<void> {
  await fs.cp(source, destination, {
    recursive: true,
    filter: (src) => copyFilter(src),
    dereference: false,
  })
}

export interface InstallOptions {
  location: RegistryLocation
  entry: RegistrySkillEntry
  paths: ApocryphonPaths
  state: State
  force?: boolean
}

export interface InstallResult {
  id: string
  dir: string
  lint: SkillLintResult
  updated: boolean
}

/**
 * Copy a skill from the registry into the vault, validate it, and record its
 * version plus script checksums in `state.json`.
 */
export async function installSkillFromRegistry(
  options: InstallOptions,
): Promise<InstallResult> {
  const { location, entry, paths, state, force = false } = options

  const sourceDir = path.resolve(location.dir, entry.path)
  const relative = path.relative(location.dir, sourceDir)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Skill "${entry.id}" points outside the registry: ${entry.path}`)
  }

  const sourceLint = await lintSkillDir(sourceDir)
  if (!sourceLint.ok && !force) {
    throw new Error(
      `Skill "${entry.id}" failed validation in the registry. Fix it there, or use --force to install anyway.`,
    )
  }

  const destination = path.join(paths.vault, entry.id)
  const temp = `${destination}.tmp-${process.pid}-${Date.now()}`
  await ensureDir(paths.vault)
  await fs.rm(temp, { recursive: true, force: true })
  await copyDir(sourceDir, temp)
  await fs.rm(destination, { recursive: true, force: true })
  await fs.rename(temp, destination)

  const lint = await lintSkillDir(destination)
  const previous: InstalledSkill | undefined = state.skills[entry.id]
  state.skills[entry.id] = {
    version: entry.version ?? lint.frontmatter?.version,
    installedAt: previous?.installedAt ?? nowIso(),
    updatedAt: previous ? nowIso() : undefined,
    source: location.source,
    scriptChecksums: lint.scriptChecksums,
  }

  return { id: entry.id, dir: destination, lint, updated: previous !== undefined }
}

export interface UpdateInstalledResult {
  updated: string[]
  unchanged: string[]
  removedFromRegistry: string[]
  failed: Array<{ id: string; error: string }>
}

/**
 * Refresh every installed skill that still exists in the registry.
 * Missing registry entries are reported, never deleted automatically.
 */
export async function updateInstalledSkills(options: {
  location: RegistryLocation
  index: RegistryIndex
  paths: ApocryphonPaths
  state: State
}): Promise<UpdateInstalledResult> {
  const result: UpdateInstalledResult = {
    updated: [],
    unchanged: [],
    removedFromRegistry: [],
    failed: [],
  }

  for (const id of Object.keys(options.state.skills)) {
    const entry = findRegistrySkill(options.index, id)
    if (!entry) {
      result.removedFromRegistry.push(id)
      continue
    }
    try {
      const install = await installSkillFromRegistry({
        location: options.location,
        entry,
        paths: options.paths,
        state: options.state,
        force: true,
      })
      result.updated.push(id)
      if (!install.lint.ok) {
        result.failed.push({
          id,
          error: 'Updated skill now has lint errors; run `apocryphon validate` for details.',
        })
      }
    } catch (error) {
      result.failed.push({ id, error: (error as Error).message })
    }
  }

  return result
}

export function searchRegistry(
  index: RegistryIndex,
  query: string,
): RegistrySkillEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...index.skills]

  return index.skills.filter((skill) => {
    const haystack = [
      skill.id,
      skill.description ?? '',
      skill.category ?? '',
      ...(skill.tags ?? []),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
}
