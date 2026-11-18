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
import { registryCommand } from './commands/registry.js'
import { diffCommand } from './commands/diff.js'
import { resetCommand } from './commands/reset.js'
import { adoptCommand } from './commands/adopt.js'
import { backupsCommand } from './commands/backups.js'
import { newCommand } from './commands/new.js'
import { importCommand } from './commands/import.js'
import { findCommand } from './commands/find.js'
import { browseCommand } from './commands/browse.js'
import { tagsCommand, categoriesCommand } from './commands/taxonomy.js'
import { completionCommand } from './commands/completion.js'
import { completeCommand } from './commands/__complete.js'
import { addGlobalOptions } from './lib/options.js'
import { readVersion } from './lib/version.js'
import { isInteractive } from './lib/run.js'
import { runLauncher } from './lib/launcher.js'
import { c } from './lib/colors.js'

const program = new Command()

program
  .name('apocryphon')
  .description(
    'Install, validate and activate agent skills for Claude Code, Cursor and OpenCode.',
  )
  .version(readVersion())
  .showHelpAfterError()
  .configureHelp({ sortSubcommands: true })

addGlobalOptions(program)

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
program.addCommand(findCommand())
program.addCommand(browseCommand())
program.addCommand(tagsCommand())
program.addCommand(categoriesCommand())
program.addCommand(newCommand())
program.addCommand(importCommand())
program.addCommand(diffCommand())
program.addCommand(resetCommand())
program.addCommand(adoptCommand())
program.addCommand(backupsCommand())
program.addCommand(completionCommand())
program.addCommand(registryCommand())
program.addCommand(mcpCommand())
program.addCommand(completeCommand())

program.action(async () => {
  if (process.argv.slice(2).length === 0 && isInteractive()) {
    await runLauncher()
    return
  }
  program.outputHelp()
})

await program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`${c.red('error')} ${message}`)
  process.exitCode = 1
})
