import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import {
  hasExplicitTriggers,
  lintSkillDir,
  verifySkillIntegrity,
} from '../src/skill-linter.js'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apocryphon-lint-'))
  tempDirs.push(dir)
  return dir
}

async function writeSkill(dir: string, content: string): Promise<string> {
  const skillDir = path.join(dir, 'sample-skill')
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf8')
  return skillDir
}

after(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('skill linter', () => {
  it('accepts a well-formed skill', async () => {
    const dir = await makeTempDir()
    const skillDir = await writeSkill(
      dir,
      [
        '---',
        'name: sample-skill',
        'description: >',
        '  Use this skill whenever you edit .ts files to enforce the project conventions.',
        '  Do not use it for documentation-only changes.',
        'category: domain',
        '---',
        '',
        '# Sample skill',
        '',
        'Follow the conventions.',
      ].join('\n'),
    )

    const result = await lintSkillDir(skillDir)
    assert.equal(result.ok, true)
    assert.deepEqual(
      result.issues.filter((issue) => issue.level === 'error'),
      [],
    )
    assert.equal(result.frontmatter?.name, 'sample-skill')
  })

  it('rejects a description without explicit triggers', async () => {
    const dir = await makeTempDir()
    const skillDir = await writeSkill(
      dir,
      [
        '---',
        'name: sample-skill',
        'description: A helpful assistant for general software engineering tasks.',
        '---',
        '',
        'Do things.',
      ].join('\n'),
    )

    const result = await lintSkillDir(skillDir)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.code === 'description-missing-triggers'))
  })

  it('rejects a missing or invalid name', async () => {
    const dir = await makeTempDir()
    const skillDir = await writeSkill(
      dir,
      [
        '---',
        'name: Sample Skill',
        'description: Use it whenever you touch the codebase and need conventions.',
        '---',
        'Body.',
      ].join('\n'),
    )

    const result = await lintSkillDir(skillDir)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.code === 'name-invalid'))
  })

  it('reports missing SKILL.md', async () => {
    const dir = await makeTempDir()
    const skillDir = path.join(dir, 'sample-skill')
    await fs.mkdir(skillDir, { recursive: true })

    const result = await lintSkillDir(skillDir)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.code === 'skill-missing-file'))
  })

  it('warns about oversized bodies and unlinked references', async () => {
    const dir = await makeTempDir()
    const body = Array.from({ length: 160 }, (_, index) => `line ${index + 1}`).join('\n')
    const skillDir = await writeSkill(
      dir,
      [
        '---',
        'name: sample-skill',
        'description: Use it whenever you need the long skill. Do not use it for short tasks.',
        '---',
        '',
        body,
      ].join('\n'),
    )
    await fs.mkdir(path.join(skillDir, 'references'), { recursive: true })

    const result = await lintSkillDir(skillDir)
    assert.equal(result.ok, true)
    assert.ok(result.issues.some((issue) => issue.code === 'body-too-long'))
    assert.ok(result.issues.some((issue) => issue.code === 'references-unlinked'))
  })

  it('fingerprints scripts and detects tampering', async () => {
    const dir = await makeTempDir()
    const skillDir = await writeSkill(
      dir,
      [
        '---',
        'name: sample-skill',
        'description: Use it whenever you need the scripted skill. Do not use it elsewhere.',
        '---',
        '',
        'Run ./scripts/check.sh before finishing.',
      ].join('\n'),
    )
    const scriptsDir = path.join(skillDir, 'scripts')
    await fs.mkdir(scriptsDir, { recursive: true })
    const script = path.join(scriptsDir, 'check.sh')
    await fs.writeFile(script, '#!/usr/bin/env bash\necho ok\n', 'utf8')
    await fs.chmod(script, 0o755)

    const result = await lintSkillDir(skillDir)
    assert.equal(result.ok, true)
    assert.ok(Object.keys(result.scriptChecksums).length === 1)

    const clean = await verifySkillIntegrity(skillDir, result.scriptChecksums)
    assert.equal(clean.status, 'ok')

    await fs.writeFile(script, '#!/usr/bin/env bash\necho tampered\n', 'utf8')
    const modified = await verifySkillIntegrity(skillDir, result.scriptChecksums)
    assert.equal(modified.status, 'modified')
    assert.deepEqual(modified.changedFiles, ['scripts/check.sh'])
  })

  it('recognizes triggers in Spanish and English', () => {
    assert.equal(
      hasExplicitTriggers('Úsala siempre que edites archivos .prisma.'),
      true,
    )
    assert.equal(
      hasExplicitTriggers('Use this skill when the user creates a migration.'),
      true,
    )
    assert.equal(hasExplicitTriggers('General purpose helper for everything.'), false)
  })
})
