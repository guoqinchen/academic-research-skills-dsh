import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_CONFIG, normalizeConfig } from '../lib/config.js'

test('commercialMode defaults to false and accepts explicit booleans', () => {
  const home = '/tmp/ars-config-test'
  assert.equal(DEFAULT_CONFIG.commercialMode, false)
  assert.equal(normalizeConfig({}, { home }).commercialMode, false)
  assert.equal(normalizeConfig({ commercialMode: true }, { home }).commercialMode, true)
  assert.equal(normalizeConfig({ commercialMode: 'true' }, { home }).commercialMode, true)
  assert.equal(normalizeConfig({ commercialMode: 'off' }, { home }).commercialMode, false)
})
