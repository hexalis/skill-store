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
  })

  it('searches the catalog', () => {
    const result = run(['search', 'error'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /api-error-handling/)
  })

  it('installs skills from the registry', async () => {
    const result = run([
      'install',
      'workflow-read-only-plan',
      'workflow-atomic-commits',
      'workflow-review-triage',
      'api-error-handling',
    ])
    assert.equal(result.status, 0, result.stderr)

    for (const id of [
      'workflow-read-only-plan',
      'workflow-atomic-commits',
      'workflow-review-triage',
      'api-error-handling',
    ]) {
      assert.equal(
        await exists(path.join(apocryphonHome(), 'vault', id, 'SKILL.md')),
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
    const result = run(['enable', '--global', 'workflow-atomic-commits'])
    assert.equal(result.status, 0, result.stderr)

    const link = path.join(userHome, '.claude', 'skills', 'workflow-atomic-commits')
    assert.equal(await isSymlink(link), true)
    assert.equal(
      await exists(path.join(userHome, '.config', 'opencode', 'skills', 'workflow-atomic-commits')),
      false,
    )
  })

  it('enables a project skill and keeps git status clean', async () => {
    const result = run(['enable', 'api-error-handling'])
    assert.equal(result.status, 0, result.stderr)

    const link = path.join(project, '.claude', 'skills', 'api-error-handling')
    assert.equal(await isSymlink(link), true)

    const exclude = await fs.readFile(path.join(project, '.git', 'info', 'exclude'), 'utf8')
    assert.match(exclude, /\.claude\/skills\/api-error-handling/)

    const status = git(['status', '--porcelain'])
    assert.equal(status.status, 0)
    assert.equal(status.stdout.trim(), '')
  })

  it('reports status as JSON', () => {
    const result = run(['status', '--json'])
    assert.equal(result.status, 0, result.stderr)

    const status = JSON.parse(result.stdout) as {
      active: { global: string[]; project: string[] }
      budget: { level: string }
      exclude: { entries: string[] } | null
    }

    assert.ok(status.active.global.includes('workflow-atomic-commits'))
    assert.ok(status.active.project.includes('api-error-handling'))
    assert.equal(status.exclude?.entries.length, 1)
    assert.ok(['green', 'yellow', 'red'].includes(status.budget.level))
  })

  it('lists installed skills as JSON', () => {
    const result = run(['list', '--json'])
    assert.equal(result.status, 0, result.stderr)
    const rows = JSON.parse(result.stdout) as Array<{ id: string; installed: boolean }>
    assert.equal(rows.length, 4)
    assert.ok(rows.every((row) => row.installed))
  })

  it('validates the vault successfully', () => {
    const result = run(['validate'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /All skills passed validation/)
  })

  it('applies a pack and expands it into project symlinks', async () => {
    const result = run(['pack', 'apply', 'core-discipline'])
    assert.equal(result.status, 0, result.stderr)

    for (const id of ['workflow-read-only-plan', 'workflow-atomic-commits', 'workflow-review-triage']) {
      assert.equal(await isSymlink(path.join(project, '.claude', 'skills', id)), true)
    }

    const status = JSON.parse(run(['status', '--json']).stdout) as {
      active: { project: string[] }
      budget: { count: number }
    }
    assert.ok(status.active.project.includes('workflow-read-only-plan'))
    assert.ok(status.budget.count >= 4)
  })

  it('disables a global skill and removes its symlink', async () => {
    const result = run(['disable', '--global', 'workflow-atomic-commits'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      await isSymlink(path.join(userHome, '.claude', 'skills', 'workflow-atomic-commits')),
      false,
    )
  })

  it('disabling the client removes every managed link but keeps the vault', async () => {
    const result = run(['clients', 'disable', 'claude'])
    assert.equal(result.status, 0, result.stderr)

    assert.equal(await exists(path.join(project, '.claude', 'skills', 'api-error-handling')), false)
    assert.equal(
      await exists(path.join(apocryphonHome(), 'vault', 'api-error-handling', 'SKILL.md')),
      true,
    )

    const exclude = await fs.readFile(path.join(project, '.git', 'info', 'exclude'), 'utf8')
    assert.equal(exclude.includes('.claude/skills/api-error-handling'), false)
  })
})
