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
let registryA: string
let registryB: string

function skillStoreHome(): string {
  return path.join(userHome, '.skill-store')
}

interface RunResult {
  status: number | null
  stdout: string
  stderr: string
}

function run(args: string[], options: { cwd?: string } = {}): RunResult {
  const result = spawnSync(process.execPath, ['--import', tsxLoader, cliEntry, ...args], {
    cwd: options.cwd ?? project,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: userHome,
      SKILL_STORE_HOME: skillStoreHome(),
      SKILL_STORE_DEFAULT_REGISTRY: registryA,
      NO_COLOR: '1',
    },
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function runOk(args: string[], options: { cwd?: string } = {}): RunResult {
  const result = run(args, options)
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`)
  return result
}

async function writeRegistry(
  target: string,
  name: string,
  packs: Record<string, unknown>,
): Promise<void> {
  await fs.cp(catalogDir, target, { recursive: true })
  const indexFile = path.join(target, 'registry.json')
  const index = JSON.parse(await fs.readFile(indexFile, 'utf8')) as Record<string, unknown>
  index.name = name
  index.packs = packs
  await fs.writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
}

before(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-registry-cli-'))
  userHome = path.join(sandbox, 'user')
  project = path.join(sandbox, 'project')
  registryA = path.join(sandbox, 'registry-a')
  registryB = path.join(sandbox, 'registry-b')
  await fs.mkdir(userHome, { recursive: true })
  await fs.mkdir(project, { recursive: true })
  await writeRegistry(registryA, 'registry-a', {
    'pack-a': { skills: ['fixture-planning'] },
  })
  await writeRegistry(registryB, 'registry-b', {
    'pack-b': { skills: ['fixture-review'] },
  })

  const init = spawnSync('git', ['init', '--quiet'], { cwd: project, encoding: 'utf8' })
  assert.equal(init.status, 0, init.stderr)

  runOk(['init', '--registry', registryA, '--clients', 'claude', '--yes'])
  runOk(['install', 'fixture-planning', 'fixture-review'])
})

after(async () => {
  await fs.rm(sandbox, { recursive: true, force: true })
})

describe('registry source', () => {
  it('shows the active override', () => {
    const result = runOk(['registry', 'show', '--json'])
    const info = JSON.parse(result.stdout) as {
      source: string
      isDefault: boolean
      kind: string
      skills: number
      packs: number
    }
    assert.equal(info.source, registryA)
    assert.equal(info.isDefault, false)
    assert.equal(info.kind, 'local')
    assert.equal(info.skills, 2)
    assert.equal(info.packs, 1)
  })

  it('switches source transactionally and preserves active packs and installed skills', async () => {
    runOk(['pack', 'apply', 'pack-a'])

    const result = runOk(['registry', 'use', registryB, '--json'])
    const payload = JSON.parse(result.stdout) as {
      source: string
      isDefault: boolean
      packs: number
      installed: number
    }
    assert.equal(payload.source, registryB)
    assert.equal(payload.isDefault, false)
    assert.equal(payload.packs, 1)
    assert.equal(payload.installed, 2)

    const state = await readJson(path.join(skillStoreHome(), 'state.json'))
    const packs = state.packs as Record<string, unknown>
    assert.ok(packs['pack-b'])
    assert.ok(packs['pack-a'], 'active pack definition is preserved')
    assert.equal(Object.keys(state.skills as Record<string, unknown>).length, 2)

    const config = await readJson(path.join(skillStoreHome(), 'config.json'))
    assert.deepEqual(config.registry, { source: registryB })
  })

  it('does not change the source when the new one is invalid', async () => {
    const beforeConfig = await readJson(path.join(skillStoreHome(), 'config.json'))
    const result = run(['registry', 'use', path.join(sandbox, 'missing-registry')])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /registry.json|does not exist|not found/i)

    const afterConfig = await readJson(path.join(skillStoreHome(), 'config.json'))
    assert.deepEqual(afterConfig.registry, beforeConfig.registry)

    const show = JSON.parse(runOk(['registry', 'show', '--json']).stdout) as {
      source: string
    }
    assert.equal(show.source, registryB)
  })

  it('restores the default source and clears the override', async () => {
    const result = runOk(['registry', 'default', '--json'])
    const payload = JSON.parse(result.stdout) as {
      source: string
      isDefault: boolean
      installed: number
    }
    assert.equal(payload.source, registryA)
    assert.equal(payload.isDefault, true)
    assert.equal(payload.installed, 2)

    const config = await readJson(path.join(skillStoreHome(), 'config.json'))
    assert.equal(config.registry, null)

    const show = JSON.parse(runOk(['registry', 'show', '--json']).stdout) as {
      isDefault: boolean
      source: string
    }
    assert.equal(show.isDefault, true)
    assert.equal(show.source, registryA)
  })

  it('uses the default registry when init has no --registry', async () => {
    const otherHome = path.join(sandbox, 'other-home')
    const otherProject = path.join(sandbox, 'other-project')
    await fs.mkdir(otherHome, { recursive: true })
    await fs.mkdir(otherProject, { recursive: true })
    spawnSync('git', ['init', '--quiet'], { cwd: otherProject })

    const env = {
      ...process.env,
      HOME: otherHome,
      SKILL_STORE_HOME: path.join(otherHome, '.skill-store'),
      SKILL_STORE_DEFAULT_REGISTRY: registryA,
      NO_COLOR: '1',
    }
    const init = spawnSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init', '--clients', 'claude', '--yes'], {
      cwd: otherProject,
      env,
      encoding: 'utf8',
    })
    assert.equal(init.status, 0, init.stderr)

    const config = JSON.parse(
      await fs.readFile(path.join(otherHome, '.skill-store', 'config.json'), 'utf8'),
    ) as { registry: unknown }
    assert.equal(config.registry, null)

    const show = spawnSync(
      process.execPath,
      ['--import', tsxLoader, cliEntry, 'registry', 'show', '--json'],
      { cwd: otherProject, env, encoding: 'utf8' },
    )
    assert.equal(show.status, 0, show.stderr)
    const info = JSON.parse(show.stdout) as { isDefault: boolean; source: string }
    assert.equal(info.isDefault, true)
    assert.equal(info.source, registryA)
  })
})
