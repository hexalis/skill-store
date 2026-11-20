import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

export default defineConfig({
  entry: { cli: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  banner: { js: '#!/usr/bin/env node' },
  outExtension: () => ({ js: '.mjs' }),
  external: ['@hexalis/skill-store-core', '@modelcontextprotocol/sdk'],
  define: {
    __SKILL_STORE_VERSION__: JSON.stringify(pkg.version),
  },
})
