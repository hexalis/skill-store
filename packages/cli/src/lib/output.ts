import pc from 'picocolors'
import type {
  ContextBudget,
  LintIssue,
  SyncReport,
} from '@apocryphon/core'

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

export function heading(text: string): void {
  console.log(`\n${pc.bold(text)}`)
}

export function kv(label: string, value: string): void {
  console.log(`${pc.dim(label.padEnd(16))}${value}`)
}

export function bullet(text: string): void {
  console.log(`  ${pc.dim('•')} ${text}`)
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, Math.max(0, max - 1))}…`
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  )

  const renderRow = (row: string[]): string =>
    row
      .map((cell, index) => (cell ?? '').padEnd(widths[index] ?? 0))
      .join('  ')
      .replace(/\s+$/, '')

  const lines = [renderRow(headers), widths.map((width) => '─'.repeat(width)).join('  ')]
  for (const row of rows) lines.push(renderRow(row))
  return lines.join('\n')
}

export function levelLabel(level: ContextBudget['level']): string {
  if (level === 'green') return pc.green('GREEN')
  if (level === 'yellow') return pc.yellow('YELLOW')
  return pc.red('RED')
}

export function printBudget(budget: ContextBudget): void {
  const thresholds = `${budget.thresholds.warnAt}–${budget.thresholds.failAt} suggests trimming`
  console.log(
    `  Budget: ${budget.count} skill(s) · ~${budget.tokens} tokens · ${levelLabel(budget.level)} ${pc.dim(`(${thresholds})`)}`,
  )
}

export function printIssues(issues: LintIssue[], indent = '    '): void {
  for (const issue of issues) {
    const color = issue.level === 'error' ? pc.red : pc.yellow
    const tag = issue.level === 'error' ? 'error' : 'warn '
    console.log(`${indent}${color(tag)} ${pc.dim(`[${issue.code}]`)} ${issue.message}`)
  }
}

export function printSyncReport(report: SyncReport): void {
  const created = report.created.length
  const removed = report.removed.length
  const unchanged = report.unchanged.length

  console.log(
    `  Links: ${pc.green(`${created} created`)} · ${pc.dim(`${unchanged} unchanged`)} · ${pc.yellow(`${removed} removed`)}`,
  )

  if (report.exclude) {
    const state = report.exclude.changed ? pc.green('updated') : pc.dim('unchanged')
    console.log(
      `  Git exclude: ${state} ${pc.dim(report.exclude.file)} (${report.exclude.entries.length} entries)`,
    )
  }

  for (const skipped of report.skipped) {
    console.log(`  ${pc.yellow('skip')} ${skipped.path} — ${skipped.reason}`)
  }
  for (const warning of report.warnings) {
    console.log(`  ${pc.yellow('warn')} ${warning}`)
  }
}
