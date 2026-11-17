import { promises as fs } from 'node:fs'
import path from 'node:path'
import { lintSkillDir, type SkillLintResult } from './skill-linter.js'

async function readDirSafe(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * List and lint every skill installed in the vault. Symlinked entries are
 * ignored: the vault is the source of truth and must contain real directories.
 */
export async function listVaultSkills(vaultDir: string): Promise<SkillLintResult[]> {
  const results: SkillLintResult[] = []
  for (const dirent of await readDirSafe(vaultDir)) {
    if (!dirent.isDirectory()) continue
    results.push(await lintSkillDir(path.join(vaultDir, dirent.name)))
  }
  return results.sort((a, b) => a.id.localeCompare(b.id))
}

export async function listVaultSkillIds(vaultDir: string): Promise<string[]> {
  return (await listVaultSkills(vaultDir)).map((skill) => skill.id)
}

export async function vaultSkillExists(vaultDir: string, id: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(vaultDir, id, 'SKILL.md'))
    return stat.isFile()
  } catch {
    return false
  }
}
