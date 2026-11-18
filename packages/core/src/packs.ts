import type { Pack, ProjectEntry, Projects, State } from './schemas.js'

export interface ActiveSkills {
  global: string[]
  project: string[]
  unknownPacks: string[]
}

export function resolvePackDefinition(
  name: string,
  registryPacks: Record<string, Pack> | null | undefined,
  statePacks: Record<string, Pack>,
): Pack | null {
  if (registryPacks && name in registryPacks) return registryPacks[name] ?? null
  if (name in statePacks) return statePacks[name] ?? null
  return null
}

function addAll(target: Set<string>, values: Iterable<string>): void {
  for (const value of values) target.add(value)
}

/**
 * Expand the active skills of a scope, resolving pack references.
 *
 * Unknown packs are reported instead of silently ignored so the CLI can warn
 * the user (for example after switching registries).
 */
export function expandActiveSkills(
  state: State,
  entry: ProjectEntry | null | undefined,
  registryPacks: Record<string, Pack> | null | undefined = null,
): ActiveSkills {
  const global = new Set<string>(state.globalSkills)
  const project = new Set<string>()
  const unknownPacks: string[] = []

  for (const packName of state.globalPacks) {
    const pack = resolvePackDefinition(packName, registryPacks, state.packs)
    if (!pack) {
      unknownPacks.push(packName)
      continue
    }
    addAll(global, pack.skills)
  }

  if (entry) {
    addAll(project, entry.skills)
    for (const packName of entry.packs) {
      const pack = resolvePackDefinition(packName, registryPacks, state.packs)
      if (!pack) {
        unknownPacks.push(packName)
        continue
      }
      addAll(project, pack.skills)
    }
  }

  return {
    global: [...global],
    project: [...project],
    unknownPacks: [...new Set(unknownPacks)],
  }
}

export function packNames(state: State, registryPacks: Record<string, Pack> | null | undefined): string[] {
  const names = new Set<string>(Object.keys(state.packs))
  if (registryPacks) for (const name of Object.keys(registryPacks)) names.add(name)
  return [...names].sort((a, b) => a.localeCompare(b))
}


/** Active pack names across the global scope and every registered project. */
export function collectActivePacks(state: State, projects?: Projects): string[] {
  const active = new Set<string>(state.globalPacks)
  if (projects) {
    for (const entry of Object.values(projects.projects)) {
      for (const name of entry.packs) active.add(name)
    }
  }
  return [...active]
}

/**
 * Build the pack catalog of the new source while preserving definitions of
 * packs that are still active. This prevents changing the source from silently
 * deactivating skills that were active through a pack missing from the new
 * catalog.
 */
export function registryPackSet(
  current: Record<string, Pack>,
  incoming: Record<string, Pack>,
  activePacks: Iterable<string> = [],
): Record<string, Pack> {
  const next: Record<string, Pack> = { ...incoming }
  for (const name of activePacks) {
    if (!(name in next) && current[name]) next[name] = current[name]
  }
  return next
}
