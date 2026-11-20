import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { initializeHome } from '../src/bootstrap.js'
import { resolvePaths } from '../src/paths.js'
import {
  applySkillUpdate,
  backupSkill,
  listBackups,
  planSkillUpdate,
  recordSkillState,
  adoptBaseline,
} from '../src/skill-updates.js'
import { buildManifest } from '../src/skill-files.js'
import { mergeSkillDirs } from '../src/skill-merge.js'
import { emptyProjects } from '../src/store.js'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function skillContent(name: string, body: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: Use it whenever the update test needs a skill. Do not use it elsewhere.',
    'category: workflow',
    'tags: [fixtures]',
    'version: 1.0.0',
    '---',
    '',
    `# ${name}`,
    '',
    'Context line 1.',
    'Context line 2.',
    'Context line 3.',
    'Context line 4.',
    'Context line 5.',
    '',
    body,
  ].join('\n')
}

async function writeSkill(dir: string, name: string, body: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), skillContent(name, body), 'utf8')
}

async function setup() {
  const root = await makeTempDir('skill-store-updates-')
  const paths = resolvePaths(path.join(root, 'state'))
  const homeDir = path.join(root, 'user')
  const initialized = await initializeHome({ paths, enabledClients: ['claude'], homeDir })

  const id = 'sample-skill'
  const sourceDir = path.join(root, 'registry', id)
  await writeSkill(sourceDir, id, 'Registry body v1.')
  await writeSkill(path.join(paths.vault, id), id, 'Registry body v1.')
  await fs.cp(path.join(paths.vault, id), path.join(paths.pristine, id), { recursive: true })

  const manifest = await buildManifest(path.join(paths.vault, id))
  recordSkillState(initialized.state, id, manifest, {
    version: '1.0.0',
    source: { type: 'registry', ref: 'test' },
    customized: false,
  })

  return { root, paths, homeDir, id, sourceDir, state: initialized.state, config: initialized.config }
}

after(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('skill updates', () => {
  it('detects local and upstream changes', async () => {
    const { paths, id, sourceDir, state, config, homeDir } = await setup()
    void config
    void homeDir

    const vaultFile = path.join(paths.vault, id, 'SKILL.md')
    await fs.appendFile(vaultFile, '\nLocal note.\n')
    await fs.appendFile(path.join(sourceDir, 'SKILL.md'), '\nUpstream note.\n')

    const plan = await planSkillUpdate({
      paths,
      id,
      sourceDir,
      installed: state.skills[id],
      registryVersion: '1.1.0',
    })

    assert.equal(plan.customized, true)
    assert.equal(plan.updateAvailable, true)
    assert.equal(plan.conflicted, true)
    assert.equal(plan.baseline, 'known')
    assert.deepEqual(plan.overlap, ['SKILL.md'])
  })

  it('keeps local changes when resolution is keep', async () => {
    const { paths, id, sourceDir, state } = await setup()
    const vaultFile = path.join(paths.vault, id, 'SKILL.md')
    await fs.appendFile(vaultFile, '\nLocal note.\n')

    const plan = await planSkillUpdate({ paths, id, sourceDir, installed: state.skills[id] })
    const result = await applySkillUpdate({
      paths,
      id,
      sourceDir,
      plan,
      resolution: 'keep',
      state,
    })

    assert.equal(result.backup, null)
    assert.match(await fs.readFile(vaultFile, 'utf8'), /Local note/)
  })

  it('merges disjoint local and upstream changes', async () => {
    const { paths, id, sourceDir, state } = await setup()
    const vaultFile = path.join(paths.vault, id, 'SKILL.md')
    const registryFile = path.join(sourceDir, 'SKILL.md')

    const local = (await fs.readFile(vaultFile, 'utf8')).replace(
      `# ${id}\n`,
      `# ${id}\n\nLocal section.\n`,
    )
    await fs.writeFile(vaultFile, local, 'utf8')
    await fs.appendFile(registryFile, '\nUpstream section.\n')

    const plan = await planSkillUpdate({ paths, id, sourceDir, installed: state.skills[id] })
    const result = await applySkillUpdate({
      paths,
      id,
      sourceDir,
      plan,
      resolution: 'merge',
      state,
    })

    const merged = await fs.readFile(vaultFile, 'utf8')
    assert.equal(result.conflicts.length, 0)
    assert.match(merged, /Local section/)
    assert.match(merged, /Upstream section/)
    assert.equal(state.skills[id]?.customized, true)
    assert.ok(result.backup)
  })

  it('overwrites with a backup when forced', async () => {
    const { paths, id, sourceDir, state } = await setup()
    const vaultFile = path.join(paths.vault, id, 'SKILL.md')
    await fs.appendFile(vaultFile, '\nLocal note.\n')
    await fs.appendFile(path.join(sourceDir, 'SKILL.md'), '\nUpstream note.\n')

    const plan = await planSkillUpdate({ paths, id, sourceDir, installed: state.skills[id] })
    const result = await applySkillUpdate({
      paths,
      id,
      sourceDir,
      plan,
      resolution: 'overwrite',
      state,
    })

    const content = await fs.readFile(vaultFile, 'utf8')
    assert.doesNotMatch(content, /Local note/)
    assert.match(content, /Upstream note/)
    assert.ok(result.backup)
    assert.equal(state.skills[id]?.customized, false)
  })

  it('retains the last five backups', async () => {
    const { paths, id } = await setup()
    for (let index = 0; index < 7; index += 1) {
      await backupSkill(paths, id)
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    assert.equal((await listBackups(paths, id)).length, 5)
  })

  it('adopts the vault as a new baseline', async () => {
    const { paths, id, state } = await setup()
    const vaultFile = path.join(paths.vault, id, 'SKILL.md')
    await fs.appendFile(vaultFile, '\nAdopted content.\n')

    await adoptBaseline(paths, id, state)
    const plan = await planSkillUpdate({
      paths,
      id,
      sourceDir: path.join(paths.vault, id),
      installed: state.skills[id],
    })
    assert.equal(plan.customized, false)
    assert.equal(plan.updateAvailable, false)
  })
})

describe('three-way merge', () => {
  it('reports conflicts and preserves markers', async () => {
    const root = await makeTempDir('skill-store-merge-')
    const base = path.join(root, 'base')
    const ours = path.join(root, 'ours')
    const theirs = path.join(root, 'theirs')
    const out = path.join(root, 'out')

    for (const dir of [base, ours, theirs]) await fs.mkdir(dir, { recursive: true })
    const original = 'line 1\nline 2\nline 3\n'
    await fs.writeFile(path.join(base, 'file.txt'), original, 'utf8')
    await fs.writeFile(
      path.join(ours, 'file.txt'),
      original.replace('line 2', 'ours 2'),
      'utf8',
    )
    await fs.writeFile(
      path.join(theirs, 'file.txt'),
      original.replace('line 2', 'theirs 2'),
      'utf8',
    )

    const result = await mergeSkillDirs({
      pristineDir: base,
      oursDir: ours,
      theirsDir: theirs,
      outDir: out,
    })

    assert.deepEqual(result.conflicts, ['file.txt'])
    assert.match(await fs.readFile(path.join(out, 'file.txt'), 'utf8'), /<<<<<<<|>>>>>>>/)
  })

  it('takes non-conflicting changes from both sides', async () => {
    const root = await makeTempDir('skill-store-merge-')
    const base = path.join(root, 'base')
    const ours = path.join(root, 'ours')
    const theirs = path.join(root, 'theirs')
    const out = path.join(root, 'out')

    for (const dir of [base, ours, theirs]) await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(base, 'SKILL.md'), 'top\nmiddle\nbottom\n', 'utf8')
    await fs.writeFile(path.join(ours, 'SKILL.md'), 'top\nmiddle\nbottom\nours\n', 'utf8')
    await fs.writeFile(
      path.join(theirs, 'SKILL.md'),
      'theirs\ntop\nmiddle\nbottom\n',
      'utf8',
    )

    const result = await mergeSkillDirs({
      pristineDir: base,
      oursDir: ours,
      theirsDir: theirs,
      outDir: out,
    })

    const merged = await fs.readFile(path.join(out, 'SKILL.md'), 'utf8')
    assert.deepEqual(result.conflicts, [])
    assert.match(merged, /^theirs/m)
    assert.match(merged, /ours/)
  })
})
