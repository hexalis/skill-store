import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { InstalledSkill, SkillSource, State } from './schemas.js'
import type { ApocryphonPaths } from './paths.js'
import {
  buildManifest,
  copyDirAtomic,
  copySkillDir,
  manifestContentHash,
  type FileManifest,
} from './skill-files.js'
import {
  diffManifests,
  overlaps,
  sameManifest,
  type DiffResult,
} from './skill-diff.js'
import { mergeSkillDirs, type FileChoices } from './skill-merge.js'
import { nowIso, pathExists } from './store.js'

export type UpdateResolution = 'overwrite' | 'keep' | 'merge'

export interface SkillUpdatePlan {
  id: string
  installedVersion?: string
  registryVersion?: string
  customized: boolean
  updateAvailable: boolean
  conflicted: boolean
  baseline: 'known' | 'unknown'
  local: DiffResult | null
  upstream: DiffResult | null
  overlap: string[]
  suggestedAction: 'none' | 'fast-forward' | 'decide'
  sourceDir: string
}

export interface PlanOptions {
  paths: ApocryphonPaths
  id: string
  sourceDir: string
  installed?: InstalledSkill
  registryVersion?: string
}

async function readManifest(dir: string): Promise<FileManifest> {
  return buildManifest(dir)
}

/**
 * Ensure `~/.apocryphon/pristine/<id>` exists.
 *
 * For legacy installs without a pristine copy, the current vault is adopted as
 * the baseline only when it is still unmodified; otherwise we cannot know what
 * the user changed and the baseline stays unknown.
 */
export async function ensurePristine(
  paths: ApocryphonPaths,
  id: string,
): Promise<'exists' | 'created' | 'missing'> {
  const pristineDir = path.join(paths.pristine, id)
  if (await pathExists(pristineDir)) return 'exists'

  const vaultDir = path.join(paths.vault, id)
  if (!(await pathExists(vaultDir))) return 'missing'

  await copyDirAtomic(vaultDir, pristineDir)
  return 'created'
}

export async function refreshPristine(
  paths: ApocryphonPaths,
  id: string,
  sourceDir: string,
): Promise<void> {
  await copyDirAtomic(sourceDir, path.join(paths.pristine, id))
}

export async function planSkillUpdate(options: PlanOptions): Promise<SkillUpdatePlan> {
  const { paths, id, sourceDir, installed, registryVersion } = options
  const vaultDir = path.join(paths.vault, id)
  const pristineDir = path.join(paths.pristine, id)

  if (!(await pathExists(vaultDir))) {
    throw new Error(`Skill "${id}" is not installed in the vault.`)
  }

  const sourceManifest = await readManifest(sourceDir)
  const sourceContentHash = manifestContentHash(sourceManifest)
  const baselineExists = await pathExists(pristineDir)

  let local: DiffResult | null = null
  let upstream: DiffResult | null = null
  let baseline: 'known' | 'unknown' = 'unknown'

  if (baselineExists) {
    baseline = 'known'
    const [baseManifest, vaultManifest] = await Promise.all([
      readManifest(pristineDir),
      readManifest(vaultDir),
    ])
    local = diffManifests(baseManifest, vaultManifest)
    upstream = diffManifests(baseManifest, sourceManifest)
  }

  // Without a pristine baseline we cannot know what the user changed, so we
  // conservatively treat the skill as customized and require a decision.
  const customized = baseline === 'unknown' ? true : (local?.hasChanges ?? false)

  const updateAvailable =
    baseline === 'unknown'
      ? true
      : (upstream?.hasChanges ?? false) ||
        (registryVersion !== undefined && installed?.version !== registryVersion) ||
        installed?.contentHash !== sourceContentHash

  const conflicted = customized && updateAvailable
  const suggestedAction: SkillUpdatePlan['suggestedAction'] = !updateAvailable
    ? 'none'
    : !customized
      ? 'fast-forward'
      : 'decide'

  return {
    id,
    installedVersion: installed?.version,
    registryVersion,
    customized,
    updateAvailable,
    conflicted,
    baseline,
    local,
    upstream,
    overlap: local && upstream ? overlaps(local, upstream) : [],
    suggestedAction,
    sourceDir,
  }
}

export interface BackupInfo {
  timestamp: string
  dir: string
}

export async function backupSkill(
  paths: ApocryphonPaths,
  id: string,
  keep = 5,
): Promise<BackupInfo | null> {
  const vaultDir = path.join(paths.vault, id)
  if (!(await pathExists(vaultDir))) return null

  const stamp = nowIso().replace(/[:.]/g, '-')
  const dir = path.join(paths.backups, id, stamp)
  await copySkillDir(vaultDir, dir)

  const entries = (await fs.readdir(path.join(paths.backups, id))).sort()
  const stale = entries.slice(0, Math.max(0, entries.length - keep))
  for (const entry of stale) {
    await fs.rm(path.join(paths.backups, id, entry), { recursive: true, force: true })
  }

  return { timestamp: stamp, dir }
}

export async function listBackups(paths: ApocryphonPaths, id: string): Promise<BackupInfo[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(path.join(paths.backups, id))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries
    .sort()
    .reverse()
    .map((timestamp) => ({
      timestamp,
      dir: path.join(paths.backups, id, timestamp),
    }))
}

export async function restoreBackup(
  paths: ApocryphonPaths,
  id: string,
  timestamp?: string,
): Promise<string> {
  const backups = await listBackups(paths, id)
  const chosen = timestamp ? backups.find((item) => item.timestamp === timestamp) : backups[0]
  if (!chosen) {
    throw new Error(
      timestamp
        ? `Backup "${timestamp}" not found for skill "${id}".`
        : `No backups available for skill "${id}".`,
    )
  }
  await copyDirAtomic(chosen.dir, path.join(paths.vault, id))
  return chosen.timestamp
}

/** Restore the pristine (registry) copy, discarding local edits. */
export async function restorePristine(paths: ApocryphonPaths, id: string): Promise<void> {
  const pristineDir = path.join(paths.pristine, id)
  if (!(await pathExists(pristineDir))) {
    throw new Error(`No pristine baseline for skill "${id}".`)
  }
  await copyDirAtomic(pristineDir, path.join(paths.vault, id))
}

export interface ApplyUpdateOptions {
  paths: ApocryphonPaths
  id: string
  sourceDir: string
  plan: SkillUpdatePlan
  resolution: UpdateResolution
  state: State
  version?: string
  source?: SkillSource | null
  fileChoices?: FileChoices
}

export interface ApplyUpdateResult {
  resolution: UpdateResolution
  backup: BackupInfo | null
  customized: boolean
  conflicts: string[]
  merged: string[]
  deleted: string[]
}

function manifestToStateFields(manifest: FileManifest): {
  contentHash: string
  fileHashes: Record<string, string>
  fileModes: Record<string, string>
  scriptChecksums: Record<string, string>
} {
  const fileHashes: Record<string, string> = {}
  const fileModes: Record<string, string> = {}
  const scriptChecksums: Record<string, string> = {}
  for (const [rel, entry] of Object.entries(manifest)) {
    fileHashes[rel] = entry.hash
    fileModes[rel] = entry.mode
    if (rel.startsWith('scripts/')) scriptChecksums[rel] = entry.hash
  }
  return {
    contentHash: manifestContentHash(manifest),
    fileHashes,
    fileModes,
    scriptChecksums,
  }
}

export function recordSkillState(
  state: State,
  id: string,
  manifest: FileManifest,
  options: {
    version?: string
    source?: SkillSource | null
    customized: boolean
    lastMergedAt?: string | null
    installedAt?: string
  },
): void {
  const previous = state.skills[id]
  const fields = manifestToStateFields(manifest)
  state.skills[id] = {
    version: options.version ?? previous?.version,
    installedAt: options.installedAt ?? previous?.installedAt ?? nowIso(),
    updatedAt: previous ? nowIso() : undefined,
    source: options.source ?? previous?.source ?? null,
    scriptChecksums: fields.scriptChecksums,
    contentHash: fields.contentHash,
    fileHashes: fields.fileHashes,
    fileModes: fields.fileModes,
    customized: options.customized,
    baseline: 'known',
    lastMergedAt: options.lastMergedAt ?? previous?.lastMergedAt ?? null,
  }
}

/**
 * Apply an update using the chosen resolution.
 *
 * - `overwrite`: registry wins; the vault is replaced.
 * - `keep`: nothing changes (the update is skipped).
 * - `merge`: three-way merge; conflicts are written with markers and reported.
 *
 * A backup is taken whenever the skill was customized or its baseline was
 * unknown.
 */
export async function applySkillUpdate(
  options: ApplyUpdateOptions,
): Promise<ApplyUpdateResult> {
  const { paths, id, sourceDir, plan, resolution, state, version, source, fileChoices } = options

  if (resolution === 'keep') {
    return {
      resolution,
      backup: null,
      customized: plan.customized,
      conflicts: [],
      merged: [],
      deleted: [],
    }
  }

  const vaultDir = path.join(paths.vault, id)
  const backup =
    plan.customized || plan.baseline === 'unknown'
      ? await backupSkill(paths, id)
      : null

  let conflicts: string[] = []
  let merged: string[] = []
  let deleted: string[] = []

  if (resolution === 'overwrite') {
    await copyDirAtomic(sourceDir, vaultDir)
    await refreshPristine(paths, id, sourceDir)
  } else {
    if (plan.baseline === 'unknown') {
      throw new Error(
        `Skill "${id}" has no pristine baseline; run \`apocryphon adopt ${id}\` first, or use --force/--keep.`,
      )
    }

    const mergeDir = await fs.mkdtemp(path.join(os.tmpdir(), `apocryphon-merge-${id}-`))
    try {
      const result = await mergeSkillDirs({
        pristineDir: path.join(paths.pristine, id),
        oursDir: vaultDir,
        theirsDir: sourceDir,
        outDir: path.join(mergeDir, 'out'),
        fileChoices,
      })
      await copyDirAtomic(path.join(mergeDir, 'out'), vaultDir)
      await refreshPristine(paths, id, sourceDir)
      conflicts = result.conflicts
      merged = result.merged
      deleted = result.deleted
    } finally {
      await fs.rm(mergeDir, { recursive: true, force: true })
    }
  }

  const [vaultManifest, pristineManifest] = await Promise.all([
    readManifest(vaultDir),
    readManifest(path.join(paths.pristine, id)),
  ])
  const customized = !sameManifest(vaultManifest, pristineManifest)

  recordSkillState(state, id, vaultManifest, {
    version,
    source,
    customized,
    lastMergedAt: resolution === 'merge' ? nowIso() : null,
  })

  return { resolution, backup, customized, conflicts, merged, deleted }
}

/**
 * Adopt the current vault content as the new pristine baseline.
 * Used for legacy installs whose baseline cannot be reconstructed.
 */
export async function adoptBaseline(
  paths: ApocryphonPaths,
  id: string,
  state: State,
): Promise<void> {
  const vaultDir = path.join(paths.vault, id)
  const manifest = await buildManifest(vaultDir)
  await copyDirAtomic(vaultDir, path.join(paths.pristine, id))
  recordSkillState(state, id, manifest, {
    customized: false,
    source: state.skills[id]?.source ?? null,
  })
}
