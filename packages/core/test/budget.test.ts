import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  budgetLevel,
  computeContextBudget,
  estimateTokens,
} from '../src/context-budget.js'

describe('context budget', () => {
  it('estimates tokens from characters', () => {
    assert.equal(estimateTokens(''), 0)
    assert.equal(estimateTokens('1234'), 1)
    assert.equal(estimateTokens('12345678'), 2)
  })

  it('uses the documented thresholds', () => {
    assert.equal(budgetLevel(0, { warnAt: 8, failAt: 15 }), 'green')
    assert.equal(budgetLevel(7, { warnAt: 8, failAt: 15 }), 'green')
    assert.equal(budgetLevel(8, { warnAt: 8, failAt: 15 }), 'yellow')
    assert.equal(budgetLevel(15, { warnAt: 8, failAt: 15 }), 'yellow')
    assert.equal(budgetLevel(16, { warnAt: 8, failAt: 15 }), 'red')
  })

  it('counts duplicated skill ids once', () => {
    const budget = computeContextBudget(
      [
        { id: 'a', name: 'a', description: 'first description' },
        { id: 'a', name: 'a', description: 'duplicate description' },
        { id: 'b', name: 'b', description: 'second description' },
      ],
      { warnAt: 8, failAt: 15 },
    )

    assert.equal(budget.count, 2)
    assert.equal(budget.breakdown.length, 2)
    assert.equal(budget.level, 'green')
  })
})
