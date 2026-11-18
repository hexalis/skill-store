import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
  SKILL_ID_PATTERN,
  applySkillUpdate,
  buildManifest,
  copyDirAtomic,
  isGitSource,
  lintSkillDir,
  listSkillFiles,
  pathExists,
  planSkillUpdate,
  recordSkillState,
  refreshPristine,
  type SkillLintResult,
} from '@apocryphon/core'
import { loadContext, saveState, syncContext } from '../lib/context.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { resolveUpdate } from '../lib/update-flow.js'
import { printIssues, printSyncReport } from '../lib/output.js'
import { expandHome } from '@apocryphon/core'

interface ImportOptions {
  id?: string
  force?: boolean
  keep?: boolean
  merge?: boolean
  trustScripts?: boolean
  sync?: boolean
}

async function locateSkillDir(base: string, wantedId?: string): Promise<string> {
  if (await pathExists(path.join(base, 'SKILL.md'))) return base

  if (wantedId) {
    const candidate = path.join(base, 'skills', wantedId)
    if (await pathExists(path.join(candidate, 'SKILL.md'))) return candidate
  }

  const skillsDir = path.join(base, 'skills')
  if (await pathExists(skillsDir)) {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    const candidates: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(skillsDir, entry.name)
      if (await pathExists(path.join(candidate, 'SKILL.md'))) candidates.push(candidate)
    }
    if (candidates.length === 1 && candidates[0]) return candidates[0]
    if (candidates.length > 1) {
      throw new Error(
        `Multiple skills found in ${skillsDir}. Use --id to choose one:\n${candidates
          .map((candidate) => `  ${path.basename(candidate)}`)
          .join('\n')}`,
      )
    }
  }

  throw new Error(`No SKILL.md found in ${base} (or ${path.join(base, 'skills')}).`)
}

function hasScripts(dir: string, files: string[]): boolean {
  void dir
  return files.some((rel) => rel.startsWith('scripts/'))
}

export function importCommand(): Command {
  const command = new Command('import')
    .description('Import a skill from a local path or a Git URL into the vault')
    .argument('<source>', 'Local skill directory or Git URL')
    .option('--id <id>', 'Override the skill id (defaults to the folder name)')
    .option('-f, --force', 'Ignore lint errors and overwrite conflicts with the imported copy')
    .option('--keep', 'Keep local changes when the skill already exists')
    .option('--merge', 'Three-way merge when the skill already exists')
    .option('--trust-scripts', 'Allow importing a skill that contains scripts/')
    .option('--no-sync', 'Do not refresh symlinks after importing')

  addGlobalOptions(command)

  return command.action(async (source: string, options: ImportOptions) => {
    await runSafely(async () => {
      const ui = uiFromArgv()
      const ctx = await loadContext()

      let baseDir: string
      let cleanup: string | null = null
      let sourceKind: 'local' | 'git' = 'local'

      if (isGitSource(source)) {
        sourceKind = 'git'
        const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'apocryphon-import-'))
        cleanup = temp
        const clone = spawnSync('git', ['clone', '--depth', '1', source, temp], {
          encoding: 'utf8',
          stdio: 'pipe',
        })
        if (clone.status !== 0) {
          throw new Error(`Could not clone ${source}:\n${clone.stderr}`)
        }
        baseDir = temp
      } else {
        baseDir = path.resolve(expandHome(source))
      }

      try {
        const skillDir = await locateSkillDir(baseDir, options.id)
        const id = options.id ?? path.basename(skillDir)
        if (!SKILL_ID_PATTERN.test(id)) {
          throw new Error(
            `"${id}" is not a portable skill id. Use --id to rename the imported skill.`,
          )
        }

        const files = await listSkillFiles(skillDir)
        if (hasScripts(skillDir, files) && !options.trustScripts) {
          if (!ui.interactive) {
            throw new Error(
              'This skill contains scripts/ and no --trust-scripts flag was provided. Re-run with --trust-scripts after reviewing them.',
            )
          }
          const answer = await p.confirm({
            message: `"${id}" contains scripts. Review them before trusting? Import anyway?`,
            initialValue: false,
          })
          if (p.isCancel(answer) || !answer) {
            p.cancel('Cancelled.')
            return
          }
        }

        const sourceLint: SkillLintResult = await lintSkillDir(skillDir)
        if (!sourceLint.ok && !options.force) {
          printIssues(sourceLint.issues)
          throw new Error(
            'The imported skill has lint errors. Fix them, or use --force to import anyway.',
          )
        }

        const sourceMeta = {
          type: sourceKind,
          ref: sourceKind === 'git' ? source : skillDir,
        } as const

        const destination = path.join(ctx.paths.vault, id)
        const existing = await pathExists(destination)

        if (!existing) {
          await copyDirAtomic(skillDir, destination)
          await refreshPristine(ctx.paths, id, skillDir)
          const manifest = await buildManifest(destination)
          recordSkillState(ctx.state, id, manifest, {
            version: sourceLint.frontmatter?.version,
            source: sourceMeta,
            customized: false,
          })
          await saveState(ctx)
          ui.success(`Imported ${pc.bold(id)} into ${destination}`)
        } else {
          const plan = await planSkillUpdate({
            paths: ctx.paths,
            id,
            sourceDir: skillDir,
            installed: ctx.state.skills[id],
            registryVersion: sourceLint.frontmatter?.version,
          })
          const decision = await resolveUpdate(ui, plan, {
            force: options.force,
            keep: options.keep,
            merge: options.merge,
          })
          if (!decision) {
            ui.info('Cancelled.')
            return
          }
          const applied = await applySkillUpdate({
            paths: ctx.paths,
            id,
            sourceDir: skillDir,
            plan,
            resolution: decision.resolution,
            state: ctx.state,
            version: sourceLint.frontmatter?.version,
            source: sourceMeta,
            fileChoices: decision.fileChoices,
          })
          await saveState(ctx)
          ui.success(
            `Imported ${pc.bold(id)} (${decision.resolution})${applied.conflicts.length > 0 ? pc.yellow(` — ${applied.conflicts.length} conflicts`) : ''}`,
          )
        }

        if (options.sync !== false) {
          const report = await syncContext(ctx, { reporter: ui.reporter() })
          printSyncReport(report)
        }
      } finally {
        if (cleanup) await fs.rm(cleanup, { recursive: true, force: true })
      }
    })
  })
}
