import { z } from 'zod'

/** Portable skill id: lowercase kebab-case, 1-64 chars. */
export const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const SkillIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(SKILL_ID_PATTERN, 'must be lowercase kebab-case (a-z, 0-9 and hyphens)')

export const CLIENT_IDS = ['claude', 'cursor', 'opencode'] as const
export const ClientIdSchema = z.enum(CLIENT_IDS)
export type ClientId = z.infer<typeof ClientIdSchema>

export const SKILL_CATEGORIES = ['domain', 'workflow', 'meta'] as const
export const SkillCategorySchema = z.enum(SKILL_CATEGORIES)
export type SkillCategory = z.infer<typeof SkillCategorySchema>

/**
 * Frontmatter contract for a `SKILL.md`.
 *
 * `name` must be portable across clients (Claude Code requires lowercase
 * kebab-case), so Skill Store enforces it and recommends matching the folder.
 */
export const SkillFrontmatterSchema = z
  .object({
    name: z.string().min(1).max(64),
    description: z.string().optional(),
    category: SkillCategorySchema.optional(),
    version: z.string().optional(),
    tags: z.array(z.string()).optional(),
    license: z.string().optional(),
  })
  .catchall(z.unknown())
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

export const ClientSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Global skills directory, e.g. `~/.claude/skills`. */
  globalDir: z.string().min(1),
  /** Project-relative skills directory, e.g. `.claude/skills`. */
  projectDir: z.string().min(1),
})
export type ClientSettings = z.infer<typeof ClientSettingsSchema>

export const ClientsConfigSchema = z.object({
  claude: ClientSettingsSchema,
  cursor: ClientSettingsSchema,
  opencode: ClientSettingsSchema,
})
export type ClientsConfig = z.infer<typeof ClientsConfigSchema>

export const RegistryConfigSchema = z.object({
  /** Git URL (ssh/https/file) or absolute/local path to the registry repository. */
  source: z.string().min(1),
  /** Optional branch, tag or ref to pin the catalog. */
  ref: z.string().min(1).optional(),
})
export type RegistryConfig = z.infer<typeof RegistryConfigSchema>

export const BudgetConfigSchema = z.object({
  /** Skill count that turns the budget indicator yellow (inclusive). */
  warnAt: z.number().int().positive(),
  /** Skill count that turns the budget indicator red (exclusive). */
  failAt: z.number().int().positive(),
})

export const ConfigSchema = z.object({
  version: z.literal(1),
  /** Avoid duplicate symlinks when a client already reads another client's dirs. */
  dedupe: z.boolean(),
  registry: RegistryConfigSchema.nullable(),
  clients: ClientsConfigSchema,
  budget: BudgetConfigSchema,
})
export type Config = z.infer<typeof ConfigSchema>

export const SourceSchema = z.object({
  type: z.enum(['registry', 'local', 'git']),
  ref: z.string().nullable().default(null),
})
export type SkillSource = z.infer<typeof SourceSchema>

function normalizeSource(value: unknown): SkillSource | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return { type: 'registry', ref: value }
  const parsed = SourceSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const InstalledSkillSchema = z.object({
  version: z.string().optional(),
  installedAt: z.string(),
  updatedAt: z.string().optional(),
  /**
   * Where the skill came from. Legacy installs stored a string (the registry
   * source); those are normalized to `{ type: 'registry', ref }`.
   */
  source: z
    .union([z.string(), SourceSchema])
    .nullable()
    .default(null)
    .transform((value) => normalizeSource(value)),
  /** SHA-256 of every file inside `scripts/`, relative to the skill dir. */
  scriptChecksums: z.record(z.string(), z.string()).default({}),
  /** SHA-256 of the complete skill tree (content + modes). */
  contentHash: z.string().optional(),
  /** Per-file SHA-256, keyed by relative posix path. */
  fileHashes: z.record(z.string(), z.string()).default({}),
  /** Per-file permission bits (for example "755"), keyed by relative path. */
  fileModes: z.record(z.string(), z.string()).default({}),
  /** True when the working copy differs from the pristine baseline. */
  customized: z.boolean().default(false),
  /** Whether a pristine baseline exists for three-way merges. */
  baseline: z.enum(['known', 'unknown']).default('unknown'),
  lastMergedAt: z.string().nullable().optional(),
})
export type InstalledSkill = z.infer<typeof InstalledSkillSchema>

export function sourceRef(source: InstalledSkill['source']): string | null {
  if (!source) return null
  return source.ref
}

export const PackSchema = z.object({
  description: z.string().optional(),
  skills: z.array(SkillIdSchema),
})
export type Pack = z.infer<typeof PackSchema>

export const StateSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  /** Skills active in every project. */
  globalSkills: z.array(SkillIdSchema),
  /** Packs active in every project. */
  globalPacks: z.array(z.string()),
  /** Known pack definitions (imported from the registry). */
  packs: z.record(z.string(), PackSchema),
  /** Installed skill metadata, keyed by skill id. */
  skills: z.record(z.string(), InstalledSkillSchema),
})
export type State = z.infer<typeof StateSchema>

export const ProjectEntrySchema = z.object({
  skills: z.array(SkillIdSchema),
  packs: z.array(z.string()),
  updatedAt: z.string(),
})
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>

export const ProjectsSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), ProjectEntrySchema),
})
export type Projects = z.infer<typeof ProjectsSchema>

export const TaxonomyTagSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
})
export type TaxonomyTag = z.infer<typeof TaxonomyTagSchema>

export const TaxonomySchema = z.object({
  categories: z.array(z.string().min(1)).default(['domain', 'workflow', 'meta']),
  tags: z.array(TaxonomyTagSchema).default([]),
})
export type Taxonomy = z.infer<typeof TaxonomySchema>

export const RegistrySkillEntrySchema = z.object({
  id: SkillIdSchema,
  version: z.string().optional(),
  description: z.string().optional(),
  category: SkillCategorySchema.optional(),
  /** Path to the skill directory, relative to the registry root. */
  path: z.string().min(1),
  tags: z.array(z.string()).optional(),
})
export type RegistrySkillEntry = z.infer<typeof RegistrySkillEntrySchema>

export const RegistryIndexSchema = z.object({
  name: z.string().min(1),
  version: z.literal(1),
  taxonomy: TaxonomySchema.optional(),
  packs: z.record(z.string(), PackSchema),
  skills: z.array(RegistrySkillEntrySchema),
})
export type RegistryIndex = z.infer<typeof RegistryIndexSchema>

export const LintIssueSchema = z.object({
  level: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string(),
  file: z.string().optional(),
})
export type LintIssue = z.infer<typeof LintIssueSchema>
