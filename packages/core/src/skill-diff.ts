import type { FileEntry, FileManifest } from './skill-files.js'
import { entriesEqual } from './skill-files.js'

export type FileChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'mode-changed'
  | 'unchanged'

export interface FileChange {
  path: string
  status: FileChangeStatus
  base?: FileEntry
  current?: FileEntry
}

export interface DiffResult {
  changes: FileChange[]
  added: string[]
  modified: string[]
  deleted: string[]
  modeChanged: string[]
  changedPaths: Set<string>
  hasChanges: boolean
}

/**
 * Compare `current` against `base` and describe what changed.
 *
 * `diffManifests(pristine, vault)` answers "what did the user change?";
 * `diffManifests(pristine, registry)` answers "what changed upstream?".
 */
export function diffManifests(base: FileManifest, current: FileManifest): DiffResult {
  const paths = [...new Set([...Object.keys(base), ...Object.keys(current)])].sort((a, b) =>
    a.localeCompare(b),
  )

  const result: DiffResult = {
    changes: [],
    added: [],
    modified: [],
    deleted: [],
    modeChanged: [],
    changedPaths: new Set(),
    hasChanges: false,
  }

  for (const rel of paths) {
    const from = base[rel]
    const to = current[rel]

    let status: FileChangeStatus
    if (!from) status = 'added'
    else if (!to) status = 'deleted'
    else if (from.hash !== to.hash) status = 'modified'
    else if (from.mode !== to.mode) status = 'mode-changed'
    else status = 'unchanged'

    result.changes.push({ path: rel, status, base: from, current: to })

    if (status === 'added') result.added.push(rel)
    else if (status === 'deleted') result.deleted.push(rel)
    else if (status === 'modified') result.modified.push(rel)
    else if (status === 'mode-changed') result.modeChanged.push(rel)
    else continue

    result.changedPaths.add(rel)
    result.hasChanges = true
  }

  return result
}

export function overlaps(a: DiffResult, b: DiffResult): string[] {
  const paths: string[] = []
  for (const rel of a.changedPaths) {
    if (b.changedPaths.has(rel)) paths.push(rel)
  }
  return paths.sort((x, y) => x.localeCompare(y))
}

export function sameManifest(a: FileManifest, b: FileManifest): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (!entriesEqual(a[key], b[key])) return false
  }
  return true
}

export function summarizeDiff(diff: DiffResult): string {
  const parts = [
    diff.modified.length > 0 ? `${diff.modified.length} modified` : '',
    diff.added.length > 0 ? `${diff.added.length} added` : '',
    diff.deleted.length > 0 ? `${diff.deleted.length} deleted` : '',
    diff.modeChanged.length > 0 ? `${diff.modeChanged.length} mode` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'no changes'
}
