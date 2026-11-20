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
      return `# skill-store bash completion
_skill_store_complete() {
  local words=("\${COMP_WORDS[@]:1}")
  local candidates
  candidates="$(skill-store __complete words "\${words[@]}" 2>/dev/null)"
  COMPREPLY=($(compgen -W "$candidates" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -F _skill_store_complete skill-store hss
`
    case 'zsh':
      return `#compdef skill-store hss
# skill-store zsh completion
_skill_store() {
  local -a candidates
  candidates=("\${(@f)$(skill-store __complete words "\${words[2,-1]}" 2>/dev/null)}")
  compadd -- "\${candidates[@]}"
}
compdef _skill_store skill-store hss
`
    case 'fish':
      return `# skill-store fish completion
function __skill_store_complete
  skill-store __complete words (commandline -opc)[2..-1] 2>/dev/null
end
complete -c skill-store -f -a '(__skill_store_complete)'
complete -c hss -f -a '(__skill_store_complete)'
`
  }
}

export function completionInstallPath(shell: Shell, homeDir = os.homedir()): string {
  switch (shell) {
    case 'bash':
      return path.join(homeDir, '.local', 'share', 'bash-completion', 'completions', 'skill-store')
    case 'zsh':
      return path.join(homeDir, '.zsh', 'completions', '_skill-store')
    case 'fish':
      return path.join(homeDir, '.config', 'fish', 'completions', 'skill-store.fish')
  }
}

export function detectShell(env: NodeJS.ProcessEnv = process.env): Shell {
  const shell = path.basename(env.SHELL ?? '')
  return isShell(shell) ? shell : 'bash'
}
