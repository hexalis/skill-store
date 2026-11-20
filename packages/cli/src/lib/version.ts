declare const __SKILL_STORE_VERSION__: string | undefined

/**
 * Version injected at build time by tsup (`define`). Falls back to a dev marker
 * when the sources are executed directly (tests, tsx).
 */
export function readVersion(): string {
  return typeof __SKILL_STORE_VERSION__ === 'string'
    ? __SKILL_STORE_VERSION__
    : '0.0.0-dev'
}
