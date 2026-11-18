import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_REGISTRY_SOURCE,
  defaultRegistrySource,
  effectiveRegistryConfig,
  isDefaultRegistrySource,
  registryCacheDir,
} from '../src/registry-config.js'
import { resolvePaths } from '../src/paths.js'
import { isGitSource, resolveRegistryLocation } from '../src/registry.js'

describe('registry configuration', () => {
  it('uses the official source when there is no override', () => {
    assert.equal(defaultRegistrySource({}), DEFAULT_REGISTRY_SOURCE)
    assert.deepEqual(effectiveRegistryConfig({ registry: null }, {}), {
      source: DEFAULT_REGISTRY_SOURCE,
    })
    assert.equal(isDefaultRegistrySource(DEFAULT_REGISTRY_SOURCE, {}), true)
  })

  it('honors APOCRYPHON_DEFAULT_REGISTRY', () => {
    const env = { APOCRYPHON_DEFAULT_REGISTRY: '/tmp/local-registry' }
    assert.equal(defaultRegistrySource(env), '/tmp/local-registry')
    assert.deepEqual(effectiveRegistryConfig({ registry: null }, env), {
      source: '/tmp/local-registry',
    })
    assert.equal(isDefaultRegistrySource('/tmp/local-registry', env), true)
  })

  it('returns an explicit override untouched', () => {
    assert.deepEqual(
      effectiveRegistryConfig(
        { registry: { source: 'git@example.com:team/skills.git', ref: 'v1' } },
        {},
      ),
      { source: 'git@example.com:team/skills.git', ref: 'v1' },
    )
  })

  it('uses a deterministic cache directory per source and ref', () => {
    const paths = resolvePaths(path.join(os.tmpdir(), 'apocryphon-registry-config'))
    const a = registryCacheDir(paths, 'https://example.com/a.git')
    const aAgain = registryCacheDir(paths, 'https://example.com/a.git')
    const b = registryCacheDir(paths, 'https://example.com/b.git')
    const pinned = registryCacheDir(paths, 'https://example.com/a.git', 'v1')

    assert.equal(a, aAgain)
    assert.notEqual(a, b)
    assert.notEqual(a, pinned)
    assert.ok(a.startsWith(paths.registries))
  })

  it('recognizes SSH, HTTPS, file and local sources', () => {
    assert.equal(isGitSource('git@github.com:org/repo.git'), true)
    assert.equal(isGitSource('git@ssh.dev.azure.com:v3/org/proj/repo'), true)
    assert.equal(isGitSource('https://dev.azure.com/org/proj/_git/repo'), true)
    assert.equal(isGitSource('file:///tmp/registry'), true)
    assert.equal(isGitSource('/tmp/registry'), false)
  })

  it('places Git sources in the per-source cache and local paths in place', () => {
    const paths = resolvePaths('/tmp/apocryphon-registry-location')

    const git = resolveRegistryLocation('https://example.com/skills.git', paths, '/home/user')
    assert.equal(git.kind, 'git')
    assert.ok(git.dir.startsWith(paths.registries))

    const local = resolveRegistryLocation('~/skills', paths, '/home/user')
    assert.equal(local.kind, 'local')
    assert.equal(local.dir, '/home/user/skills')
  })
})
