import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { initializeHome } from '../src/bootstrap.js'
import { resolvePaths } from '../src/paths.js'
import { readConfig, writeConfig, writeState } from '../src/store.js'
import { syncSkills } from '../src/sync-engine.js'
import { readGitExclude } from '../src/git-exclude.js'
import type { ProjectEntry, State } from '../src/schemas.js'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
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
      'description: Use it whenever the sync test needs a skill. Do not use it elsewhere.',
      '---',
      '',
      `# ${id}`,
      '',
      'Body.',
    ].join('\n'),
    'utf8',
  )
}

function git(cwd: string, args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}

after(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function setup(options: { clients: Array<'claude' | 'cursor' | 'opencode'> }) {
  const home = await makeTempDir('apocryphon-sync-home-')
  const userHome = path.join(home, 'user')
  const project = path.join(home, 'project')
  await fs.mkdir(userHome, { recursive: true })
  await fs.mkdir(project, { recursive: true })

  const paths = resolvePaths(path.join(home, 'state'))
  const initialized = await initializeHome({
    paths,
    enabledClients: options.clients,
    homeDir: userHome,
  })

  await writeSkill(paths.vault, 'alpha')
  await writeSkill(paths.vault, 'beta')

  const init = git(project, ['init', '--quiet'])
  assert.equal(init.status, 0, init.stderr)

  return { home, userHome, project, paths, config: initialized.config, state: initialized.state }
}

function entry(skills: string[]): ProjectEntry {
  return { skills, packs: [], updatedAt: new Date().toISOString() }
}

describe('sync engine', () => {
  it('creates global and project symlinks and keeps git clean', async () => {
    const { userHome, project, paths, config, state } = await setup({
      clients: ['claude'],
    })

    const projectEntry = entry(['beta'])
    state.globalSkills = ['alpha']

    const report = await syncSkills({
      paths,
      config,
      state,
      projectRoot: project,
      entry: projectEntry,
      homeDir: userHome,
    })

    const globalLink = path.join(userHome, '.claude', 'skills', 'alpha')
    const projectLink = path.join(project, '.claude', 'skills', 'beta')

    assert.equal((await fs.lstat(globalLink)).isSymbolicLink(), true)
    assert.equal((await fs.lstat(projectLink)).isSymbolicLink(), true)
    assert.equal(report.created.length >= 2, true)

    const exclude = await readGitExclude(project)
    assert.ok(exclude?.entries.includes('.claude/skills/beta'))

    const status = git(project, ['status', '--porcelain'])
    assert.equal(status.status, 0)
    assert.equal(status.stdout.trim(), '')
  })

  it('removes managed links and the exclude block when skills are disabled', async () => {
    const { userHome, project, paths, config, state } = await setup({
      clients: ['claude'],
    })

    await syncSkills({
      paths,
      config,
      state,
      projectRoot: project,
      entry: entry(['beta']),
      homeDir: userHome,
    })

    const report = await syncSkills({
      paths,
      config,
      state,
      projectRoot: project,
      entry: entry([]),
      homeDir: userHome,
    })

    const projectLink = path.join(project, '.claude', 'skills', 'beta')
    await assert.rejects(fs.lstat(projectLink))
    assert.ok(report.removed.includes(projectLink))

    const exclude = await readGitExclude(project)
    assert.deepEqual(exclude?.entries, [])
  })

  it('dedupes OpenCode when Claude Code already exposes the skill', async () => {
    const { userHome, project, paths, config, state } = await setup({
      clients: ['claude', 'opencode'],
    })
    state.globalSkills = ['alpha']

    await syncSkills({
      paths,
      config,
      state,
      projectRoot: project,
      entry: entry([]),
      homeDir: userHome,
    })

    assert.equal(
      (await fs.lstat(path.join(userHome, '.claude', 'skills', 'alpha'))).isSymbolicLink(),
      true,
    )
    await assert.rejects(fs.lstat(path.join(userHome, '.config', 'opencode', 'skills', 'alpha')))
  })

  it('moves the link to OpenCode after Claude Code is disabled', async () => {
    const { userHome, project, paths, state } = await setup({
      clients: ['claude', 'opencode'],
    })
    state.globalSkills = ['alpha']

    const initialized = await readConfig(paths.config)
    await syncSkills({
      paths,
      config: initialized,
      state,
      projectRoot: project,
      entry: entry([]),
      homeDir: userHome,
    })

    const updatedConfig = {
      ...initialized,
      clients: {
        ...initialized.clients,
        claude: { ...initialized.clients.claude, enabled: false },
      },
    }
    await writeConfig(paths.config, updatedConfig)
    await writeState(paths.state, state as State)

    await syncSkills({
      paths,
      config: updatedConfig,
      state,
      projectRoot: project,
      entry: entry([]),
      homeDir: userHome,
    })

    await assert.rejects(fs.lstat(path.join(userHome, '.claude', 'skills', 'alpha')))
    assert.equal(
      (await fs.lstat(path.join(userHome, '.config', 'opencode', 'skills', 'alpha'))).isSymbolicLink(),
      true,
    )
  })

  it('never deletes real directories that collide with a skill id', async () => {
    const { userHome, project, paths, config, state } = await setup({
      clients: ['claude'],
    })
    state.globalSkills = ['alpha']

    const colliding = path.join(userHome, '.claude', 'skills', 'alpha')
    await fs.mkdir(colliding, { recursive: true })
    await fs.writeFile(path.join(colliding, 'notes.md'), 'user data', 'utf8')

    const report = await syncSkills({
      paths,
      config,
      state,
      projectRoot: project,
      entry: entry([]),
      homeDir: userHome,
    })

    assert.equal((await fs.readFile(path.join(colliding, 'notes.md'), 'utf8')), 'user data')
    assert.ok(report.skipped.some((skip) => skip.path === colliding))
  })
})
