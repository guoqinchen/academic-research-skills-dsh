#!/usr/bin/env node
/**
 * Compare the latest npmjs and GitHub Packages versions.
 *
 * Requires GITHUB_TOKEN with read:packages for the GitHub Packages lookup.
 * The package-to-repository UI link is not exposed by the GitHub API; record
 * that manual confirmation in docs/release-checklist.md.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const NPM_NAME = 'academic-research-skills-dsh'
export const GITHUB_NAME = '@guoqinchen/academic-research-skills-dsh'

export function compareVersions(npmVersion, githubVersion) {
  return {
    npm: npmVersion,
    github: githubVersion,
    ok: npmVersion === githubVersion,
    differences: npmVersion === githubVersion ? [] : ['npmjs and GitHub Packages latest versions differ'],
  }
}

function viewVersion(name, registry, userconfig) {
  const args = ['view', name, 'version', '--registry', registry]
  if (userconfig !== undefined) args.push('--userconfig', userconfig)
  return execFileSync('npm', args, { encoding: 'utf8' }).trim()
}

function main() {
  const token = process.env.GITHUB_TOKEN || process.env.NODE_AUTH_TOKEN || ''
  if (token.length === 0) throw new Error('set GITHUB_TOKEN (read:packages) for the GitHub Packages lookup')
  const temp = mkdtempSync(join(tmpdir(), 'ars-release-parity-'))
  try {
    const npmrc = join(temp, '.npmrc')
    writeFileSync(npmrc, `//npm.pkg.github.com/:_authToken=${token}\n`, { mode: 0o600 })
    const npmVersion = viewVersion(NPM_NAME, 'https://registry.npmjs.org')
    const githubVersion = viewVersion(GITHUB_NAME, 'https://npm.pkg.github.com', npmrc)
    const result = compareVersions(npmVersion, githubVersion)
    process.stdout.write(JSON.stringify(result) + '\n')
    if (!result.ok) process.exitCode = 1
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`check-release-parity: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  }
}
