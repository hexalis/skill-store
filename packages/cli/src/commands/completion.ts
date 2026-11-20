import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import {
  SHELLS,
  completionInstallPath,
  completionScript,
  detectShell,
  isShell,
  type Shell,
} from '../lib/completions.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'

interface CompletionOptions {
  install?: boolean
  shell?: string
  print?: boolean
}

function resolveShell(value: string | undefined): Shell {
  if (value && isShell(value)) return value
  return detectShell()
}

export function completionCommand(): Command {
  const command = new Command('completion')
    .description('Print or install shell completions (bash, zsh, fish)')
    .argument('[shell]', 'bash, zsh, fish, or "install"')
    .option('--install', 'Install the completion script for the current shell')
    .option('--shell <shell>', 'Target shell for --install (defaults to $SHELL)')
    .option('--print', 'Print the script instead of writing it (with --install)')

  addGlobalOptions(command)

  return command.action(async (shell: string | undefined, options: CompletionOptions) => {
    await runSafely(async () => {
      const ui = uiFromArgv()
      const installMode = options.install || shell === 'install'

      if (!installMode) {
        if (!shell || !isShell(shell)) {
          throw new Error(
            `Choose a shell: ${SHELLS.join(', ')}. Example: skill-store completion bash`,
          )
        }
        console.log(completionScript(shell))
        return
      }

      const target = resolveShell(options.shell ?? (shell && isShell(shell) ? shell : undefined))
      const script = completionScript(target)

      if (options.print) {
        console.log(script)
        return
      }

      const file = completionInstallPath(target)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, script, 'utf8')

      ui.success(`Installed ${target} completion at ${file}`)
      if (target === 'zsh') {
        ui.info(
          `Add this to ~/.zshrc if it is not there yet:\n  fpath=(${path.dirname(file)} $fpath)\n  autoload -Uz compinit && compinit`,
        )
      } else if (target === 'bash') {
        ui.info(
          pc.dim(
            'The script lives in the standard bash-completion directory; open a new shell to load it.',
          ),
        )
      } else {
        ui.info(pc.dim('Fish loads completion files automatically in new shells.'))
      }
    })
  })
}
