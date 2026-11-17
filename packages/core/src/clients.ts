import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import {
  CLIENT_IDS,
  type ClientId,
  type ClientsConfig,
} from './schemas.js'

export interface ClientDirDefaults {
  globalDir: string
  projectDir: string
}

/**
 * Defaults verified against each client's documentation.
 *
 * - Claude Code: `~/.claude/skills` and `<project>/.claude/skills`
 * - OpenCode: `~/.config/opencode/skills` and `<project>/.opencode/skills`
 * - Cursor: `~/.cursor/skills` and `<project>/.cursor/skills`
 *
 * All of them are configurable in `~/.apocryphon/config.json`.
 */
export const DEFAULT_CLIENT_DIRS: Record<ClientId, ClientDirDefaults> = {
  claude: { globalDir: '~/.claude/skills', projectDir: '.claude/skills' },
  cursor: { globalDir: '~/.cursor/skills', projectDir: '.cursor/skills' },
  opencode: { globalDir: '~/.config/opencode/skills', projectDir: '.opencode/skills' },
}

export const CLIENT_LABELS: Record<ClientId, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  opencode: 'OpenCode',
}

/**
 * OpenCode also scans Claude Code's skill directories (documented behavior).
 * When both clients are enabled we skip writing a duplicate copy for OpenCode.
 */
export const CLIENT_COVERAGE: Partial<Record<ClientId, ClientId[]>> = {
  opencode: ['claude'],
}

export function clientBinary(client: ClientId): string {
  switch (client) {
    case 'claude':
      return 'claude'
    case 'cursor':
      return 'cursor'
    case 'opencode':
      return 'opencode'
  }
}

export function isClientId(value: string): value is ClientId {
  return (CLIENT_IDS as readonly string[]).includes(value)
}

export function defaultClientsConfig(enabled: Iterable<ClientId> = []): ClientsConfig {
  const enabledSet = new Set(enabled)
  const build = (client: ClientId) => ({
    enabled: enabledSet.has(client),
    globalDir: DEFAULT_CLIENT_DIRS[client].globalDir,
    projectDir: DEFAULT_CLIENT_DIRS[client].projectDir,
  })
  return {
    claude: build('claude'),
    cursor: build('cursor'),
    opencode: build('opencode'),
  }
}

function binaryAvailable(binary: string): boolean {
  const command = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(command, [binary], { encoding: 'utf8', stdio: 'pipe' })
  return result.status === 0
}

async function dirExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * Best-effort detection of installed clients. Looks at each client's config
 * directory and its CLI binary. False negatives are acceptable: the user can
 * always enable a client explicitly with `apocryphon clients enable`.
 */
export async function detectClientPresence(
  homeDir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<ClientId, boolean>> {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim()
    ? env.XDG_CONFIG_HOME.trim()
    : path.join(homeDir, '.config')

  const [claudeDir, cursorDir, opencodeDir] = await Promise.all([
    dirExists(path.join(homeDir, '.claude')),
    dirExists(path.join(homeDir, '.cursor')),
    dirExists(path.join(xdgConfigHome, 'opencode')),
  ])

  return {
    claude: claudeDir || binaryAvailable('claude'),
    cursor: cursorDir || binaryAvailable('cursor') || binaryAvailable('agent'),
    opencode: opencodeDir || binaryAvailable('opencode'),
  }
}

/**
 * Return the enabled client that already exposes its skill directory to
 * `client` (if any), so Apocryphon can avoid duplicate symlinks.
 */
export function coveredBy(
  client: ClientId,
  clients: ClientsConfig,
  dedupe: boolean,
): ClientId | null {
  if (!dedupe) return null
  for (const candidate of CLIENT_COVERAGE[client] ?? []) {
    if (clients[candidate].enabled) return candidate
  }
  return null
}

export function parseClientList(input: string): ClientId[] {
  const raw = input
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  if (raw.length === 0) return []
  if (raw.includes('all')) return [...CLIENT_IDS]
  const unknown = raw.filter((value) => !isClientId(value))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown client(s): ${unknown.join(', ')}. Valid values: ${CLIENT_IDS.join(', ')} or "all".`,
    )
  }
  return [...new Set(raw)] as ClientId[]
}
