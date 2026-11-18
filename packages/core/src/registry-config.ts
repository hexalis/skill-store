import crypto from 'node:crypto'
import path from 'node:path'
import type { Config, RegistryConfig } from './schemas.js'
import type { ApocryphonPaths } from './paths.js'

/**
 * Official catalog used when the user has not configured an override.
 * HTTPS is the portable default; users can switch to SSH with
 * `apocryphon registry use git@github.com:...`.
 */
export const DEFAULT_REGISTRY_SOURCE =
  'https://github.com/marlonbaltodano11/apocryphon-registry.git'

/**
 * Effective default. `APOCRYPHON_DEFAULT_REGISTRY` lets enterprises and tests
 * replace the official source without writing an explicit config override.
 */
export function defaultRegistrySource(env: NodeJS.ProcessEnv = process.env): string {
  return env.APOCRYPHON_DEFAULT_REGISTRY?.trim() || DEFAULT_REGISTRY_SOURCE
}

export function effectiveRegistryConfig(
  config: Pick<Config, 'registry'>,
  env: NodeJS.ProcessEnv = process.env,
): RegistryConfig {
  return config.registry ?? { source: defaultRegistrySource(env) }
}

export function isDefaultRegistrySource(
  source: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return source === defaultRegistrySource(env)
}

/**
 * Per-source cache directory. Including the ref avoids mixing a pinned branch
 * or tag with the default branch of the same repository.
 */
export function registryCacheDir(
  paths: ApocryphonPaths,
  source: string,
  ref?: string,
): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${source}\0${ref ?? ''}`)
    .digest('hex')
    .slice(0, 16)
  return path.join(paths.registries, hash)
}
