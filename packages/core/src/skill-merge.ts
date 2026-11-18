import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  buildManifest,
  entriesEqual,
  isProbablyText,
  listSkillFiles,
  writeFileWithMode,
  type FileEntry,
  type FileManifest,
} from './skill-files.js'

export type FileResolution = 'ours' | 'theirs' | 'merge'
export type FileChoices = Record<string, FileResolution>

export interface MergeOptions {
  pristineDir: string
  oursDir: string
  theirsDir: string
  outDir: string
  fileChoices?: FileChoices
}

export interface MergeResult {
  conflicts: string[]
  merged: string[]
  takenOurs: string[]
  takenTheirs: string[]
  deleted: string[]
}

function pickMode(
  base: FileEntry | undefined,
  ours: FileEntry | undefined,
  theirs: FileEntry | undefined,
  strategy: FileResolution,
): string {
  if (strategy === 'theirs' && theirs) return theirs.mode
  if (strategy === 'ours' && ours) return ours.mode
  if (ours && theirs) {
    if (base && ours.mode === base.mode && theirs.mode !== base.mode) return theirs.mode
    return ours.mode
  }
  return (ours ?? theirs)?.mode ?? '644'
}

async function copyChosen(
  sourceDir: string,
  outDir: string,
  rel: string,
  mode: string,
): Promise<void> {
  const content = await fs.readFile(path.join(sourceDir, rel))
  await writeFileWithMode(path.join(outDir, rel), content, mode)
}

async function writeTemp(content: Buffer, dir: string, name: string): Promise<string> {
  const file = path.join(dir, name)
  await fs.writeFile(file, content)
  return file
}

function mergeFile(oursFile: string, baseFile: string, theirsFile: string): {
  content: Buffer
  conflicted: boolean
} {
  const result = spawnSync(
    'git',
    ['merge-file', '-p', '--diff3', oursFile, baseFile, theirsFile],
    { encoding: 'buffer', stdio: 'pipe' },
  )

  if (result.error) {
    throw new Error(`git merge-file failed: ${result.error.message}`)
  }
  if (result.status === null) {
    throw new Error('git merge-file did not run')
  }
  if (result.status > 1) {
    throw new Error(result.stderr?.toString() || 'git merge-file failed')
  }

  return { content: result.stdout, conflicted: result.status === 1 }
}

/**
 * Three-way merge of a skill directory.
 *
 * `outDir` must be a fresh directory (the caller swaps it into the vault after a
 * successful merge). Files changed only on one side are taken from that side;
 * files changed on both sides are merged with `git merge-file`. Binary files and
 * add/add or delete/modify conflicts are kept from `ours` and reported.
 */
export async function mergeSkillDirs(options: MergeOptions): Promise<MergeResult> {
  const { pristineDir, oursDir, theirsDir, outDir, fileChoices = {} } = options
  await fs.mkdir(outDir, { recursive: true })

  const [base, ours, theirs] = await Promise.all([
    buildManifest(pristineDir),
    buildManifest(oursDir),
    buildManifest(theirsDir),
  ])

  const paths = [...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])].sort(
    (a, b) => a.localeCompare(b),
  )

  const result: MergeResult = {
    conflicts: [],
    merged: [],
    takenOurs: [],
    takenTheirs: [],
    deleted: [],
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apocryphon-merge-file-'))

  try {
    for (const rel of paths) {
      const baseEntry = base[rel]
      const oursEntry = ours[rel]
      const theirsEntry = theirs[rel]
      const choice = fileChoices[rel]

      const oursChanged =
        choice === 'ours' || choice === 'theirs' || !entriesEqual(baseEntry, oursEntry)
      const theirsChanged =
        choice === 'ours' || choice === 'theirs' || !entriesEqual(baseEntry, theirsEntry)

      if (choice === 'theirs' || (!oursChanged && theirsChanged)) {
        if (theirsEntry) {
          await copyChosen(theirsDir, outDir, rel, theirsEntry.mode)
          result.takenTheirs.push(rel)
        } else {
          result.deleted.push(rel)
        }
        continue
      }

      if (choice === 'ours' || (oursChanged && !theirsChanged) || (!oursChanged && !theirsChanged)) {
        if (oursEntry) {
          await copyChosen(oursDir, outDir, rel, oursEntry.mode)
          result.takenOurs.push(rel)
        } else {
          result.deleted.push(rel)
        }
        continue
      }

      // Both sides changed (or an explicit "merge" was requested).
      if (!oursEntry) {
        // Deleted locally, changed upstream: keep the deletion and report it.
        result.deleted.push(rel)
        result.conflicts.push(rel)
        continue
      }

      if (!theirsEntry) {
        // Changed locally, deleted upstream: keep ours and report it.
        await copyChosen(oursDir, outDir, rel, oursEntry.mode)
        result.takenOurs.push(rel)
        result.conflicts.push(rel)
        continue
      }

      const [oursContent, theirsContent] = await Promise.all([
        fs.readFile(path.join(oursDir, rel)),
        fs.readFile(path.join(theirsDir, rel)),
      ])

      if (!baseEntry || !isProbablyText(oursContent) || !isProbablyText(theirsContent)) {
        await copyChosen(oursDir, outDir, rel, oursEntry.mode)
        result.takenOurs.push(rel)
        result.conflicts.push(rel)
        continue
      }

      const baseContent = await fs.readFile(path.join(pristineDir, rel))
      if (!isProbablyText(baseContent)) {
        await copyChosen(oursDir, outDir, rel, oursEntry.mode)
        result.takenOurs.push(rel)
        result.conflicts.push(rel)
        continue
      }

      const oursFile = await writeTemp(oursContent, tempDir, 'ours')
      const baseFile = await writeTemp(baseContent, tempDir, 'base')
      const theirsFile = await writeTemp(theirsContent, tempDir, 'theirs')

      const merged = mergeFile(oursFile, baseFile, theirsFile)
      const mode = pickMode(baseEntry, oursEntry, theirsEntry, 'merge')
      await writeFileWithMode(path.join(outDir, rel), merged.content, mode)
      result.merged.push(rel)
      if (merged.conflicted) result.conflicts.push(rel)
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }

  result.conflicts.sort((a, b) => a.localeCompare(b))
  return result
}

/** Convenience helper used by tests and the CLI to inspect a skill tree. */
export async function listFiles(dir: string): Promise<string[]> {
  return listSkillFiles(dir)
}

export type { FileManifest }
