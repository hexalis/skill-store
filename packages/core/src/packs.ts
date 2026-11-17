import type { Pack, ProjectEntry, State } from './schemas.js'

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
