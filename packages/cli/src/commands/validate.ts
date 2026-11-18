import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import {
  lintSkillDir,
  type SkillLintOptions,
  type SkillLintResult,
} from '@apocryphon/core'
import { loadContext, requireRegistry } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { printIssues, printJson } from '../lib/output.js'

interface ValidateOptions {
  registry?: boolean
  strict?: boolean
  json?: boolean
}

async function hasSkillFile(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(dir, 'SKILL.md'))).isFile()
  } catch {
    return false
  }
}

async function lintTarget(target: string, options: SkillLintOptions): Promise<SkillLintResult[]> {
  const resolved = path.resolve(target)
  if (await hasSkillFile(resolved)) return [await lintSkillDir(resolved, options)]

  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(resolved, { withFileTypes: true })
  } catch {
    throw new Error(`Path not found: ${resolved}`)
  }

  const results: SkillLintResult[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const child = path.join(resolved, entry.name)
    if (await hasSkillFile(child)) results.push(await lintSkillDir(child, options))
  }

  if (results.length === 0) {
    throw new Error(`No SKILL.md found in ${resolved} (or its immediate subdirectories).`)
  }

  return results
}

export function validateCommand(): Command {
  const command = new Command('validate')
    .description('Lint skills in the vault, the registry or an arbitrary path')
    .argument('[paths...]', 'Skill directories (defaults to the whole vault)')
    .option('--registry', 'Validate every skill in the configured registry')
    .option('--strict', 'Require category and tags; unknown tags are errors')
    .option('--json', 'Print machine-readable JSON')

  addGlobalOptions(command)

  return command.action(async (targets: string[], options: ValidateOptions) => {
    await runSafely(async () => {
      const ui = uiFromArgv(Boolean(options.json))
      const ctx = await loadContext()
      const results: SkillLintResult[] = []

      if (options.registry) {
        const handle = await requireRegistry(ctx)
        const taxonomy = handle.index.taxonomy
        const lintOptions: SkillLintOptions = {
          requireCategory: options.strict,
          requireTags: options.strict,
          taxonomyTags: taxonomy?.tags.map((tag) => tag.id) ?? [],
          unknownTagLevel: options.strict ? 'error' : 'warning',
        }
        for (const entry of handle.index.skills) {
          results.push(
            await lintSkillDir(path.resolve(handle.location.dir, entry.path), lintOptions),
          )
        }
      } else if (targets.length > 0) {
        const lintOptions: SkillLintOptions = {
          requireCategory: options.strict,
          requireTags: options.strict,
        }
        for (const target of targets) results.push(...(await lintTarget(target, lintOptions)))
      } else {
        const entries = await fs.readdir(ctx.paths.vault, { withFileTypes: true }).catch(() => [])
        const lintOptions: SkillLintOptions = {
          requireCategory: options.strict,
          requireTags: options.strict,
        }
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          results.push(await lintSkillDir(path.join(ctx.paths.vault, entry.name), lintOptions))
        }
      }

      if (results.length === 0) {
        ui.info('Nothing to validate.')
        return
      }

      if (options.json) {
        printJson(
          results.map((result) => ({
            id: result.id,
            dir: result.dir,
            ok: result.ok,
            issues: result.issues,
          })),
        )
      } else {
        for (const result of results) {
          const errors = result.issues.filter((issue) => issue.level === 'error')
          const warnings = result.issues.filter((issue) => issue.level === 'warning')
          const label = result.ok
            ? warnings.length > 0
              ? pc.yellow('ok with warnings')
              : pc.green('ok')
            : pc.red('invalid')
          ui.info(
            `\n${pc.bold(result.id)} ${pc.dim(result.dir)} — ${label} ${pc.dim(`(${errors.length} errors, ${warnings.length} warnings)`)}`,
          )
          if (result.issues.length > 0) printIssues(result.issues)
        }
      }

      const failed = results.filter((result) => !result.ok)
      if (failed.length > 0) {
        process.exitCode = 1
        if (!options.json) ui.error(`${failed.length} skill(s) failed validation.`)
      } else if (!options.json) {
        ui.success('All skills passed validation.')
      }
    })
  })
}
