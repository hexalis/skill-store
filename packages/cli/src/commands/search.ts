import { Command } from 'commander'
import pc from 'picocolors'
import {
  listVaultSkills,
  searchRegistry,
} from '@apocryphon/core'
import { loadContext, tryLoadRegistry } from '../lib/context.js'
import { runSafely } from '../lib/run.js'
import { printJson, table, truncate } from '../lib/output.js'

interface SearchRow {
  id: string
  version: string | null
  category: string | null
  installed: boolean
  description: string
}

export function searchCommand(): Command {
  return new Command('search')
    .description('Search the configured catalog (falls back to installed skills)')
    .argument('<query>', 'Text to look for in ids, descriptions and tags')
    .option('--json', 'Print machine-readable JSON')
    .action(async (query: string, options: { json?: boolean }) => {
      await runSafely(async () => {
        const ctx = await loadContext()
        const registry = await tryLoadRegistry(ctx)
        const vault = await listVaultSkills(ctx.paths.vault)
        const installed = new Set(vault.map((skill) => skill.id))

        let rows: SearchRow[]

        if (registry) {
          rows = searchRegistry(registry.index, query).map((skill) => ({
            id: skill.id,
            version: skill.version ?? null,
            category: skill.category ?? null,
            installed: installed.has(skill.id),
            description: skill.description ?? '',
          }))
        } else {
          const needle = query.trim().toLowerCase()
          rows = vault
            .filter((skill) => {
              const haystack = [
                skill.id,
                skill.frontmatter?.description ?? '',
                skill.frontmatter?.category ?? '',
                ...(skill.frontmatter?.tags ?? []),
              ]
                .join(' ')
                .toLowerCase()
              return needle === '' || haystack.includes(needle)
            })
            .map((skill) => ({
              id: skill.id,
              version: skill.frontmatter?.version ?? null,
              category: skill.frontmatter?.category ?? null,
              installed: true,
              description: skill.frontmatter?.description ?? '',
            }))
        }

        if (options.json) {
          printJson(rows)
          return
        }

        if (rows.length === 0) {
          console.log(`No matches for "${query}".`)
          return
        }

        console.log(
          table(
            ['Skill', 'Version', 'Category', 'Installed', 'Description'],
            rows.map((row) => [
              row.id,
              row.version ?? '-',
              row.category ?? '-',
              row.installed ? pc.green('yes') : pc.dim('no'),
              truncate(row.description, 70),
            ]),
          ),
        )

        if (!registry) {
          console.log(
            pc.dim(
              '\nOnly installed skills are searchable. Configure a registry with `apocryphon init --registry <source>`.',
            ),
          )
        }
      })
    })
}
