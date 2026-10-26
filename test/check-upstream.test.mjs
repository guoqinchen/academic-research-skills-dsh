import test from 'node:test'
import assert from 'node:assert/strict'

import { compareContract, compareFileSets } from '../tools/check-upstream.mjs'

function file(path, sha256, mode = 0o644, bytes = 1) {
  return { path, sha256, mode, bytes }
}

test('compareFileSets reports added, removed, content, and mode changes', () => {
  const upstream = [
    file('a.md', 'a'),
    file('b.md', 'b'),
    file('c.md', 'c'),
    file('mode.md', 'm', 0o644),
  ]
  const payload = [
    file('a.md', 'a'),
    file('b.md', 'B'),
    file('d.md', 'd'),
    file('mode.md', 'm', 0o755),
  ]
  const diff = compareFileSets(upstream, payload)
  assert.deepEqual(diff.added.map((entry) => entry.path), ['c.md'])
  assert.deepEqual(diff.removed.map((entry) => entry.path), ['d.md'])
  assert.deepEqual(diff.changed.map((entry) => entry.path), ['b.md', 'mode.md'])
})

test('compareFileSets is empty for identical inventories', () => {
  const files = [file('a.md', 'a'), file('b.md', 'b')]
  const diff = compareFileSets(files, files.map((entry) => ({ ...entry })))
  assert.deepEqual(diff, { added: [], removed: [], changed: [] })
})

test('compareContract reports snapshot and group drift', () => {
  const failures = compareContract({
    totals: { files: 1, bytes: 1, directories: 1, modes: { 644: 1 } },
    contentSha256: 'nope',
    pathListSha256: 'nope',
    byTopLevel: {},
  })
  const labels = failures.map((entry) => entry.label)
  assert.ok(labels.includes('payload.files'))
  assert.ok(labels.includes('payload.contentSha256'))
  assert.ok(labels.includes('byTopLevel.deep-research'))
})
