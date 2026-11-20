import path from 'node:path'
import * as p from '@clack/prompts'
import {
  lintSkillDir,
  pathExists,
} from '@hexalis/skill-store-core'
import { toggleItems } from './actions.js'
import { printSyncReport } from './output.js'
import { previewText } from './skill-view.js'
import type { CliContext } from './context.js'
import type { Ui } from './ui.js'
import { runInstall } from '../commands/install.js'

export async function previewSkill(ctx: CliContext, id: string): Promise<void> {
  const dir = path.join(ctx.paths.vault, id)
  if (!(await pathExists(path.join(dir, 'SKILL.md')))) return
  const lint = await lintSkillDir(dir)
  p.note(previewText(lint, 12), `Preview · ${id}`)
}

async function toggle(
  ctx: CliContext,
  id: string,
  options: { global: boolean; enable: boolean },
  ui: Ui,
): Promise<void> {
  const result = await toggleItems(ctx, [id], options)
  if (result.report) printSyncReport(result.report)
  if (result.changed) {
    ui.success(
      `${options.enable ? 'Enabled' : 'Disabled'} ${id}${options.global ? ' globally' : ' in this project'}.`,
    )
  } else {
    ui.info('Nothing to do: the skill was already in that state.')
  }
}

/**
 * Show a skill preview and a small action menu. Used by `find` and `browse`.
 */
export async function promptSkillAction(
  ctx: CliContext,
  id: string,
  ui: Ui,
  installed: boolean,
): Promise<void> {
  if (installed) await previewSkill(ctx, id)

  const options = installed
    ? [
        { value: 'enable-project', label: 'Enable in this project' },
        { value: 'enable-global', label: 'Enable globally' },
        { value: 'disable-project', label: 'Disable in this project' },
        { value: 'disable-global', label: 'Disable globally' },
        { value: 'cancel', label: 'Cancel' },
      ]
    : [
        { value: 'install', label: 'Install from the registry' },
        { value: 'cancel', label: 'Cancel' },
      ]

  const action = await p.select({ message: `${id}: what next?`, options })
  if (p.isCancel(action) || action === 'cancel') return

  switch (action) {
    case 'enable-project':
      await toggle(ctx, id, { global: false, enable: true }, ui)
      break
    case 'enable-global':
      await toggle(ctx, id, { global: true, enable: true }, ui)
      break
    case 'disable-project':
      await toggle(ctx, id, { global: false, enable: false }, ui)
      break
    case 'disable-global':
      await toggle(ctx, id, { global: true, enable: false }, ui)
      break
    case 'install':
      await runInstall([id], {}, ui)
      break
  }
}
