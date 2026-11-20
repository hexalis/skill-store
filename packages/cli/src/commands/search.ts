import { spawnSync } from 'node:child_process'
import { Command } from 'commander'
import pc from 'picocolors'
import {
  listVaultSkills,
  searchRegistry,
  type RegistrySkillEntry,
  type SkillLintResult,
} from '@hexalis/skill-store-core'
import { loadContext, tryLoadRegistry } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { fuzzyScore } from '../lib/fuzzy.js'
import { printJson, table, truncate } from '../lib/output.js'

interface SearchOptions {
  json?: boolean
  category?: string
  tag?: string
  limit?: string
  fzf?: boolean
}

interface Candidate {
  id: string
  version: string | null
  category: string | null
  tags: string[]
  installed: boolean
  description: string
  score: number
}

function fromEntry(entry: RegistrySkillEntry, installed: boolean): Omit<Candidate, 'score'> {
  return {
    id: entry.id,
    version: entry.version ?? null,
    category: entry.category ?? null,
    tags: entry.tags ?? [],
    installed,
    description: entry.description ?? '',
  }
}

function fromVault(skill: SkillLintResult): Omit<Candidate, 'score'> {
  return {
    id: skill.id,
    version: skill.frontmatter?.version ?? null,
    category: skill.frontmatter?.category ?? null,
    tags: skill.frontmatter?.tags ?? [],
    installed: true,
    description: skill.frontmatter?.description ?? '',
  }
}

function searchText(candidate: Omit<Candidate, 'score'>): string {
  return [candidate.id, candidate.description, candidate.category ?? '', ...candidate.tags].join(' ')
}

function runFzf(candidates: Candidate[]): void {
  const input = candidates.map((candidate) => `${candidate.id}\t${candidate.description}`).join('\n')
  const result = spawnSync('fzf', ['--with-nth=1,2', '--delimiter=\t'], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  if (result.error) {
    console.error(pc.yellow('warn') + ' fzf not found; showing the table instead.')
    return
  }
  if (result.status === 1) return // cancelled
  const selected = (result.stdout ?? '').trim().split('\t')[0]
  if (selected) console.log(selected)
}

export function searchCommand(): Command {
  const command = new Command('search')
    .description('Search the catalog (or installed skills) with fuzzy ranking')
    .argument('<query>', 'Text to match against ids, descriptions, categories and tags')
    .option('-c, --category <category>', 'Only show skills in this category')
    .option('-t, --tag <tag>', 'Only show skills with this tag')
    .option('-l, --limit <n>', 'Maximum number of results', '30')
    .option('--fzf', 'Pipe the results to fzf when available')
    .option('--json', 'Print machine-readable JSON')

  addGlobalOptions(command)

  return command.action(async (query: string, options: SearchOptions) => {
    await runSafely(async () => {
      const ui = uiFromArgv(Boolean(options.json))
      const ctx = await loadContext()
      const registry = await tryLoadRegistry(ctx)
      const vault = await listVaultSkills(ctx.paths.vault)
      const installed = new Set(vault.map((skill) => skill.id))

      let base: Array<Omit<Candidate, 'score'>>

      if (registry) {
        base = searchRegistry(registry.index, '').map((entry) =>
          fromEntry(entry, installed.has(entry.id)),
        )
      } else {
        base = vault.map(fromVault)
      }

      const filtered = base.filter((candidate) => {
        if (options.category && candidate.category !== options.category) return false
        if (options.tag && !candidate.tags.includes(options.tag)) return false
        return true
      })

      const limit = Math.max(1, Number.parseInt(options.limit ?? '30', 10) || 30)
      const ranked: Candidate[] = filtered
        .map((candidate) => ({ ...candidate, score: fuzzyScore(query, searchText(candidate)) }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, limit)

      if (options.json) {
        printJson(ranked)
        return
      }

      if (ranked.length === 0) {
        ui.info(`No matches for "${query}".`)
        return
      }

      if (options.fzf) {
        runFzf(ranked)
        return
      }

      console.log(
        table(
          ['Skill', 'Version', 'Category', 'Installed', 'Score', 'Description'],
          ranked.map((candidate) => [
            candidate.id,
            candidate.version ?? '-',
            candidate.category ?? '-',
            candidate.installed ? pc.green('yes') : pc.dim('no'),
            String(candidate.score),
            truncate(candidate.description, 60),
          ]),
        ),
      )

      if (!registry) {
        ui.info(
          pc.dim(
            '\nOnly installed skills are searchable. Configure a registry with `skill-store init --registry <source>`.',
          ),
        )
      }
    })
  })
}
