import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  RegistryIndexSchema,
  type RegistryIndex,
  type RegistrySkillEntry,
  type State,
} from './schemas.js'
import type { ApocryphonPaths } from './paths.js'
import { expandHome } from './paths.js'
import { ensureDir, formatZodError, nowIso, pathExists, readRawJson } from './store.js'
import { lintSkillDir, type SkillLintResult } from './skill-linter.js'
import { buildManifest, copyDirAtomic, JUNK_NAMES, manifestContentHash } from './skill-files.js'
import { planSkillUpdate, recordSkillState, refreshPristine, type SkillUpdatePlan } from './skill-updates.js'
import { withReporter, type ProgressReporter } from './progress.js'

export const REGISTRY_FILE = 'registry.json'

export interface RegistryLocation {
  kind: 'git' | 'local'
  dir: string
  source: string
}

export function isGitSource(source: string): boolean {
  if (/^git@/.test(source)) return true
  if (/^(ssh|git|https?):\/\//.test(source)) return true
  return source.endsWith('.git')
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
  reporter?: ProgressReporter
}

/**
 * Make the registry available locally.
 *
 * - Git sources are cloned (shallow) into `~/.apocryphon/registry` and updated
 *   with `git pull --ff-only`.
 * - Local paths are used in place, which keeps development and tests simple.
 */
export async function ensureRegistry(
  location: RegistryLocation,
  options: EnsureRegistryOptions = {},
): Promise<{ pulled: boolean; cloned: boolean }> {
  const reporter = withReporter(options.reporter)

  if (location.kind === 'local') {
    const indexFile = path.join(location.dir, REGISTRY_FILE)
    if (!(await pathExists(indexFile))) {
      throw new Error(`Local registry not found or missing ${REGISTRY_FILE}: ${location.dir}`)
    }
    return { pulled: false, cloned: false }
  }

  const isRepo = await pathExists(path.join(location.dir, '.git'))
  if (!isRepo) {
    const step = 'registry-clone'
    reporter.emit({ type: 'start', step, message: `Cloning ${location.source}` })
    await ensureDir(path.dirname(location.dir))
    const clone = runGit(
      ['clone', '--depth', '1', location.source, location.dir],
      path.dirname(location.dir),
    )
    if (!clone.ok) {
      reporter.emit({ type: 'fail', step, message: clone.stderr })
      throw new Error(`Could not clone registry "${location.source}":\n${clone.stderr}`)
    }
    reporter.emit({ type: 'succeed', step, message: 'Registry cloned' })
    return { pulled: true, cloned: true }
  }

  if (options.pull) {
    const step = 'registry-pull'
    reporter.emit({ type: 'start', step, message: `Updating ${location.source}` })
    const pull = runGit(['pull', '--ff-only'], location.dir)
    if (!pull.ok) {
      reporter.emit({ type: 'fail', step, message: pull.stderr })
      throw new Error(`Could not update registry "${location.source}":\n${pull.stderr}`)
    }
    reporter.emit({ type: 'succeed', step, message: 'Registry updated' })
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

export function registrySkillDir(location: RegistryLocation, entry: RegistrySkillEntry): string {
  const dir = path.resolve(location.dir, entry.path)
  const relative = path.relative(location.dir, dir)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Skill "${entry.id}" points outside the registry: ${entry.path}`)
  }
  return dir
}

export interface InstallOptions {
  location: RegistryLocation
  entry: RegistrySkillEntry
  paths: ApocryphonPaths
  state: State
  force?: boolean
  reporter?: ProgressReporter
}

export interface InstallResult {
  id: string
  dir: string
  lint: SkillLintResult
  contentHash: string
}

/**
 * Install a new skill from the registry.
 *
 * Existing installations are never overwritten here: callers must plan an
 * update first (`planSkillUpdate` + `applySkillUpdate`).
 */
export async function installSkillFromRegistry(
  options: InstallOptions,
): Promise<InstallResult> {
  const { location, entry, paths, state, force = false } = options
  const reporter = withReporter(options.reporter)
  const sourceDir = registrySkillDir(location, entry)
  const destination = path.join(paths.vault, entry.id)

  if (await pathExists(destination)) {
    throw new Error(
      `Skill "${entry.id}" is already installed. Use \`apocryphon sync\`, \`apocryphon diff ${entry.id}\` or pass a resolution flag to update it.`,
    )
  }

  reporter.emit({
    type: 'start',
    step: `install-${entry.id}`,
    message: `Installing ${entry.id}`,
  })

  const sourceLint = await lintSkillDir(sourceDir)
  if (!sourceLint.ok && !force) {
    reporter.emit({ type: 'fail', step: `install-${entry.id}`, message: 'Lint errors' })
    throw new Error(
      `Skill "${entry.id}" failed validation in the registry. Fix it there, or use --force to install anyway.`,
    )
  }

  await copyDirAtomic(sourceDir, destination)
  await refreshPristine(paths, entry.id, sourceDir)

  const manifest = await buildManifest(destination)
  recordSkillState(state, entry.id, manifest, {
    version: entry.version ?? sourceLint.frontmatter?.version,
    source: { type: 'registry', ref: location.source },
    customized: false,
    installedAt: nowIso(),
    lastMergedAt: null,
  })

  reporter.emit({ type: 'succeed', step: `install-${entry.id}`, message: `${entry.id} installed` })

  return {
    id: entry.id,
    dir: destination,
    lint: await lintSkillDir(destination),
    contentHash: manifestContentHash(manifest),
  }
}

export interface PrepareUpdatesResult {
  plans: SkillUpdatePlan[]
  removedFromRegistry: string[]
}

/**
 * Compute update plans for every installed skill that exists in the registry.
 * Nothing is written to disk.
 */
export async function prepareInstalledUpdates(options: {
  location: RegistryLocation
  index: RegistryIndex
  paths: ApocryphonPaths
  state: State
  reporter?: ProgressReporter
}): Promise<PrepareUpdatesResult> {
  const { location, index, paths, state } = options
  const reporter = withReporter(options.reporter)
  const plans: SkillUpdatePlan[] = []
  const removedFromRegistry: string[] = []

  const ids = Object.keys(state.skills)
  for (const [position, id] of ids.entries()) {
    const entry = findRegistrySkill(index, id)
    if (!entry) {
      removedFromRegistry.push(id)
      continue
    }

    reporter.emit({
      type: 'update',
      step: 'registry-diff',
      message: `Comparing ${id} (${position + 1}/${ids.length})`,
    })

    const plan = await planSkillUpdate({
      paths,
      id,
      sourceDir: registrySkillDir(location, entry),
      installed: state.skills[id],
      registryVersion: entry.version,
    })
    plans.push(plan)
  }

  reporter.emit({ type: 'succeed', step: 'registry-diff', message: 'Comparison finished' })
  return { plans, removedFromRegistry }
}

function copyFilter(source: string): boolean {
  const name = path.basename(source)
  return !JUNK_NAMES.has(name)
}

/** Kept for API compatibility with older callers. */
export async function copyRegistrySkill(source: string, destination: string): Promise<void> {
  await fs.cp(source, destination, {
    recursive: true,
    filter: (src) => copyFilter(src),
    dereference: false,
  })
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
