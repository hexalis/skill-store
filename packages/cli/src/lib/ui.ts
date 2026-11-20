import * as p from '@clack/prompts'
import type { ProgressEvent, ProgressReporter } from '@hexalis/skill-store-core'
import { c } from './colors.js'
import { isInteractive } from './run.js'

export interface UiOptions {
  quiet?: boolean
  verbose?: boolean
  json?: boolean
  yes?: boolean
}

export interface SpinnerHandle {
  message(text: string): void
  stop(text?: string): void
}

export interface Ui {
  readonly options: UiOptions
  readonly interactive: boolean
  info(message: string): void
  success(message: string): void
  warn(message: string): void
  error(message: string): void
  debug(message: string): void
  spinner(text: string): SpinnerHandle
  task<T>(title: string, fn: () => Promise<T>): Promise<T>
  confirm(message: string): Promise<boolean>
  reporter(): ProgressReporter
}

class NoopSpinner implements SpinnerHandle {
  constructor(private readonly ui: Ui) {}
  message(text: string): void {
    this.ui.debug(text)
  }
  stop(text?: string): void {
    if (text) this.ui.debug(text)
  }
}

class ClackSpinner implements SpinnerHandle {
  private readonly spinner = p.spinner()

  constructor(text: string) {
    this.spinner.start(text)
  }
  message(text: string): void {
    this.spinner.message(text)
  }
  stop(text?: string): void {
    this.spinner.stop(text)
  }
}

export function createUi(options: UiOptions = {}): Ui {
  const interactive = isInteractive()
  const quiet = options.quiet ?? false
  const json = options.json ?? false
  const verbose = options.verbose ?? false

  const ui: Ui = {
    options,
    interactive,
    info(message) {
      if (quiet) return
      ;(json ? console.error : console.log)(message)
    },
    success(message) {
      if (quiet) return
      ;(json ? console.error : console.log)(`${c.green('✔')} ${message}`)
    },
    warn(message) {
      console.error(`${c.yellow('warn')} ${message}`)
    },
    error(message) {
      console.error(`${c.red('error')} ${message}`)
    },
    debug(message) {
      if (!verbose || quiet) return
      console.error(`${c.dim('debug')} ${message}`)
    },
    spinner(text) {
      if (!interactive || json || quiet) return new NoopSpinner(ui)
      return new ClackSpinner(text)
    },
    async task<T>(title: string, fn: () => Promise<T>): Promise<T> {
      const spinner = ui.spinner(title)
      try {
        const result = await fn()
        spinner.stop(title)
        return result
      } catch (error) {
        spinner.stop(`${title} ${c.red('failed')}`)
        throw error
      }
    },
    async confirm(message: string): Promise<boolean> {
      if (options.yes) {
        ui.debug(`${message} → yes (--yes)`)
        return true
      }
      if (!interactive) {
        throw new Error(
          `Confirmation required: ${message}\nRe-run with --yes to accept it in a non-interactive environment.`,
        )
      }
      const answer = await p.confirm({ message })
      if (p.isCancel(answer)) return false
      return answer
    },
    reporter(): ProgressReporter {
      const spinners = new Map<string, SpinnerHandle>()
      return {
        emit(event: ProgressEvent) {
          switch (event.type) {
            case 'start': {
              const spinner = ui.spinner(event.message)
              spinners.set(event.step, spinner)
              break
            }
            case 'update': {
              spinners.get(event.step)?.message(event.message)
              break
            }
            case 'succeed': {
              spinners.get(event.step)?.stop(event.message)
              spinners.delete(event.step)
              break
            }
            case 'fail': {
              spinners.get(event.step)?.stop(`${c.red(event.message)}`)
              spinners.delete(event.step)
              break
            }
          }
        },
      }
    },
  }

  return ui
}
