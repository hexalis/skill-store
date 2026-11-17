export type BudgetLevel = 'green' | 'yellow' | 'red'

export interface BudgetThresholds {
  /** Count that turns the indicator yellow (inclusive). Default: 8. */
  warnAt: number
  /** Count above which the indicator turns red. Default: 15. */
  failAt: number
}

export const DEFAULT_BUDGET_THRESHOLDS: BudgetThresholds = { warnAt: 8, failAt: 15 }

export interface BudgetSkillInput {
  id: string
  name?: string | undefined
  description?: string | undefined
}

export interface BudgetBreakdownItem {
  id: string
  tokens: number
}

export interface ContextBudget {
  count: number
  tokens: number
  level: BudgetLevel
  thresholds: BudgetThresholds
  breakdown: BudgetBreakdownItem[]
}

/**
 * Rough token estimate for the text a client keeps in the model's skill list
 * (name + description). Uses the common ~4 characters per token heuristic so
 * Apocryphon does not need to ship a full tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.trim().length / 4))
}

export function budgetLevel(count: number, thresholds: BudgetThresholds): BudgetLevel {
  if (count > thresholds.failAt) return 'red'
  if (count >= thresholds.warnAt) return 'yellow'
  return 'green'
}

/**
 * Compute the prompt budget for a set of active skills.
 *
 * Duplicate ids (e.g. a skill active both globally and per project) are counted
 * once: clients register a single entry per skill id.
 */
export function computeContextBudget(
  skills: BudgetSkillInput[],
  thresholds: BudgetThresholds = DEFAULT_BUDGET_THRESHOLDS,
): ContextBudget {
  const unique = new Map<string, BudgetSkillInput>()
  for (const skill of skills) {
    if (!unique.has(skill.id)) unique.set(skill.id, skill)
  }

  const breakdown: BudgetBreakdownItem[] = []
  let tokens = 0
  for (const skill of unique.values()) {
    const text = `${skill.name ?? skill.id} ${skill.description ?? ''}`.trim()
    const cost = estimateTokens(text)
    tokens += cost
    breakdown.push({ id: skill.id, tokens: cost })
  }

  breakdown.sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id))

  const count = unique.size
  return {
    count,
    tokens,
    level: budgetLevel(count, thresholds),
    thresholds,
    breakdown,
  }
}
