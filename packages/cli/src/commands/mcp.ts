import { Command } from 'commander'
import { runSafely } from '../lib/run.js'
import { startMcpServer } from '../lib/mcp-server.js'

export function mcpCommand(): Command {
  return new Command('mcp')
    .description(
      'Run a stdio MCP server (optional) to inspect and change skills from the IDE chat',
    )
    .action(async () => {
      await runSafely(async () => {
        await startMcpServer()
      })
    })
}
