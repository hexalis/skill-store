/**
 * Small dependency-free fuzzy matcher.
 *
 * The score rewards exact substrings, prefix matches, word-boundary matches and
 * consecutive characters, so `git` ranks `workflow-atomic-commits` (tag: git)
 * above unrelated skills.
 */

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function fuzzyScore(query: string, text: string): number {
  const needle = normalize(query).trim()
  if (needle === '') return 1

  const haystack = normalize(text)
  const exact = haystack.indexOf(needle)
  if (exact !== -1) {
    let score = 1000 - exact
    if (exact === 0) score += 200
    if (exact > 0 && /[^a-z0-9]/.test(haystack[exact - 1] ?? '')) score += 100
    return score
  }

  // Subsequence matching with bonuses for consecutive hits and word starts.
  let position = 0
  let score = 0
  let streak = 0
  for (const char of needle) {
    if (char === ' ') {
      streak = 0
      continue
    }
    const found = haystack.indexOf(char, position)
    if (found === -1) return 0

    const before = haystack[found - 1]
    const isWordStart = found === 0 || before === undefined || /[^a-z0-9]/.test(before)
    score += 10 + (isWordStart ? 12 : 0)
    streak = found === position ? streak + 1 : 0
    score += streak * 4
    score -= Math.min(found - position, 8)
    position = found + 1
  }

  return Math.max(score, 1)
}

export function fuzzyMatch(query: string, text: string): boolean {
  return fuzzyScore(query, text) > 0
}

export interface Ranked<T> {
  item: T
  score: number
}

export function rankByScore<T>(
  items: T[],
  query: string,
  toText: (item: T) => string,
): Ranked<T>[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, toText(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
}
