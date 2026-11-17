import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { initializeHome } from '../src/bootstrap.js'
import { resolvePaths } from '../src/paths.js'
import { collectStatus } from '../src/status.js'
import { emptyProjects } from '../src/store.js'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apocryphon-status-'))
  tempDirs.push(dir)
  return dir
}

async function writeSkill(vault: string, id: string): Promise<void> {
  const dir = path.join(vault, id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    [
      '---',
      `name: ${id}`,
      'description: Use it whenever the status test needs a skill. Do not use it elsewhere.',
      '---',
      '',
      'Body.',
    ].join('\n'),
    'utf8',
  )
}

after(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('status report', () => {
  it('counts only installed skills in the context budget', async () => {
    const root = await makeTempDir()
    const paths = resolvePaths(path.join(root, 'state'))
    const initialized = await initializeHome({
      paths,
      enabledClients: ['claude'],
      homeDir: path.join(root, 'user'),
    })

    await writeSkill(paths.vault, 'alpha')
    initialized.state.globalSkills = ['alpha', 'not-installed']

    const status = await collectStatus({
      paths,
      config: initialized.config,
      state: initialized.state,
      projects: emptyProjects(),
      projectRoot: null,
      homeDir: path.join(root, 'user'),
    })

    assert.equal(status.budget.count, 1)
    assert.deepEqual(status.active.missingSkills, ['not-installed'])
    assert.ok(status.budget.tokens >= 1)
  })
})
