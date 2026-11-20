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
let registry: string

function home(): string {
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
    env: { ...process.env, HOME: userHome, SKILL_STORE_HOME: home(), NO_COLOR: '1' },
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function runOk(args: string[], options: { cwd?: string } = {}): RunResult {
  const result = run(args, options)
  assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}\n${result.stdout}`)
  return result
}

async function readVault(id: string): Promise<string> {
  return fs.readFile(path.join(home(), 'vault', id, 'SKILL.md'), 'utf8')
}

async function writeVault(id: string, content: string): Promise<void> {
  await fs.writeFile(path.join(home(), 'vault', id, 'SKILL.md'), content, 'utf8')
}

function registrySkill(id: string): string {
  return path.join(registry, 'skills', id, 'SKILL.md')
}

before(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-store-updates-cli-'))
  userHome = path.join(sandbox, 'user')
  project = path.join(sandbox, 'project')
  registry = path.join(sandbox, 'registry')
  await fs.mkdir(userHome, { recursive: true })
  await fs.mkdir(project, { recursive: true })
  await fs.cp(catalogDir, registry, { recursive: true })

  const init = spawnSync('git', ['init', '--quiet'], { cwd: project, encoding: 'utf8' })
  assert.equal(init.status, 0, init.stderr)

  runOk(['init', '--registry', registry, '--clients', 'claude', '--yes'])
  runOk(['install', 'fixture-review'])
})

after(async () => {
  await fs.rm(sandbox, { recursive: true, force: true })
})

describe('safe skill updates', () => {
  it('shows a dry-run plan without touching the vault', async () => {
    const original = await readVault('fixture-review')
    await writeVault(
      'fixture-review',
      original.replace('# Fixture review\n', '# Fixture review\n\nLocal note.\n'),
    )
    await fs.appendFile(registrySkill('fixture-review'), '\n## Upstream\n\nUpstream note.\n')

    const result = runOk(['sync', '--dry-run'])
    assert.match(result.stdout, /needs decision/)
    assert.match(await readVault('fixture-review'), /Local note/)
    assert.doesNotMatch(await readVault('fixture-review'), /Upstream note/)
  })

  it('refuses to overwrite without a TTY and without flags', async () => {
    const result = run(['sync'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /local changes and an update is available/)
    assert.match(await readVault('fixture-review'), /Local note/)
    assert.doesNotMatch(await readVault('fixture-review'), /Upstream note/)
  })

  it('merges disjoint changes with --merge', async () => {
    const result = runOk(['sync', '--merge'])
    assert.match(result.stdout, /Updates applied/)
    const content = await readVault('fixture-review')
    assert.match(content, /Local note/)
    assert.match(content, /Upstream note/)
    assert.doesNotMatch(content, /<<<<<<</)
  })

  it('shows local changes with diff', () => {
    const result = runOk(['diff', 'fixture-review'])
    assert.match(result.stdout, /Local changes/)
  })

  it('overwrites with --force and keeps a backup', async () => {
    const original = await readVault('fixture-review')
    await writeVault('fixture-review', `${original}\nLOCAL FORCE\n`)
    await fs.appendFile(registrySkill('fixture-review'), '\nUPSTREAM FORCE\n')

    const result = runOk(['sync', '--force'])
    assert.match(result.stdout, /Updates applied/)

    const content = await readVault('fixture-review')
    assert.match(content, /UPSTREAM FORCE/)
    assert.doesNotMatch(content, /LOCAL FORCE/)

    const backups = await fs.readdir(path.join(home(), 'backups', 'fixture-review'))
    assert.ok(backups.length >= 1)
  })

  it('reset restores the pristine copy', async () => {
    const original = await readVault('fixture-review')
    await writeVault('fixture-review', `${original}\nTEMP LOCAL\n`)

    const result = runOk(['reset', 'fixture-review', '--yes'])
    assert.match(result.stdout, /Restored fixture-review/)

    const content = await readVault('fixture-review')
    assert.doesNotMatch(content, /TEMP LOCAL/)
  })

  it('leaves conflict markers and exits 1 when both sides change the same lines', async () => {
    const original = await readVault('fixture-review')
    await writeVault('fixture-review', `${original}\nLOCAL EOF\n`)
    await fs.appendFile(registrySkill('fixture-review'), '\nUPSTREAM EOF\n')

    const result = run(['sync', '--merge'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /conflicts/)
    const content = await readVault('fixture-review')
    assert.match(content, /<<<<<<</)
    assert.match(content, /LOCAL EOF/)
    assert.match(content, /UPSTREAM EOF/)
  })

  it('reports customization state in status JSON', () => {
    const result = runOk(['status', '--json'])
    const status = JSON.parse(result.stdout) as {
      skills: Array<{
        id: string
        customized: boolean
        updateAvailable: boolean
        baseline: string
      }>
    }
    const row = status.skills.find((skill) => skill.id === 'fixture-review')
    assert.ok(row)
    assert.equal(typeof row?.customized, 'boolean')
    assert.equal(typeof row?.updateAvailable, 'boolean')
    assert.equal(typeof row?.baseline, 'string')
  })
})

describe('local skills', () => {
  it('creates a valid skill with new', async () => {
    const result = runOk(['new', 'demo-skill', '--category', 'meta', '--tags', 'demo'])
    assert.match(result.stdout, /Created demo-skill/)
    assert.match(result.stdout, /Created|Next:/)

    const content = await fs.readFile(
      path.join(home(), 'vault', 'demo-skill', 'SKILL.md'),
      'utf8',
    )
    assert.match(content, /name: demo-skill/)
    assert.match(content, /category: meta/)
    assert.match(content, /tags: \[demo\]/)
    assert.match(content, /Use this skill whenever/)

    const validate = runOk(['validate', path.join(home(), 'vault', 'demo-skill')])
    assert.match(validate.stdout, /All skills passed validation/)
  })

  it('imports a skill from a local path', async () => {
    const source = path.join(sandbox, 'imported-skill')
    await fs.mkdir(source, { recursive: true })
    await fs.writeFile(
      path.join(source, 'SKILL.md'),
      [
        '---',
        'name: imported-skill',
        'description: Use this skill whenever the import test needs it. Do not use it elsewhere.',
        'category: meta',
        'tags: [imported]',
        '---',
        '',
        '# Imported skill',
        '',
        'Body.',
      ].join('\n'),
      'utf8',
    )

    const result = runOk(['import', source])
    assert.match(result.stdout, /Imported/)
    assert.equal(
      await fs
        .access(path.join(home(), 'vault', 'imported-skill', 'SKILL.md'))
        .then(() => true),
      true,
    )
  })
})
