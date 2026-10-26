#!/usr/bin/env node
/**
 * Generate or verify `bin/ars-python` from the Python interpreter contract.
 *
 * `lib/python-contract.js` is the single source of truth for the wrapper text
 * (`renderWrapper()`); this tool only performs the file I/O so the checked-in
 * wrapper can never drift from the contract.
 *
 * Usage:
 *   node tools/build-python-wrapper.mjs           # write bin/ars-python
 *   node tools/build-python-wrapper.mjs --check   # verify checked-in bytes
 *
 * Exit codes: 0 success/up-to-date, 1 stale or missing, 2 usage error.
 */
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { createPaths } from '../lib/paths.js'
import { WRAPPER_NAME, renderWrapper } from '../lib/python-contract.js'

const USAGE = 'usage: node tools/build-python-wrapper.mjs [--check]'

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  const unknown = argv.filter((arg) => arg !== '--check')
  if (unknown.length > 0 || argv.filter((arg) => arg === '--check').length > 1) {
    process.stderr.write(`build-python-wrapper: unexpected arguments: ${argv.join(' ')}\n${USAGE}\n`)
    return 2
  }
  const checkOnly = argv.includes('--check')
  const paths = createPaths()
  const wrapperFile = join(paths.binRoot, WRAPPER_NAME)
  const displayPath = relative(paths.pluginRoot, wrapperFile) || wrapperFile
  const expected = renderWrapper()

  if (!checkOnly) {
    writeFileSync(wrapperFile, expected, 'utf8')
    chmodSync(wrapperFile, 0o755)
    process.stdout.write(`build-python-wrapper: wrote ${displayPath}\n`)
    return 0
  }

  let actual
  try {
    actual = readFileSync(wrapperFile, 'utf8')
  } catch (error) {
    process.stderr.write(
      `build-python-wrapper: ${displayPath} is missing (${error.message}); ` +
        'run node tools/build-python-wrapper.mjs\n',
    )
    return 1
  }
  if (actual !== expected) {
    process.stderr.write(
      `build-python-wrapper: ${displayPath} is out of date with lib/python-contract.js; ` +
        'run node tools/build-python-wrapper.mjs\n',
    )
    return 1
  }
  if ((statSync(wrapperFile).mode & 0o111) === 0) {
    process.stderr.write(
      `build-python-wrapper: ${displayPath} is not executable; ` +
        'run node tools/build-python-wrapper.mjs\n',
    )
    return 1
  }
  process.stdout.write(`build-python-wrapper: ${displayPath} is up to date\n`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
