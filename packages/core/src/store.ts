import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import {
  ConfigSchema,
  ProjectsSchema,
  StateSchema,
  type Config,
  type Projects,
  type State,
} from './schemas.js'

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function emptyState(): State {
  return {
    version: 1,
    updatedAt: nowIso(),
    globalSkills: [],
    globalPacks: [],
    packs: {},
    skills: {},
  }
}

export function emptyProjects(): Projects {
  return { version: 1, projects: {} }
}

function formatZodError(error: z.ZodError, file: string): string {
  const details = error.issues
    .map((issue) => {
      const at = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `  - ${at}: ${issue.message}`
    })
    .join('\n')
  return `Invalid data in ${file}:\n${details}`
}

export async function readJson<T>(
  file: string,
  schema: z.ZodType<T>,
  fallback: () => T,
): Promise<T> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback()
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${(error as Error).message}`)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) throw new Error(formatZodError(result.error, file))
  return result.data
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, file)
}

export async function readConfig(file: string): Promise<Config> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Skill Store is not initialized (missing ${file}). Run \`skill-store init\` first.`,
      )
    }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${(error as Error).message}`)
  }

  const result = ConfigSchema.safeParse(parsed)
  if (!result.success) throw new Error(formatZodError(result.error, file))
  return result.data
}

export async function readState(file: string): Promise<State> {
  return readJson(file, StateSchema, emptyState)
}

export async function readProjects(file: string): Promise<Projects> {
  return readJson(file, ProjectsSchema, emptyProjects)
}

export async function writeConfig(file: string, config: Config): Promise<void> {
  await writeJson(file, config)
}

export async function writeState(file: string, state: State): Promise<void> {
  await writeJson(file, state)
}

export async function writeProjects(file: string, projects: Projects): Promise<void> {
  await writeJson(file, projects)
}

/** Read + parse a JSON file without schema validation (used for registry.json errors). */
export async function readRawJson(file: string): Promise<unknown> {
  const raw = await fs.readFile(file, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${(error as Error).message}`)
  }
}

export { formatZodError }
