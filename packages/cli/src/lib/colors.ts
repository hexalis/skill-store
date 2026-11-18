import { createColors } from 'picocolors'

const argv = process.argv
const disabled = argv.includes('--no-color') || Boolean(process.env.NO_COLOR)

/**
 * Shared color instance. `--no-color` and `NO_COLOR` force colors off; otherwise
 * picocolors auto-detects TTY support (so piping to a file stays clean).
 */
export const c = createColors(disabled ? false : undefined)
