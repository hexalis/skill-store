import { z } from 'zod'
import {
  collectStatus,
  listVaultSkills,
  searchRegistry,
} from '@hexalis/skill-store-core'
import {
  loadContext,
  syncContext,
  tryLoadRegistry,
} from './context.js'
import { toggleItems } from './actions.js'
import { readVersion } from './version.js'

function text(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  }
}

function failure(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  }
}

async function statusPayload(project?: string) {
  const ctx = await loadContext({ project })
  const registry = await tryLoadRegistry(ctx)
  const status = await collectStatus({
    paths: ctx.paths,
    config: ctx.config,
    state: ctx.state,
    projects: ctx.projects,
    projectRoot: ctx.projectRoot,
    registryPacks: registry?.index.packs ?? null,
  })
  return {
    home: status.home,
    projectRoot: status.projectRoot,
    active: status.active,
    budget: {
      count: status.budget.count,
      tokens: status.budget.tokens,
      level: status.budget.level,
    },
    skills: status.skills,
    clients: status.clients,
  }
}

/**
 * Start a stdio MCP server so the IDE chat can inspect and change skill state
 * without leaving the conversation.
 *
 * The MCP SDK is an optional peer dependency: the lightweight CLI must remain
 * installable without it.
 */
export async function startMcpServer(): Promise<void> {
  let mcpModule: typeof import('@modelcontextprotocol/sdk/server/mcp.js')
  let stdioModule: typeof import('@modelcontextprotocol/sdk/server/stdio.js')

  try {
    mcpModule = await import('@modelcontextprotocol/sdk/server/mcp.js')
    stdioModule = await import('@modelcontextprotocol/sdk/server/stdio.js')
  } catch {
    throw new Error(
      'MCP support requires the optional peer dependency "@modelcontextprotocol/sdk". Install it with:\n  npm install -g @modelcontextprotocol/sdk',
    )
  }

  const server = new mcpModule.McpServer({
    name: 'skill-store',
    version: readVersion(),
  })

  server.registerTool(
    'skill_store_status',
    {
      title: 'Skill Store status',
      description:
        'Return active skills, context budget, client links and project registration for the current project.',
      inputSchema: {
        project: z.string().optional().describe('Project directory; defaults to the server cwd'),
      },
    },
    async (args: { project?: string }) => {
      try {
        return text(await statusPayload(args.project))
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    'skill_store_list_skills',
    {
      title: 'List installed skills',
      description:
        'List the skills installed in the Skill Store vault with their category, active scopes and lint status.',
      inputSchema: {
        project: z.string().optional().describe('Project directory; defaults to the server cwd'),
      },
    },
    async (args: { project?: string }) => {
      try {
        const payload = await statusPayload(args.project)
        return text(payload.skills)
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    'skill_store_search',
    {
      title: 'Search skills',
      description:
        'Search the configured Skill Store registry (or the vault when no registry is configured).',
      inputSchema: {
        query: z.string().describe('Text to match against ids, descriptions and tags'),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    async (args: { query: string; limit?: number }) => {
      try {
        const ctx = await loadContext()
        const registry = await tryLoadRegistry(ctx)
        const limit = args.limit ?? 20

        if (registry) {
          return text(searchRegistry(registry.index, args.query).slice(0, limit))
        }

        const needle = args.query.toLowerCase()
        const skills = (await listVaultSkills(ctx.paths.vault)).filter((skill) =>
          `${skill.id} ${skill.frontmatter?.description ?? ''}`
            .toLowerCase()
            .includes(needle),
        )
        return text(
          skills.slice(0, limit).map((skill) => ({
            id: skill.id,
            description: skill.frontmatter?.description ?? null,
            category: skill.frontmatter?.category ?? null,
          })),
        )
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    'skill_store_enable',
    {
      title: 'Enable skills or packs',
      description:
        'Activate skills or packs globally or for a project, then reconcile the client symlinks.',
      inputSchema: {
        items: z.array(z.string()).min(1).describe('Skill ids or pack names'),
        scope: z.enum(['global', 'project']).optional(),
        project: z.string().optional(),
      },
    },
    async (args: { items: string[]; scope?: 'global' | 'project'; project?: string }) => {
      try {
        const ctx = await loadContext({ project: args.project })
        const result = await toggleItems(ctx, args.items, {
          global: args.scope === 'global',
          enable: true,
        })
        return text({
          changed: result.changed,
          skills: result.skills,
          packs: result.packs,
          created: result.report?.created ?? [],
          removed: result.report?.removed ?? [],
        })
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    'skill_store_disable',
    {
      title: 'Disable skills or packs',
      description:
        'Deactivate skills or packs globally or for a project, then reconcile the client symlinks.',
      inputSchema: {
        items: z.array(z.string()).min(1).describe('Skill ids or pack names'),
        scope: z.enum(['global', 'project']).optional(),
        project: z.string().optional(),
      },
    },
    async (args: { items: string[]; scope?: 'global' | 'project'; project?: string }) => {
      try {
        const ctx = await loadContext({ project: args.project })
        const result = await toggleItems(ctx, args.items, {
          global: args.scope === 'global',
          enable: false,
        })
        return text({
          changed: result.changed,
          skills: result.skills,
          packs: result.packs,
          created: result.report?.created ?? [],
          removed: result.report?.removed ?? [],
        })
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    'skill_store_sync',
    {
      title: 'Sync client links',
      description:
        'Reconcile the managed symlinks of the current project (and global scope) with the stored skill state.',
      inputSchema: {
        project: z.string().optional().describe('Project directory; defaults to the server cwd'),
      },
    },
    async (args: { project?: string }) => {
      try {
        const ctx = await loadContext({ project: args.project })
        const registry = await tryLoadRegistry(ctx)
        const report = await syncContext(ctx, {
          registryPacks: registry?.index.packs ?? null,
        })
        return text({
          created: report.created,
          unchanged: report.unchanged,
          removed: report.removed,
          warnings: report.warnings,
        })
      } catch (error) {
        return failure(error)
      }
    },
  )

  const transport = new stdioModule.StdioServerTransport()
  await server.connect(transport)
}
