import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fuzzyMatch, fuzzyScore, rankByScore } from '../src/lib/fuzzy.js'

describe('fuzzy matching', () => {
  it('scores an exact match above a subsequence match', () => {
    const exact = fuzzyScore('git', 'git commits')
    const subsequence = fuzzyScore('git', 'generating incremental tests')
    assert.ok(exact > subsequence)
  })

  it('prefers word-boundary matches', () => {
    assert.ok(fuzzyScore('git', 'git workflow') > fuzzyScore('git', 'widget hint'))
  })

  it('is accent-insensitive', () => {
    assert.ok(fuzzyScore('revision', 'revisión de código') > 0)
    assert.ok(fuzzyScore('código', 'codigo') > 0)
  })

  it('returns zero when characters are missing', () => {
    assert.equal(fuzzyScore('zzz', 'abc'), 0)
    assert.equal(fuzzyMatch('zzz', 'abc'), false)
  })

  it('returns a neutral score for an empty query', () => {
    assert.equal(fuzzyScore('', 'anything'), 1)
  })

  it('ranks candidates by score', () => {
    const ranked = rankByScore(
      ['workflow-atomic-commits', 'api-error-handling', 'git-release'],
      'git',
      (value) => value,
    )
    assert.equal(ranked[0]?.item, 'git-release')
  })
})
