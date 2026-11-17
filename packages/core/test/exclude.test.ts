import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EXCLUDE_BEGIN,
  EXCLUDE_END,
  parseManagedBlock,
  renderManagedBlock,
  stripManagedBlock,
} from '../src/git-exclude.js'

describe('git exclude managed block', () => {
  it('renders a stable, sorted block', () => {
    const block = renderManagedBlock(['b/skill', 'a/skill', 'b/skill'])
    assert.ok(block.startsWith(EXCLUDE_BEGIN))
    assert.ok(block.endsWith(EXCLUDE_END))
    assert.equal(block.indexOf('a/skill') < block.indexOf('b/skill'), true)
    assert.equal(block.split('\n').filter((line) => line === 'b/skill').length, 1)
  })

  it('preserves user content when stripping the block', () => {
    const original = [
      '# user entries',
      'node_modules/',
      '',
      renderManagedBlock(['.claude/skills/foo']),
      '',
      '*.local',
    ].join('\n')

    const stripped = stripManagedBlock(original)
    assert.ok(!stripped.includes(EXCLUDE_BEGIN))
    assert.ok(stripped.includes('node_modules/'))
    assert.ok(stripped.includes('*.local'))
  })

  it('parses entries from the managed block', () => {
    const content = renderManagedBlock(['.claude/skills/foo', '.cursor/skills/bar'])
    assert.deepEqual(parseManagedBlock(content), [
      '.claude/skills/foo',
      '.cursor/skills/bar',
    ])
  })

  it('round-trips: strip then render produces no duplicates', () => {
    const first = renderManagedBlock(['a'])
    const stripped = stripManagedBlock(`${first}\n`)
    assert.equal(stripped, '')
    assert.deepEqual(parseManagedBlock(renderManagedBlock(['a', 'b'])), ['a', 'b'])
  })
})
