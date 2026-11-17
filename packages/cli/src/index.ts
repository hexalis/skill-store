import { Command } from 'commander'
import pc from 'picocolors'
import { initCommand } from './commands/init.js'
import { clientsCommand } from './commands/clients.js'
import { searchCommand } from './commands/search.js'
import { installCommand } from './commands/install.js'
import { listCommand } from './commands/list.js'
import { enableCommand, disableCommand } from './commands/toggle.js'
import { packCommand } from './commands/pack.js'
import { useCommand } from './commands/use.js'
import { syncCommand } from './commands/sync.js'
import { validateCommand } from './commands/validate.js'
import { statusCommand } from './commands/status.js'
import { mcpCommand } from './commands/mcp.js'
import { readVersion } from './lib/version.js'

const program = new Command()

program
  .name('apocryphon')
  .description(
    'Install, validate and activate agent skills for Claude Code, Cursor and OpenCode.',
  )
  .version(readVersion())
  .showHelpAfterError()
  .configureHelp({ sortSubcommands: true })

program.addCommand(initCommand())
program.addCommand(clientsCommand())
program.addCommand(searchCommand())
program.addCommand(installCommand())
program.addCommand(listCommand())
program.addCommand(enableCommand())
program.addCommand(disableCommand())
program.addCommand(packCommand())
program.addCommand(useCommand())
program.addCommand(syncCommand())
program.addCommand(validateCommand())
program.addCommand(statusCommand())
program.addCommand(mcpCommand())

await program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`${pc.red('error')} ${message}`)
  process.exitCode = 1
})
