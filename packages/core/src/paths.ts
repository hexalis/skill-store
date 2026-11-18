import os from 'node:os'
import path from 'node:path'

/**
 * Expand a leading `~` (or `~/`) to the current user's home directory.
 * Anything else is returned untouched.
 */
export function expandHome(input: string, homeDir: string = os.homedir()): string {
  if (input === '~') return homeDir
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(homeDir, input.slice(2))
  }
  return input
}

/**
 * Resolve the Apocryphon home directory.
 *
 * Precedence:
 *   1. `APOCRYPHON_HOME` environment variable (used by tests and power users).
 *   2. `~/.apocryphon`.
 */
export function resolveApocryphonHome(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string {
  const override = env.APOCRYPHON_HOME?.trim()
  if (override) return path.resolve(expandHome(override, homeDir))
  return path.join(homeDir, '.apocryphon')
}

export interface ApocryphonPaths {
  /** Root of all Apocryphon state. */
  home: string
  /** Global configuration file. */
  config: string
  /** Global state: active skills, packs and installed skill metadata. */
  state: string
  /** Per-project skill selections. */
  projects: string
  /** Installed skills (source of truth used for symlinks). */
  vault: string
 /** Pristine copies of installed skills (merge base). */
  pristine: string
  /** Backups taken before overwriting or merging customized skills. */
  backups: string
  /** Local clone (or reference) of the remote registry. */
  registry: string
}

export function resolvePaths(home: string = resolveApocryphonHome()): ApocryphonPaths {
  return {
    home,
    config: path.join(home, 'config.json'),
    state: path.join(home, 'state.json'),
    projects: path.join(home, 'projects.json'),
    vault: path.join(home, 'vault'),
    pristine: path.join(home, 'pristine'),
    backups: path.join(home, 'backups'),
    registry: path.join(home, 'registry'),
  }
}

/** Normalize a path for use as a projects.json key. */
export function normalizeProjectPath(input: string): string {
  return path.resolve(input)
}

/**
 * Find the closest registered project entry for `cwd`, walking up the
 * directory tree. Returns `null` when the path is not registered.
 */
export function findRegisteredProject<T>(
  projects: Record<string, T>,
  cwd: string,
): { root: string; entry: T } | null {
  const registered = new Map<string, { root: string; entry: T }>()
  for (const [root, entry] of Object.entries(projects)) {
    registered.set(normalizeProjectPath(root), { root, entry })
  }

  let current = normalizeProjectPath(cwd)
  for (;;) {
    const found = registered.get(current)
    if (found) return found
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}
