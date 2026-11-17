import {
  listVaultSkillIds,
  type ProjectEntry,
  type SyncReport,
} from '@apocryphon/core'
import {
  activePacks,
  availablePacks,
  ensureEntry,
  saveProjectEntry,
  saveState,
  syncContext,
  tryLoadRegistry,
  type CliContext,
} from './context.js'

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((value) => set.has(value))
}

export interface ToggleOptions {
  global: boolean
  enable: boolean
}

export interface ToggleResult {
  changed: boolean
  skills: string[]
  packs: string[]
  report?: SyncReport
}

/**
 * Shared implementation used by `enable`/`disable` and by the MCP server.
 *
 * Items are resolved against the vault first and the pack catalog second, so
 * `enable workflow-atomic-commits` and `enable core-discipline` both work.
 */
export async function toggleItems(
  ctx: CliContext,
  items: string[],
  options: ToggleOptions,
): Promise<ToggleResult> {
  const registry = await tryLoadRegistry(ctx)
  const packs = availablePacks(ctx, registry?.index.packs)
  const vaultIds = new Set(await listVaultSkillIds(ctx.paths.vault))

  const skills: string[] = []
  const packIds: string[] = []
  const unknown: string[] = []

  for (const item of items) {
    if (vaultIds.has(item)) skills.push(item)
    else if (item in packs) packIds.push(item)
    else unknown.push(item)
  }

  if (unknown.length > 0) {
    throw new Error(
      `Unknown skill or pack: ${unknown.join(', ')}. Run \`apocryphon list\` (installed) or \`apocryphon search <query>\` (catalog).`,
    )
  }

  const now = new Date().toISOString()
  let changed = false

  if (options.global) {
    const nextSkills = options.enable
      ? unique([...ctx.state.globalSkills, ...skills])
      : ctx.state.globalSkills.filter((id) => !skills.includes(id))
    const nextPacks = options.enable
      ? unique([...ctx.state.globalPacks, ...packIds])
      : ctx.state.globalPacks.filter((name) => !packIds.includes(name))

    changed =
      !sameSet(nextSkills, ctx.state.globalSkills) ||
      !sameSet(nextPacks, ctx.state.globalPacks)

    if (changed) {
      ctx.state = {
        ...ctx.state,
        globalSkills: nextSkills,
        globalPacks: nextPacks,
        updatedAt: now,
      }
      await saveState(ctx)
    }
  } else {
    const entry = ensureEntry(ctx)
    const nextSkills = options.enable
      ? unique([...entry.skills, ...skills])
      : entry.skills.filter((id) => !skills.includes(id))
    const nextPacks = options.enable
      ? unique([...entry.packs, ...packIds])
      : entry.packs.filter((name) => !packIds.includes(name))

    changed = !sameSet(nextSkills, entry.skills) || !sameSet(nextPacks, entry.packs)

    if (changed) {
      const next: ProjectEntry = {
        ...entry,
        skills: nextSkills,
        packs: nextPacks,
        updatedAt: now,
      }
      await saveProjectEntry(ctx, next)
    }
  }

  if (!changed) return { changed, skills, packs: packIds }

  const report = await syncContext(ctx, {
    registryPacks: registry?.index.packs ?? null,
  })

  return { changed, skills, packs: packIds, report }
}

export function describeActive(ctx: CliContext, global: boolean): {
  skills: string[]
  packs: string[]
} {
  return { skills: activePacks(ctx, global), packs: [] }
}
