import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
  SKILL_CATEGORIES,
  SKILL_ID_PATTERN,
  buildManifest,
  copyDirAtomic,
  lintSkillDir,
  pathExists,
  recordSkillState,
  type SkillCategory,
} from '@hexalis/skill-store-core'
import {
  loadContext,
  saveState,
  syncContext,
} from '../lib/context.js'
import { toggleItems } from '../lib/actions.js'
import { addGlobalOptions, uiFromArgv } from '../lib/options.js'
import { runSafely } from '../lib/run.js'
import { printIssues, printSyncReport } from '../lib/output.js'

interface NewOptions {
  category?: string
  tags?: string
  description?: string
  references?: boolean
  scripts?: boolean
  enable?: boolean
  global?: boolean
}

function humanize(id: string): string {
  return id.replace(/-/g, ' ')
}

function defaultDescription(id: string): string {
  return [
    `Use this skill whenever the user needs help with ${humanize(id)} and the project-specific conventions apply.`,
    'Do not use it for unrelated tasks.',
  ].join(' ')
}

function template(options: {
  id: string
  category: string
  tags: string[]
  description: string
  references: boolean
  scripts: boolean
}): string {
  const { id, category, tags, description, references, scripts } = options
  const lines = [
    '---',
    `name: ${id}`,
    'description: >',
    ...description
      .split(/\r?\n/)
      .map((line) => `  ${line.trim()}`),
    `category: ${category}`,
    `tags: [${tags.join(', ')}]`,
    'version: 0.1.0',
    '---',
    '',
    `# ${id}`,
    '',
    '## When to use',
    '',
    `- ${humanize(id)} tasks explicitly covered by this skill.`,
    '- Situations where the project conventions below apply.',
    '',
    '## Instructions',
    '',
    '1. Inspect the relevant files before making changes.',
    '2. Follow the project conventions and keep changes minimal.',
    '3. Verify the result before finishing.',
    '',
    '## Verification',
    '',
    'Run the project checks (tests, typecheck or linter) before declaring the task done.',
  ]

  if (references) {
    lines.push(
      '',
      '## References',
      '',
      'Read `references/notes.md` when you need additional context or examples.',
    )
  }
  if (scripts) {
    lines.push(
      '',
      '## Scripts',
      '',
      'Run `./scripts/check.sh` before finishing and fix any non-zero exit.',
    )
  }

  return `${lines.join('\n')}\n`
}

export function newCommand(): Command {
  const command = new Command('new')
    .description('Create a new local skill in the vault with a valid template')
    .argument('<id>', 'Skill id (lowercase kebab-case)')
    .option('-c, --category <category>', `Category (${SKILL_CATEGORIES.join(', ')})`)
    .option('-t, --tags <list>', 'Comma-separated tags')
    .option('-d, --description <text>', 'Description with explicit triggers')
    .option('--references', 'Create a references/ directory')
    .option('--scripts', 'Create an executable scripts/check.sh')
    .option('--enable', 'Activate the skill after creating it')
    .option('-g, --global', 'With --enable, activate it globally')

  addGlobalOptions(command)

  return command.action(async (id: string, options: NewOptions) => {
    await runSafely(async () => {
      const ui = uiFromArgv()
      const ctx = await loadContext()

      if (!SKILL_ID_PATTERN.test(id)) {
        throw new Error(
          `"${id}" is not a portable skill id. Use lowercase letters, digits and hyphens (for example: my-skill).`,
        )
      }

      const vaultDir = path.join(ctx.paths.vault, id)
      if (await pathExists(vaultDir)) {
        throw new Error(`Skill "${id}" already exists in the vault.`)
      }

      let category = options.category
      if (!category) {
        if (!ui.interactive) {
          throw new Error(
            `Missing --category. Choose one of: ${SKILL_CATEGORIES.join(', ')} (required in non-interactive mode).`,
          )
        }
        const answer = await p.select<SkillCategory>({
          message: 'Category',
          options: SKILL_CATEGORIES.map((value) => ({ value, label: value })),
        })
        if (p.isCancel(answer)) {
          p.cancel('Cancelled.')
          return
        }
        category = answer
      }
      if (!(SKILL_CATEGORIES as readonly string[]).includes(category)) {
        throw new Error(
          `Invalid category "${category}". Choose one of: ${SKILL_CATEGORIES.join(', ')}.`,
        )
      }

      let tags = (options.tags ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)

      if (tags.length === 0) {
        if (!ui.interactive) {
          throw new Error('Missing --tags. Provide at least one tag (comma-separated).')
        }
        const answer = await p.text({
          message: 'Tags (comma-separated)',
          placeholder: 'workflow, project',
          validate: (value) =>
            (value ?? '')
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean).length === 0
              ? 'Add at least one tag.'
              : undefined,
        })
        if (p.isCancel(answer)) {
          p.cancel('Cancelled.')
          return
        }
        tags = answer
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      }

      const description = options.description?.trim() || defaultDescription(id)

      const vaultRoot = path.join(ctx.paths.vault, id)
      await fs.mkdir(vaultRoot, { recursive: true })
      await fs.writeFile(
        path.join(vaultRoot, 'SKILL.md'),
        template({
          id,
          category,
          tags,
          description,
          references: Boolean(options.references),
          scripts: Boolean(options.scripts),
        }),
        'utf8',
      )

      if (options.references) {
        await fs.mkdir(path.join(vaultRoot, 'references'), { recursive: true })
        await fs.writeFile(
          path.join(vaultRoot, 'references', 'notes.md'),
          '# Notes\n\nAdd examples, schemas or long documentation here.\n',
          'utf8',
        )
      }

      if (options.scripts) {
        const scriptsDir = path.join(vaultRoot, 'scripts')
        await fs.mkdir(scriptsDir, { recursive: true })
        const script = path.join(scriptsDir, 'check.sh')
        await fs.writeFile(
          script,
          '#!/usr/bin/env bash\n# Replace this with a deterministic project check.\nset -euo pipefail\necho "check.sh: nothing to verify yet"\n',
          'utf8',
        )
        await fs.chmod(script, 0o755)
      }

      await copyDirAtomic(vaultRoot, path.join(ctx.paths.pristine, id))
      const manifest = await buildManifest(vaultRoot)
      recordSkillState(ctx.state, id, manifest, {
        version: '0.1.0',
        source: { type: 'local', ref: null },
        customized: false,
      })
      await saveState(ctx)

      const lint = await lintSkillDir(vaultRoot)
      ui.success(`Created ${pc.bold(id)} at ${vaultRoot}`)
      if (lint.issues.length > 0) printIssues(lint.issues)
      if (!lint.ok) {
        process.exitCode = 1
        return
      }

      if (options.enable) {
        const result = await toggleItems(ctx, [id], {
          global: Boolean(options.global),
          enable: true,
        })
        if (result.report) printSyncReport(result.report)
        ui.success(`Activated ${id}${options.global ? ' globally' : ' in this project'}.`)
      } else {
        ui.info(
          `Next: \`skill-store enable ${id}\`, \`skill-store enable --global ${id}\`, or \`skill-store use\`.`,
        )
      }

      const report = await syncContext(ctx, { reporter: ui.reporter() })
      printSyncReport(report)
    })
  })
}
