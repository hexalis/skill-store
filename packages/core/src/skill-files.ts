import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const JUNK_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  '.DS_Store',
  '.turbo',
  '.next',
  '.cache',
])

export interface FileEntry {
  hash: string
  /** Permission bits as an octal string, for example "755" or "644". */
  mode: string
  size: number
}

export type FileManifest = Record<string, FileEntry>

export function sha256(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function modeOf(stat: import('node:fs').Stats): string {
  return (stat.mode & 0o777).toString(8).padStart(3, '0')
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    if (JUNK_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    const rel = path.relative(base, full).split(path.sep).join('/')
    if (entry.isDirectory()) {
      await walk(full, base, out)
    } else if (entry.isFile()) {
      out.push(rel)
    }
    // Symlinks are intentionally ignored: Apocryphon only fingerprints regular
    // files it can audit and copy.
  }
}

export async function listSkillFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  await walk(dir, dir, files)
  return files.sort((a, b) => a.localeCompare(b))
}

export async function buildManifest(dir: string): Promise<FileManifest> {
  const manifest: FileManifest = {}
  for (const rel of await listSkillFiles(dir)) {
    const full = path.join(dir, rel)
    const [content, stat] = await Promise.all([fs.readFile(full), fs.stat(full)])
    manifest[rel] = {
      hash: sha256(content),
      mode: modeOf(stat),
      size: stat.size,
    }
  }
  return manifest
}

export function manifestContentHash(manifest: FileManifest): string {
  const lines = Object.keys(manifest)
    .sort((a, b) => a.localeCompare(b))
    .map((rel) => {
      const entry = manifest[rel]
      return `${rel}:${entry?.mode ?? ''}:${entry?.hash ?? ''}`
    })
  return sha256(lines.join('\n'))
}

export function entriesEqual(a: FileEntry | undefined, b: FileEntry | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.hash === b.hash && a.mode === b.mode
}

async function copyEntry(source: string, destination: string): Promise<void> {
  const stat = await fs.stat(source)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.copyFile(source, destination)
  await fs.chmod(destination, stat.mode & 0o777)
}

export async function copySkillDir(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true })
  for (const rel of await listSkillFiles(source)) {
    await copyEntry(path.join(source, rel), path.join(destination, rel))
  }
}

/**
 * Replace `destination` with a copy of `source` atomically: the copy is built in
 * a sibling temp directory and swapped in with `rename`.
 */
export async function copyDirAtomic(source: string, destination: string): Promise<void> {
  const parent = path.dirname(destination)
  await fs.mkdir(parent, { recursive: true })
  const temp = path.join(parent, `.${path.basename(destination)}.tmp-${process.pid}-${Date.now()}`)
  await fs.rm(temp, { recursive: true, force: true })
  await copySkillDir(source, temp)
  await fs.rm(destination, { recursive: true, force: true })
  await fs.rename(temp, destination)
}

export async function writeFileWithMode(
  destination: string,
  content: Buffer | string,
  mode: string,
): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, content)
  await fs.chmod(destination, Number.parseInt(mode, 8))
}

export function isProbablyText(content: Buffer): boolean {
  return !content.subarray(0, 8000).includes(0)
}
