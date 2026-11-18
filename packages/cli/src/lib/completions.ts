import os from 'node:os'
import path from 'node:path'

export const SHELLS = ['bash', 'zsh', 'fish'] as const
export type Shell = (typeof SHELLS)[number]

export function isShell(value: string): value is Shell {
  return (SHELLS as readonly string[]).includes(value)
}

export function completionScript(shell: Shell): string {
  switch (shell) {
    case 'bash':
      return `# apocryphon bash completion
_apocryphon_complete() {
  local words=("\${COMP_WORDS[@]:1}")
  local candidates
  candidates="$(apocryphon __complete words "\${words[@]}" 2>/dev/null)"
  COMPREPLY=($(compgen -W "$candidates" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -F _apocryphon_complete apocryphon
`
    case 'zsh':
      return `#compdef apocryphon
# apocryphon zsh completion
_apocryphon() {
  local -a candidates
  candidates=("\${(@f)$(apocryphon __complete words "\${words[2,-1]}" 2>/dev/null)}")
  compadd -- "\${candidates[@]}"
}
compdef _apocryphon apocryphon
`
    case 'fish':
      return `# apocryphon fish completion
function __apocryphon_complete
  apocryphon __complete words (commandline -opc)[2..-1] 2>/dev/null
end
complete -c apocryphon -f -a '(__apocryphon_complete)'
`
  }
}

export function completionInstallPath(shell: Shell, homeDir = os.homedir()): string {
  switch (shell) {
    case 'bash':
      return path.join(homeDir, '.local', 'share', 'bash-completion', 'completions', 'apocryphon')
    case 'zsh':
      return path.join(homeDir, '.zsh', 'completions', '_apocryphon')
    case 'fish':
      return path.join(homeDir, '.config', 'fish', 'completions', 'apocryphon.fish')
  }
}

export function detectShell(env: NodeJS.ProcessEnv = process.env): Shell {
  const shell = path.basename(env.SHELL ?? '')
  return isShell(shell) ? shell : 'bash'
}
