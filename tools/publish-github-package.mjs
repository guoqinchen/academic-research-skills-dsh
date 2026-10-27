#!/usr/bin/env node
/**
 * Publish the current package as a scoped mirror to GitHub Packages.
 *
 * GitHub Packages requires an npm package name scoped to the repository owner.
 * The canonical package on npmjs.org stays unscoped; this script packs the same
 * content, rewrites only the package name (and registry), and publishes it as
 * @guoqinchen/academic-research-skills-dsh.
 *
 * Usage: GITHUB_TOKEN=... node tools/publish-github-package.mjs
 * Requires a token with write:packages (gh auth token works).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCOPE = '@guoqinchen'
const MIRROR_NAME = `${SCOPE}/academic-research-skills-dsh`
const REGISTRY = 'https://npm.pkg.github.com'
const token = process.env.GITHUB_TOKEN || process.env.NODE_AUTH_TOKEN || ''

if (!token) {
  console.error('publish-github-package: set GITHUB_TOKEN (or NODE_AUTH_TOKEN) with write:packages')
  process.exit(2)
}

const root = process.cwd()
const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const temp = mkdtempSync(join(tmpdir(), 'ars-github-package-'))
/** The temp dir holds a token-bearing .npmrc; never leave it behind. */
const cleanup = () => {
  try {
    if (existsSync(temp)) rmSync(temp, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}
process.on('exit', cleanup)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    cleanup()
    process.exit(130)
  })
}

try {
  execFileSync('npm', ['pack', '--pack-destination', temp], { cwd: root, stdio: 'inherit' })
  const tarball = readdirSync(temp).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('npm pack produced no tarball')
  execFileSync('tar', ['-xzf', join(temp, tarball), '-C', temp], { stdio: 'inherit' })

  const packageDir = join(temp, 'package')
  const manifestPath = join(packageDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.name = MIRROR_NAME
  manifest.private = false
  manifest.publishConfig = { ...(manifest.publishConfig || {}), registry: REGISTRY, access: 'public' }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const npmrc = join(temp, '.npmrc')
  // 0600: the file carries a write-scoped token and lives in a shared temp dir.
  writeFileSync(npmrc, `//npm.pkg.github.com/:_authToken=${token}\nregistry=${REGISTRY}\n`, { mode: 0o600 })
  console.log(`publishing ${MIRROR_NAME}@${source.version} to ${REGISTRY}`)
  execFileSync(
    'npm',
    ['publish', packageDir, '--registry', REGISTRY, '--userconfig', npmrc, '--access', 'public'],
    { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_AUTH_TOKEN: token } },
  )
  console.log(`published ${MIRROR_NAME}@${source.version}`)
} finally {
  cleanup()
}
