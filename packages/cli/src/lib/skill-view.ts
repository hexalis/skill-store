import type { SkillLintResult } from '@apocryphon/core'
import { fuzzyScore } from './fuzzy.js'
import { truncate } from './output.js'

export function skillTags(skill: SkillLintResult): string[] {
  return skill.frontmatter?.tags ?? []
}

export function skillCategory(skill: SkillLintResult): string {
  return skill.frontmatter?.category ?? 'uncategorized'
}

export function skillSearchText(skill: SkillLintResult): string {
  return [
    skill.id,
    skill.frontmatter?.description ?? '',
    skillCategory(skill),
    ...skillTags(skill),
  ].join(' ')
}

export function skillHint(skill: SkillLintResult): string {
  const tags = skillTags(skill).slice(0, 3).join(', ')
  const category = skillCategory(skill)
  const description = truncate(skill.frontmatter?.description ?? 'no description', 60)
  return `${category}${tags ? ` · ${tags}` : ''} · ${description}`
}

export function skillOption(skill: SkillLintResult): {
  value: string
  label: string
  hint: string
} {
  return { value: skill.id, label: skill.id, hint: skillHint(skill) }
}

export interface SkillFilter {
  category?: string
  tag?: string
  query?: string
}

export function filterSkills(skills: SkillLintResult[], filter: SkillFilter): SkillLintResult[] {
  return skills.filter((skill) => {
    if (filter.category && skillCategory(skill) !== filter.category) return false
    if (filter.tag && !skillTags(skill).includes(filter.tag)) return false
    if (filter.query && filter.query.trim() !== '') {
      if (fuzzyScore(filter.query, skillSearchText(skill)) === 0) return false
    }
    return true
  })
}

export function groupByCategory(skills: SkillLintResult[]): Record<string, SkillLintResult[]> {
  const groups: Record<string, SkillLintResult[]> = {}
  for (const skill of skills) {
    const key = skillCategory(skill)
    groups[key] ??= []
    groups[key]?.push(skill)
  }
  return groups
}

export function previewText(skill: SkillLintResult, maxLines = 12): string {
  const description = skill.frontmatter?.description?.trim() ?? 'No description'
  const body = skill.body.split(/\r?\n/).slice(0, maxLines).join('\n')
  return [
    `id: ${skill.id}`,
    `category: ${skillCategory(skill)}`,
    `tags: ${skillTags(skill).join(', ') || '-'}`,
    `path: ${skill.dir}`,
    '',
    description,
    body ? `\n${body}` : '',
  ].join('\n')
}
