import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import {
  SKILL_ID_PATTERN,
  SkillFrontmatterSchema,
  type LintIssue,
  type SkillFrontmatter,
} from './schemas.js'
import { estimateTokens } from './context-budget.js'

const MAX_DESCRIPTION_LENGTH = 1024
const MIN_DESCRIPTION_LENGTH = 20
const MAX_BODY_LINES = 150

/**
 * Cues that a description contains explicit activation triggers. Clients only
 * see `name` + `description`, so a description without triggers is unlikely to
 * be selected at the right moment.
 */
const TRIGGER_PATTERNS: RegExp[] = [
  /\buse (this|it|the skill|when)\b/i,
  /\buse it (when|for|before|after)\b/i,
  /\bwhen (the )?(user|you|working|asked|task|editing|writing)\b/i,
  /\bsiempre que\b/i,
  /\búsala\b/i,
  /\busala\b/i,
  /\bcuando\b/i,
  /\btriggers?\b/i,
  /\bactívala\b/i,
  /\bactivar\b/i,
  /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|rb|php|cs|sql|prisma|yaml|yml|json|tf|vue|svelte|md)\b/i,
]

const NEGATIVE_TRIGGER_PATTERNS: RegExp[] = [
  /\bno la uses\b/i,
  /\bdo not use\b/i,
  /\bdon't use\b/i,
  /\bnot for\b/i,
  /\bno usar\b/i,
  /\bonly when\b/i,
  /\bsolo cuando\b/i,
]

const JUNK_NAMES = new Set(['.git', 'node_modules', 'dist', '.DS_Store', '.turbo', '.next'])

export interface SkillLintOptions {
  /** Maximum recommended body length in lines. Default: 150. */
  maxBodyLines?: number
}

export interface SkillLintResult {
  id: string
  dir: string
  ok: boolean
  frontmatter: SkillFrontmatter | null
  body: string
  bodyLines: number
  descriptionTokens: number
  issues: LintIssue[]
  /** SHA-256 of every file under `scripts/`, keyed by relative posix path. */
  scriptChecksums: Record<string, string>
}

export function hasExplicitTriggers(description: string): boolean {
  return TRIGGER_PATTERNS.some((pattern) => pattern.test(description))
}

export function hasNegativeTriggers(description: string): boolean {
  return NEGATIVE_TRIGGER_PATTERNS.some((pattern) => pattern.test(description))
}

export function formatLintIssues(issues: LintIssue[]): string {
  return issues
    .map((issue) => {
      const tag = issue.level === 'error' ? 'error' : 'warning'
      const file = issue.file ? ` (${issue.file})` : ''
      return `  ${tag} [${issue.code}] ${issue.message}${file}`
    })
    .join('\n')
}

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return results
    throw error
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full)))
    } else if (entry.isFile()) {
      results.push(full)
    }
    // Symlinks inside scripts/ are intentionally ignored: Apocryphon only
    // fingerprints regular files it can audit.
  }

  return results
}

async function readScriptChecksums(
  skillDir: string,
  issues: LintIssue[],
): Promise<Record<string, string>> {
  const scriptsDir = path.join(skillDir, 'scripts')
  const checksums: Record<string, string> = {}
  if (!(await pathExistsLocal(scriptsDir))) return checksums

  for (const full of await walkFiles(scriptsDir)) {
    const rel = path.relative(skillDir, full).split(path.sep).join('/')
    const content = await fs.readFile(full)
    checksums[rel] = crypto.createHash('sha256').update(content).digest('hex')

    if (process.platform !== 'win32') {
      const stat = await fs.stat(full)
      if ((stat.mode & 0o111) === 0) {
        issues.push({
          level: 'warning',
          code: 'script-not-executable',
          message: `Script "${rel}" is not executable. Run: chmod +x ${rel}`,
          file: rel,
        })
      }
    }
  }

  return checksums
}

function pushFrontmatterIssues(
  issues: LintIssue[],
  rawFrontmatter: Record<string, unknown>,
  dirName: string,
): void {
  const name = rawFrontmatter.name
  if (typeof name !== 'string' || name.trim() === '') {
    issues.push({
      level: 'error',
      code: 'name-missing',
      message: 'Frontmatter must define a non-empty "name" field.',
      file: 'SKILL.md',
    })
  } else {
    if (name.length > 64) {
      issues.push({
        level: 'error',
        code: 'name-too-long',
        message: 'Frontmatter "name" must be 64 characters or fewer.',
        file: 'SKILL.md',
      })
    }
    if (!SKILL_ID_PATTERN.test(name)) {
      issues.push({
        level: 'error',
        code: 'name-invalid',
        message:
          'Frontmatter "name" must be lowercase kebab-case (a-z, 0-9 and hyphens) to stay portable across Claude Code, Cursor and OpenCode.',
        file: 'SKILL.md',
      })
    } else if (name !== dirName) {
      issues.push({
        level: 'warning',
        code: 'name-mismatch',
        message: `Frontmatter name "${name}" does not match the folder "${dirName}". Clients derive the skill id from the folder.`,
        file: 'SKILL.md',
      })
    }
  }

  const description = rawFrontmatter.description
  if (description === undefined || description === null || String(description).trim() === '') {
    issues.push({
      level: 'error',
      code: 'description-missing',
      message:
        'Frontmatter must define a "description": it is the only text clients use to discover the skill.',
      file: 'SKILL.md',
    })
    return
  }

  if (typeof description !== 'string') {
    issues.push({
      level: 'error',
      code: 'description-invalid',
      message: 'Frontmatter "description" must be a string.',
      file: 'SKILL.md',
    })
    return
  }

  const trimmed = description.trim()
  if (trimmed.length < MIN_DESCRIPTION_LENGTH) {
    issues.push({
      level: 'error',
      code: 'description-too-short',
      message: `Frontmatter "description" is too short (${trimmed.length} chars). Describe what the skill does and when to activate it (min ${MIN_DESCRIPTION_LENGTH}).`,
      file: 'SKILL.md',
    })
  }
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    issues.push({
      level: 'error',
      code: 'description-too-long',
      message: `Frontmatter "description" exceeds ${MAX_DESCRIPTION_LENGTH} characters and will be truncated by Claude Code.`,
      file: 'SKILL.md',
    })
  }
  if (!hasExplicitTriggers(trimmed)) {
    issues.push({
      level: 'error',
      code: 'description-missing-triggers',
      message:
        'Description has no explicit activation triggers. Add when to use it (files, intents or keywords), e.g. "Use it whenever ...".',
      file: 'SKILL.md',
    })
  }
  if (!hasNegativeTriggers(trimmed)) {
    issues.push({
      level: 'warning',
      code: 'description-missing-negative-triggers',
      message:
        'Optional: state when NOT to use the skill to reduce false activations (e.g. "Do not use it for ...").',
      file: 'SKILL.md',
    })
  }
}

/**
 * Validate a single skill directory.
 *
 * Errors block installation; warnings surface quality problems (ambiguous
 * descriptions, oversized bodies, unlinked references, non-executable scripts).
 */
export async function lintSkillDir(
  skillDir: string,
  options: SkillLintOptions = {},
): Promise<SkillLintResult> {
  const resolvedDir = path.resolve(skillDir)
  const dirName = path.basename(resolvedDir)
  const issues: LintIssue[] = []
  const skillFile = path.join(resolvedDir, 'SKILL.md')

  let raw: string
  try {
    raw = await fs.readFile(skillFile, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        id: dirName,
        dir: resolvedDir,
        ok: false,
        frontmatter: null,
        body: '',
        bodyLines: 0,
        descriptionTokens: 0,
        issues: [
          {
            level: 'error',
            code: 'skill-missing-file',
            message: `Missing SKILL.md in ${resolvedDir}`,
            file: 'SKILL.md',
          },
        ],
        scriptChecksums: {},
      }
    }
    throw error
  }

  let rawFrontmatter: Record<string, unknown> = {}
  let body = ''
  let parseFailed = false

  try {
    const parsed = matter(raw)
    rawFrontmatter = (parsed.data ?? {}) as Record<string, unknown>
    body = parsed.content ?? ''
  } catch (error) {
    parseFailed = true
    issues.push({
      level: 'error',
      code: 'frontmatter-invalid',
      message: `Invalid YAML frontmatter: ${(error as Error).message}`,
      file: 'SKILL.md',
    })
  }

  let frontmatter: SkillFrontmatter | null = null
  if (!parseFailed) {
    const parsed = SkillFrontmatterSchema.safeParse(rawFrontmatter)
    if (parsed.success) {
      frontmatter = parsed.data
    } else {
      for (const issue of parsed.error.issues) {
        const at = issue.path.length > 0 ? issue.path.join('.') : '(root)'
        issues.push({
          level: 'error',
          code: 'frontmatter-invalid',
          message: `${at}: ${issue.message}`,
          file: 'SKILL.md',
        })
      }
    }

    if (!SKILL_ID_PATTERN.test(dirName)) {
      issues.push({
        level: 'error',
        code: 'skill-id-invalid',
        message: `Folder name "${dirName}" is not a portable skill id (lowercase kebab-case).`,
      })
    }

    pushFrontmatterIssues(issues, rawFrontmatter, dirName)
  }

  const trimmedBody = body.trim()
  const bodyLines = trimmedBody === '' ? 0 : trimmedBody.split(/\r?\n/).length
  const maxBodyLines = options.maxBodyLines ?? MAX_BODY_LINES

  if (bodyLines === 0) {
    issues.push({
      level: 'warning',
      code: 'body-empty',
      message: 'SKILL.md has no instructions after the frontmatter.',
      file: 'SKILL.md',
    })
  } else if (bodyLines > maxBodyLines) {
    issues.push({
      level: 'warning',
      code: 'body-too-long',
      message: `SKILL.md body has ${bodyLines} lines (recommended max ${maxBodyLines}). Move long examples to references/ for progressive disclosure.`,
      file: 'SKILL.md',
    })
  }

  const referencesDir = path.join(resolvedDir, 'references')
  if (await pathExistsLocal(referencesDir)) {
    if (!/references\//.test(trimmedBody)) {
      issues.push({
        level: 'warning',
        code: 'references-unlinked',
        message:
          'A references/ folder exists but SKILL.md never points to it. Tell the agent which files to read and when.',
        file: 'SKILL.md',
      })
    }
  }

  const scriptChecksums = await readScriptChecksums(resolvedDir, issues)

  const description = typeof rawFrontmatter.description === 'string' ? rawFrontmatter.description : ''
  return {
    id: dirName,
    dir: resolvedDir,
    ok: !issues.some((issue) => issue.level === 'error'),
    frontmatter,
    body: trimmedBody,
    bodyLines,
    descriptionTokens: estimateTokens(description),
    issues,
    scriptChecksums,
  }
}

async function pathExistsLocal(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export interface IntegrityReport {
  id: string
  status: 'ok' | 'modified' | 'unknown'
  changedFiles: string[]
  missingFiles: string[]
  extraFiles: string[]
}

/**
 * Verify that the scripts of an installed skill were not modified since
 * installation. Catches accidental edits and tampering before a runner executes
 * a skill script.
 */
export async function verifySkillIntegrity(
  skillDir: string,
  expected: Record<string, string>,
): Promise<IntegrityReport> {
  const id = path.basename(path.resolve(skillDir))
  const issues: LintIssue[] = []
  const current = await readScriptChecksums(skillDir, issues)

  const expectedKeys = Object.keys(expected)
  if (expectedKeys.length === 0) {
    return {
      id,
      status: Object.keys(current).length === 0 ? 'ok' : 'unknown',
      changedFiles: [],
      missingFiles: [],
      extraFiles: Object.keys(current),
    }
  }

  const changedFiles: string[] = []
  const missingFiles: string[] = []
  const extraFiles: string[] = []

  for (const [file, hash] of Object.entries(expected)) {
    const currentHash = current[file]
    if (currentHash === undefined) missingFiles.push(file)
    else if (currentHash !== hash) changedFiles.push(file)
  }
  for (const file of Object.keys(current)) {
    if (!(file in expected)) extraFiles.push(file)
  }

  const modified = changedFiles.length + missingFiles.length + extraFiles.length > 0
  return {
    id,
    status: modified ? 'modified' : 'ok',
    changedFiles,
    missingFiles,
    extraFiles,
  }
}

export { JUNK_NAMES }
