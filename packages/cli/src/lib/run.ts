import pc from 'picocolors'

export async function runSafely(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${pc.red('error')} ${message}`)
    process.exitCode = 1
  }
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

export function requireInteractive(command: string): void {
  if (isInteractive()) return
  throw new Error(
    `\`${command}\` is interactive and needs a TTY. Use the non-interactive commands instead (for example \`apocryphon enable <skills...>\`).`,
  )
}
