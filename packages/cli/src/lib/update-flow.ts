import * as p from '@clack/prompts'
import {
  summarizeDiff,
  type FileChoices,
  type FileResolution,
  type SkillUpdatePlan,
  type UpdateResolution,
} from '@hexalis/skill-store-core'
import { c } from './colors.js'
import type { Ui } from './ui.js'

export interface ResolutionOptions {
  force?: boolean
  keep?: boolean
  merge?: boolean
}

export interface ResolvedUpdate {
  resolution: UpdateResolution
  fileChoices?: FileChoices
}

export function planSummary(plan: SkillUpdatePlan): string {
  const parts = [
    `${c.bold(plan.id)}`,
    plan.customized ? c.yellow('customized') : c.green('clean'),
    plan.updateAvailable ? c.cyan('update available') : c.dim('up to date'),
  ]
  if (plan.baseline === 'unknown') parts.push(c.yellow('baseline unknown'))
  if (plan.overlap.length > 0) parts.push(c.red(`${plan.overlap.length} overlapping file(s)`))
  return parts.join(' · ')
}

export function printPlan(ui: Ui, plan: SkillUpdatePlan): void {
  ui.info(`\n${planSummary(plan)}`)
  const versions = [
    plan.installedVersion ? `installed ${plan.installedVersion}` : 'installed ?',
    plan.registryVersion ? `registry ${plan.registryVersion}` : 'registry ?',
  ].join(' → ')
  ui.debug(versions)

  if (plan.local && plan.local.hasChanges) {
    ui.info(`  ${c.dim('Local changes:')} ${summarizeDiff(plan.local)}`)
    const files = [...plan.local.changedPaths].slice(0, 6)
    if (files.length > 0) ui.info(`    ${files.join(', ')}${plan.local.changedPaths.size > 6 ? '…' : ''}`)
  }
  if (plan.upstream && plan.upstream.hasChanges) {
    ui.info(`  ${c.dim('Upstream changes:')} ${summarizeDiff(plan.upstream)}`)
    const files = [...plan.upstream.changedPaths].slice(0, 6)
    if (files.length > 0) ui.info(`    ${files.join(', ')}${plan.upstream.changedPaths.size > 6 ? '…' : ''}`)
  }
  if (plan.overlap.length > 0) {
    ui.info(`  ${c.dim('Changed on both sides:')} ${plan.overlap.join(', ')}`)
  }
  ui.info(`  ${c.dim(`Inspect full diffs with: skill-store diff ${plan.id}`)}`)
}

async function askPerFile(plan: SkillUpdatePlan): Promise<FileChoices | null> {
  const choices: FileChoices = {}
  for (const rel of plan.overlap) {
    const answer = await p.select<FileResolution>({
      message: `${rel}: which version do you want?`,
      options: [
        { value: 'merge', label: 'Merge both', hint: 'three-way merge, conflicts keep markers' },
        { value: 'ours', label: 'Keep mine', hint: 'discard the registry change for this file' },
        { value: 'theirs', label: 'Take registry', hint: 'discard my changes for this file' },
      ],
      initialValue: 'merge',
    })
    if (p.isCancel(answer)) return null
    choices[rel] = answer
  }
  return choices
}

/**
 * Decide how to update a customized skill.
 *
 * Flags win over prompts. Without a TTY (and without flags) this throws so a CI
 * run can never overwrite user changes silently.
 */
export async function resolveUpdate(
  ui: Ui,
  plan: SkillUpdatePlan,
  options: ResolutionOptions = {},
): Promise<ResolvedUpdate | null> {
  if (!plan.updateAvailable) return { resolution: 'keep' }

  if (options.force) return { resolution: 'overwrite' }
  if (options.keep) return { resolution: 'keep' }
  if (options.merge) return { resolution: 'merge' }

  if (!ui.interactive) {
    throw new Error(
      [
        `Skill "${plan.id}" has local changes and an update is available.`,
        'Refusing to overwrite in a non-interactive environment. Choose one:',
        `  --force    registry wins (a backup is created)`,
        `  --keep     keep your version and skip this update`,
        `  --merge    three-way merge`,
        `Or run \`skill-store diff ${plan.id}\` to inspect the changes first.`,
      ].join('\n'),
    )
  }

  printPlan(ui, plan)

  const optionsList: Array<{ value: string; label: string; hint?: string }> = [
    { value: 'merge', label: 'Merge changes', hint: 'keep non-conflicting changes from both sides' },
    { value: 'overwrite', label: 'Take the registry version', hint: 'a backup is created first' },
    { value: 'keep', label: 'Keep my version', hint: 'skip this update' },
  ]
  if (plan.overlap.length > 0) {
    optionsList.push({
      value: 'per-file',
      label: 'Choose per file',
      hint: `${plan.overlap.length} file(s) changed on both sides`,
    })
  }
  optionsList.push({ value: 'cancel', label: 'Cancel' })

  const answer = await p.select({
    message: `How do you want to update ${c.bold(plan.id)}?`,
    options: optionsList,
  })
  if (p.isCancel(answer) || answer === 'cancel') return null

  if (answer === 'per-file') {
    const fileChoices = await askPerFile(plan)
    if (!fileChoices) return null
    return { resolution: 'merge', fileChoices }
  }

  return { resolution: answer as UpdateResolution }
}
