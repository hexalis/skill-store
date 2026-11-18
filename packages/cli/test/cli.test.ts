import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const catalogDir = fileURLToPath(new URL('../../../catalog', import.meta.url))
const tsxLoader = import.meta.resolve('tsx')

let sandbox: string
let userHome: string
let project: string

function apocryphonHome(): string {
  return path.join(userHome, '.apocryphon')
}

interface RunResult {
  status: number | null
  stdout: string
  stderr: string
}

function run(args: string[], options: { cwd?: string; stdin?: string } = {}): RunResult {
  const result = spawnSync(process.execPath, ['--import', tsxLoader, cliEntry, ...args], {
    cwd: options.cwd ?? project,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: userHome,
      APOCRYPHON_HOME: apocryphonHome(),
      NO_COLOR: '1',
    },
    input: options.stdin,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function git(args: string[], cwd = project): RunResult {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target)
    return true
  } catch {
    return false
  }
}

async function isSymlink(target: string): Promise<boolean> {
  try {
    return (await fs.lstat(target)).isSymbolicLink()
  } catch {
    return false
  }
}

before(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'apocryphon-cli-'))
  userHome = path.join(sandbox, 'user')
  project = path.join(sandbox, 'project')
  await fs.mkdir(userHome, { recursive: true })
  await fs.mkdir(project, { recursive: true })

  const init = git(['init', '--quiet'])
  assert.equal(init.status, 0, init.stderr)
})

after(async () => {
  await fs.rm(sandbox, { recursive: true, force: true })
})

describe('apocryphon cli', () => {
  it('initializes with a local registry', async () => {
    const result = run(['init', '--registry', catalogDir, '--clients', 'claude', '--yes'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Apocryphon initialized/)

    assert.equal(await exists(path.join(apocryphonHome(), 'config.json')), true)
    assert.equal(await exists(path.join(apocryphonHome(), 'state.json')), true)
    assert.equal(await exists(path.join(apocryphonHome(), 'vault')), true)
    assert.equal(await exists(path.join(apocryphonHome(), 'pristine')), true)
    assert.equal(await exists(path.join(apocryphonHome(), 'backups')), true)
  })

  it('searches the catalog with fuzzy ranking', () => {
    const result = run(['search', 'review'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /fixture-review/)
    assert.match(result.stdout, /Score/)
  })

  it('installs skills from the registry', async () => {
    const result = run(['install', 'fixture-planning', 'fixture-review'])
    assert.equal(result.status, 0, result.stderr)

    for (const id of ['fixture-planning', 'fixture-review']) {
      assert.equal(
        await exists(path.join(apocryphonHome(), 'vault', id, 'SKILL.md')),
        true,
      )
      assert.equal(
        await exists(path.join(apocryphonHome(), 'pristine', id, 'SKILL.md')),
        true,
      )
    }
  })

  it('rejects unknown skills with a helpful message', () => {
    const result = run(['install', 'does-not-exist'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /not found in the registry/)
  })

  it('enables a global skill and creates only the Claude symlink', async () => {
    const result = run(['enable', '--global', 'fixture-planning'])
    assert.equal(result.status, 0, result.stderr)

    const link = path.join(userHome, '.claude', 'skills', 'fixture-planning')
    assert.equal(await isSymlink(link), true)
    assert.equal(
      await exists(path.join(userHome, '.config', 'opencode', 'skills', 'fixture-planning')),
      false,
    )
  })

  it('enables a project skill and keeps git status clean', async () => {
    const result = run(['enable', 'fixture-review'])
    assert.equal(result.status, 0, result.stderr)

    const link = path.join(project, '.claude', 'skills', 'fixture-review')
    assert.equal(await isSymlink(link), true)

    const exclude = await fs.readFile(path.join(project, '.git', 'info', 'exclude'), 'utf8')
    assert.match(exclude, /\.claude\/skills\/fixture-review/)

    const status = git(['status', '--porcelain'])
    assert.equal(status.status, 0)
    assert.equal(status.stdout.trim(), '')
  })

  it('reports status as JSON with customization fields', () => {
    const result = run(['status', '--json'])
    assert.equal(result.status, 0, result.stderr)

    const status = JSON.parse(result.stdout) as {
      active: { global: string[]; project: string[] }
      budget: { level: string }
      exclude: { entries: string[] } | null
      categoryCounts: Record<string, number>
      skills: Array<{ id: string; customized: boolean; updateAvailable: boolean }>
    }

    assert.ok(status.active.global.includes('fixture-planning'))
    assert.ok(status.active.project.includes('fixture-review'))
    assert.equal(status.exclude?.entries.length, 1)
    assert.ok(['green', 'yellow', 'red'].includes(status.budget.level))
    assert.equal(typeof status.categoryCounts.workflow, 'number')
    assert.ok(status.skills.every((row) => typeof row.customized === 'boolean'))
  })

  it('lists installed skills as JSON', () => {
    const result = run(['list', '--json'])
    assert.equal(result.status, 0, result.stderr)
    const rows = JSON.parse(result.stdout) as Array<{ id: string; installed: boolean }>
    assert.equal(rows.length, 2)
    assert.ok(rows.every((row) => row.installed))
  })

  it('filters list by category', () => {
    const result = run(['list', '--category', 'domain'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /fixture-review/)
    assert.doesNotMatch(result.stdout, /fixture-planning/)
  })

  it('validates the vault successfully', () => {
    const result = run(['validate'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /All skills passed validation/)
  })

  it('validates the registry in strict mode', () => {
    const result = run(['validate', '--registry', '--strict'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /All skills passed validation/)
  })

  it('applies a pack and expands it into project symlinks', async () => {
    const result = run(['pack', 'apply', 'fixtures'])
    assert.equal(result.status, 0, result.stderr)

    for (const id of ['fixture-planning', 'fixture-review']) {
      assert.equal(await isSymlink(path.join(project, '.claude', 'skills', id)), true)
    }

    const status = JSON.parse(run(['status', '--json']).stdout) as {
      active: { project: string[] }
      budget: { count: number }
    }
    assert.ok(status.active.project.includes('fixture-planning'))
    assert.ok(status.budget.count >= 2)
  })

  it('disables a global skill and removes its symlink', async () => {
    const result = run(['disable', '--global', 'fixture-planning'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      await isSymlink(path.join(userHome, '.claude', 'skills', 'fixture-planning')),
      false,
    )
  })

  it('disabling the client removes every managed link but keeps the vault', async () => {
    const result = run(['clients', 'disable', 'claude'])
    assert.equal(result.status, 0, result.stderr)

    assert.equal(await exists(path.join(project, '.claude', 'skills', 'fixture-review')), false)
    assert.equal(
      await exists(path.join(apocryphonHome(), 'vault', 'fixture-review', 'SKILL.md')),
      true,
    )

    const exclude = await fs.readFile(path.join(project, '.git', 'info', 'exclude'), 'utf8')
    assert.equal(exclude.includes('.claude/skills/fixture-review'), false)
  })

  it('prints shell completions and completion candidates', () => {
    const script = run(['completion', 'bash'])
    assert.equal(script.status, 0, script.stderr)
    assert.match(script.stdout, /complete -F _apocryphon_complete apocryphon/)

    const commands = run(['__complete', 'words', 'en'])
    assert.equal(commands.status, 0)
    assert.match(commands.stdout, /enable/)

    const skills = run(['__complete', 'words', 'enable', ''])
    assert.equal(skills.status, 0)
    assert.match(skills.stdout, /fixture-planning/)
  })
})
