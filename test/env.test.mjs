import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeConfig } from '../lib/config.js'
import { createPaths } from '../lib/paths.js'
import { DEPENDENCY_MODULES, createPythonEnv, venvPythonPath } from '../lib/env.js'
import {
  buildScriptEnv,
  defaultCacheRoot,
  defaultEnvDir,
  renderWrapper,
  resolvePythonExecutable,
  runtimeStatePath,
} from '../lib/python-contract.js'

const isPosix = process.platform !== 'win32'
const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))

function tempDir(prefix = 'ars-env-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return dir
}

function makePaths(root) {
  return createPaths(root)
}

function createFakeVenvPython(envDir) {
  const python = venvPythonPath(envDir)
  mkdirSync(dirname(python), { recursive: true })
  writeFileSync(python, '#!/bin/sh\nexit 0\n')
  return python
}

function makeConfig(home, overrides = {}) {
  return normalizeConfig({ envDir: join(home, 'venv'), ...overrides }, { home })
}

function ok(stdout = '') {
  return { code: 0, stdout, stderr: '', error: null }
}

function fail(code = 1, stderr = 'failed') {
  return { code, stdout: '', stderr, error: null }
}

function enoent(message = 'spawn ENOENT') {
  return { code: null, stdout: '', stderr: '', error: Object.assign(new Error(message), { code: 'ENOENT' }) }
}

/**
 * Injected process runner: models uv, venv creation, pip, and the dependency
 * probe without touching the network or the user's cache.
 */
function fakeRuntime({ uvAvailable = true, missing = [...DEPENDENCY_MODULES], probeFails = false, installSucceeds = true } = {}) {
  const state = {
    calls: [],
    missing: [...missing],
    uvAvailable,
    probeFails,
    installSucceeds,
    venvCreated: false,
  }
  async function run(command, args, options = {}) {
    state.calls.push({ command, args, options })
    if (args[0] === '--version') {
      if (command === 'uv') return state.uvAvailable ? ok('uv 0.11.27\n') : enoent('spawn uv ENOENT')
      return ok('Python 3.11.9\n')
    }
    if (args[0] === '-c') {
      if (state.probeFails) return enoent('spawn python ENOENT')
      return ok(`${JSON.stringify({ version: '3.11.9', missing: state.missing })}\n`)
    }
    // uv venv / python -m venv
    const creatingVenv =
      (command === 'uv' && args[0] === 'venv') || (args[0] === '-m' && args[1] === 'venv')
    if (creatingVenv) {
      const envDir = args[args.length - 1]
      createFakeVenvPython(envDir)
      state.venvCreated = true
      return ok()
    }
    // uv pip install / <venvPython> -m pip install
    const installing =
      (command === 'uv' && args[0] === 'pip') || (args[0] === '-m' && args[1] === 'pip')
    if (installing) {
      if (!state.installSucceeds) return fail(1, 'install exploded')
      state.missing = []
      return ok()
    }
    // Defensive: an unexpected probe command.
    return fail(127, `unexpected command ${command} ${args.join(' ')}`)
  }
  run.state = state
  return run
}

function hasCall(run, predicate) {
  return run.state.calls.some(predicate)
}

test('status reports an unavailable interpreter without throwing', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home, { pythonPath: join(home, 'missing-python') })
  const env = createPythonEnv({ paths, config, run: enoent })
  const status = await env.status()
  assert.equal(status.mode, 'unavailable')
  assert.equal(status.ready, false)
  assert.equal(status.pythonVersion, null)
  assert.deepEqual(status.missing, [...DEPENDENCY_MODULES])
  assert.equal(status.executable, join(home, 'missing-python'))
  assert.equal(status.venvPath, join(home, 'venv'))
  assert.equal(status.uv, false)
})

test('status reports missing dependencies in system mode', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home, { pythonPath: '/usr/bin/python3' })
  const run = fakeRuntime({ missing: ['yaml', 'pypdf'] })
  const env = createPythonEnv({ paths, config, run })
  const status = await env.status()
  assert.equal(status.mode, 'system')
  assert.equal(status.ready, false)
  assert.deepEqual(status.missing, ['yaml', 'pypdf'])
  assert.equal(status.pythonVersion, '3.11.9')
  assert.equal(status.uv, true)
})

test('status reports a ready managed venv', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home)
  const run = fakeRuntime({ missing: [] })
  createFakeVenvPython(config.envDir)
  const env = createPythonEnv({ paths, config, run })
  const status = await env.status()
  assert.equal(status.mode, 'venv')
  assert.equal(status.ready, true)
  assert.deepEqual(status.missing, [])
  assert.equal(status.pythonVersion, '3.11.9')
  assert.equal(status.executable, venvPythonPath(config.envDir))
})

test('pythonExecutable prefers the managed venv, then config.pythonPath, then python3', () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home, { pythonPath: '/opt/py/bin/python' })
  const env = createPythonEnv({ paths, config, run: enoent })
  assert.equal(env.pythonExecutable(), '/opt/py/bin/python')
  createFakeVenvPython(config.envDir)
  assert.equal(env.pythonExecutable(), venvPythonPath(config.envDir))

  const home2 = tempDir()
  const config2 = makeConfig(home2)
  const env2 = createPythonEnv({ paths: makePaths(home2), config: config2, run: enoent })
  assert.equal(env2.pythonExecutable(), 'python3')
})

test('scriptEnv prepends the payload root and exports the venv when present', () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home)
  const env = createPythonEnv({ paths, config, run: enoent })

  const before = process.env.PYTHONPATH
  process.env.PYTHONPATH = '/existing/path'
  try {
    let scriptEnv = env.scriptEnv()
    assert.equal(scriptEnv.ARS_PAYLOAD_ROOT, paths.payloadRoot)
    assert.equal(scriptEnv.PYTHONPATH, `${paths.payloadRoot}:${'/existing/path'}`)
    assert.equal(scriptEnv.ARS_DSH_VENV, undefined)

    createFakeVenvPython(config.envDir)
    scriptEnv = env.scriptEnv()
    assert.equal(scriptEnv.ARS_DSH_VENV, config.envDir)
  } finally {
    if (before === undefined) delete process.env.PYTHONPATH
    else process.env.PYTHONPATH = before
  }
})

test('ensure creates the venv with uv and installs the runtime requirements', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home)
  writeFileSync(paths.requirementsPath, 'pyyaml\n')
  const run = fakeRuntime({ missing: [...DEPENDENCY_MODULES] })
  const env = createPythonEnv({ paths, config, run })

  const result = await env.ensure()
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'venv')
  assert.equal(result.venvPath, config.envDir)
  assert.equal(result.python, venvPythonPath(config.envDir))
  assert.ok(result.installed.includes('pyyaml'))
  assert.ok(result.installed.includes('markdown-it-py'))
  assert.match(result.log, /uv venv/)
  assert.match(result.log, /uv pip install/)
  assert.ok(result.log.includes('status after: mode=venv ready=true'))

  assert.ok(
    hasCall(run, (call) => call.command === 'uv' && call.args[0] === 'venv' && call.args.includes(config.envDir)),
  )
  assert.ok(
    hasCall(
      run,
      (call) =>
        call.command === 'uv' &&
        call.args[0] === 'pip' &&
        call.args.includes('--python') &&
        call.args.includes(paths.requirementsPath),
    ),
  )
})

test('ensure falls back to python -m venv plus pip when uv is absent', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home, { pythonPath: 'python3.11' })
  writeFileSync(paths.requirementsPath, 'pyyaml\n')
  const run = fakeRuntime({ uvAvailable: false, missing: [...DEPENDENCY_MODULES] })
  const env = createPythonEnv({ paths, config, run })

  const result = await env.ensure()
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'venv')
  assert.match(result.log, /python3\.11 -m venv/)
  assert.ok(
    hasCall(run, (call) => call.command === 'python3.11' && call.args[0] === '-m' && call.args[1] === 'venv'),
  )
  assert.ok(
    hasCall(
      run,
      (call) => call.command === venvPythonPath(config.envDir) && call.args[0] === '-m' && call.args[1] === 'pip',
    ),
  )
})

test('ensure does nothing when the managed environment is already ready', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home)
  writeFileSync(paths.requirementsPath, 'pyyaml\n')
  createFakeVenvPython(config.envDir)
  const run = fakeRuntime({ missing: [] })
  const env = createPythonEnv({ paths, config, run })

  const result = await env.ensure()
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'venv')
  assert.deepEqual(result.installed, [])
  assert.ok(!hasCall(run, (call) => call.args[0] === 'pip'))
})

test('ensure reinstalls on force even when ready', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home)
  writeFileSync(paths.requirementsPath, 'pyyaml\n')
  createFakeVenvPython(config.envDir)
  const run = fakeRuntime({ missing: [] })
  const env = createPythonEnv({ paths, config, run })

  const result = await env.ensure({ force: true })
  assert.equal(result.ok, true)
  assert.ok(hasCall(run, (call) => call.command === 'uv' && call.args[0] === 'pip'))
})

test('ensure reports failure when the install fails and dependencies stay missing', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home)
  writeFileSync(paths.requirementsPath, 'pyyaml\n')
  const run = fakeRuntime({ uvAvailable: false, missing: [...DEPENDENCY_MODULES], installSucceeds: false })
  const env = createPythonEnv({ paths, config, run })

  const result = await env.ensure()
  assert.equal(result.ok, false)
  assert.match(result.log, /pip install exit=1/)
  assert.deepEqual(result.installed, [])
})

test('ensure fails clearly when requirements-runtime.txt is missing', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home)
  const run = fakeRuntime()
  const env = createPythonEnv({ paths, config, run })

  const result = await env.ensure()
  assert.equal(result.ok, false)
  assert.match(result.log, /requirements file not found/)
})

test('status survives a runner that throws', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home)
  const env = createPythonEnv({
    paths,
    config,
    run: async () => {
      throw new Error('boom')
    },
  })
  const status = await env.status()
  assert.equal(status.ready, false)
  assert.equal(status.mode, 'unavailable')
})

test('real interpreter probe works without requiring installed dependencies', async (t) => {
  const probe = spawnSync('python3', ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    t.skip('python3 not available on this host')
    return
  }
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home, { pythonPath: 'python3' })
  const env = createPythonEnv({ paths, config })
  const status = await env.status()
  assert.equal(status.mode, 'system')
  assert.match(status.pythonVersion, /^\d+\.\d+/)
  assert.equal(status.ready, status.missing.length === 0)
})

test('bin/ars-python forwards arguments and exports the payload environment', (t) => {
  if (!isPosix) {
    t.skip('POSIX shell wrapper')
    return
  }
  const root = tempDir('ars-wrapper-')
  const binDir = join(root, 'bin')
  const payload = join(root, 'payload')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(payload, { recursive: true })
  const realPayload = realpathSync(payload)
  const wrapper = join(binDir, 'ars-python')
  copyFileSync(join(PLUGIN_ROOT, 'bin', 'ars-python'), wrapper)
  chmodSync(wrapper, 0o755)

  const fakeVenv = join(root, 'fake-venv')
  mkdirSync(join(fakeVenv, 'bin'), { recursive: true })
  const fakePython = join(fakeVenv, 'bin', 'python')
  writeFileSync(
    fakePython,
    '#!/bin/sh\necho "FAKE_VENV_PYTHON"\necho "PYTHONPATH=$PYTHONPATH"\necho "ARS_PAYLOAD_ROOT=$ARS_PAYLOAD_ROOT"\nfor arg in "$@"; do echo "ARG=$arg"; done\n',
  )
  chmodSync(fakePython, 0o755)

  const result = spawnSync('sh', [wrapper, 'one two', 'three'], {
    encoding: 'utf8',
    env: { ...process.env, ARS_DSH_VENV: fakeVenv, PYTHONPATH: '/pre/existing' },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /FAKE_VENV_PYTHON/)
  assert.match(result.stdout, new RegExp(`PYTHONPATH=${realPayload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:/pre/existing`))
  assert.match(result.stdout, new RegExp(`ARS_PAYLOAD_ROOT=${realPayload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.match(result.stdout, /ARG=one two/)
  assert.match(result.stdout, /ARG=three/)
})

test('bin/ars-python falls back to python3 outside a payload layout', (t) => {
  if (!isPosix) {
    t.skip('POSIX shell wrapper')
    return
  }
  const probe = spawnSync('python3', ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    t.skip('python3 not available on this host')
    return
  }
  const root = tempDir('ars-wrapper-flat-')
  const home = tempDir('ars-wrapper-home-')
  const binDir = join(root, 'bin')
  mkdirSync(binDir, { recursive: true })
  const wrapper = join(binDir, 'ars-python')
  copyFileSync(join(PLUGIN_ROOT, 'bin', 'ars-python'), wrapper)
  chmodSync(wrapper, 0o755)

  const result = spawnSync('sh', [wrapper, '-c', 'import os;print("OK")'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, ARS_DSH_VENV: '', PYTHONPATH: '' },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'OK')
  const env = readFileSync(join(binDir, 'ars-python'), 'utf8')
  assert.match(env, /ARS_DSH_VENV/)
})

test('the python contract owns defaults, paths, and the child environment policy', () => {
  const home = tempDir('ars-contract-')
  const config = normalizeConfig({}, { home })
  assert.equal(config.cacheRoot, defaultCacheRoot(home))
  assert.equal(config.envDir, defaultEnvDir(defaultCacheRoot(home)))
  assert.equal(config.envDir, join(home, '.cache', 'ars-dsh', 'venv'))
  assert.equal(runtimeStatePath(home), join(home, '.cache', 'ars-dsh', 'runtime-state'))
  assert.equal(defaultEnvDir('/custom/cache'), join('/custom/cache', 'venv'))

  assert.equal(venvPythonPath('/venv'), join('/venv', 'bin', 'python'))
  assert.equal(venvPythonPath('/venv', 'win32'), join('/venv', 'Scripts', 'python.exe'))

  assert.equal(
    resolvePythonExecutable({ envDir: '/venv', hasVenv: true, pythonPath: '/system/python' }),
    join('/venv', 'bin', 'python'),
  )
  assert.equal(resolvePythonExecutable({ envDir: '/venv', hasVenv: false, pythonPath: '/system/python' }), '/system/python')
  assert.equal(resolvePythonExecutable({ envDir: '/venv', hasVenv: false, pythonPath: null }), 'python3')

  const built = buildScriptEnv({
    baseEnv: { PYTHONPATH: '/base', KEEP: '1' },
    payloadRoot: '/payload',
    envDir: '/venv',
    hasVenv: true,
  })
  assert.equal(built.PYTHONPATH, `/payload${delimiter}/base`)
  assert.equal(built.ARS_PAYLOAD_ROOT, '/payload')
  assert.equal(built.PYTHONDONTWRITEBYTECODE, '1')
  assert.equal(built.ARS_DSH_VENV, '/venv')
  assert.equal(built.KEEP, '1')

  const noVenv = buildScriptEnv({ baseEnv: {}, payloadRoot: '/payload', envDir: '/venv', hasVenv: false })
  assert.equal(noVenv.PYTHONPATH, '/payload')
  assert.equal(noVenv.ARS_DSH_VENV, undefined)

  const paths = createPaths()
  const env = createPythonEnv({ paths, config, run: enoent })
  assert.equal(env.wrapperPath(), join(PLUGIN_ROOT, 'bin', 'ars-python'))
})

test('bin/ars-python is generated from the contract template', () => {
  const checkedIn = readFileSync(join(PLUGIN_ROOT, 'bin', 'ars-python'), 'utf8')
  assert.equal(checkedIn, renderWrapper(), 'checked-in wrapper must equal renderWrapper()')

  const check = spawnSync(
    process.execPath,
    [join(PLUGIN_ROOT, 'tools', 'build-python-wrapper.mjs'), '--check'],
    { encoding: 'utf8' },
  )
  assert.equal(check.status, 0, check.stderr || check.stdout)
  assert.match(check.stdout, /up to date/u)
})

test('writeRuntimeState records the configured envDir under the default cache root', () => {
  const home = tempDir('ars-state-home-')
  const customEnvDir = join(tempDir('ars-state-venv-'), 'custom', 'venv')
  const paths = createPaths()
  const config = normalizeConfig({ envDir: customEnvDir }, { home })
  const env = createPythonEnv({ paths, config, run: enoent, home })
  const stateFile = runtimeStatePath(home)

  assert.equal(existsSync(stateFile), false)
  assert.equal(env.writeRuntimeState(), true)
  assert.equal(readFileSync(stateFile, 'utf8'), `${customEnvDir}\n`)
  assert.equal(env.writeRuntimeState(), true, 'rewriting is idempotent')

  // Never throws: an unwritable state path reports false instead.
  const blocker = join(tempDir('ars-state-blocker-'), 'not-a-directory')
  writeFileSync(blocker, 'file')
  const failing = createPythonEnv({
    paths,
    config: normalizeConfig({ envDir: customEnvDir }, { home: blocker }),
    run: enoent,
    home: blocker,
  })
  assert.equal(failing.writeRuntimeState(), false)
})

test('JS and shell resolution agree for the default and a custom envDir', (t) => {
  if (!isPosix) {
    t.skip('POSIX shell wrapper')
    return
  }
  const wrapper = join(PLUGIN_ROOT, 'bin', 'ars-python')
  const paths = createPaths()
  const savedPythonPath = process.env.PYTHONPATH
  process.env.PYTHONPATH = '/parity/base'
  try {
    /** Fake interpreter that reports the environment both paths must produce. */
    function writeProbePython(envDir, marker) {
      const python = venvPythonPath(envDir)
      mkdirSync(dirname(python), { recursive: true })
      writeFileSync(
        python,
        [
          '#!/bin/sh',
          `echo "MARKER=${marker}"`,
          'echo "SELF=$0"',
          'echo "PYTHONPATH=$PYTHONPATH"',
          'echo "ARS_PAYLOAD_ROOT=$ARS_PAYLOAD_ROOT"',
          'echo "PYTHONDONTWRITEBYTECODE=$PYTHONDONTWRITEBYTECODE"',
          'echo "ARS_DSH_VENV=$ARS_DSH_VENV"',
          'for arg in "$@"; do echo "ARG=$arg"; done',
          '',
        ].join('\n'),
      )
      chmodSync(python, 0o755)
      return python
    }

    function runWrapper(home, extraEnv = {}) {
      const result = spawnSync('sh', [wrapper, 'gate.py', 'two words'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home, ARS_DSH_VENV: '', ...extraEnv },
      })
      assert.equal(result.status, 0, result.stderr)
      const lines = result.stdout.trim().split('\n')
      const output = {}
      for (const line of lines) {
        const index = line.indexOf('=')
        if (index > 0) output[line.slice(0, index)] = line.slice(index + 1)
      }
      output.lines = lines
      return output
    }

    // Default envDir: both paths pick the managed venv under this HOME.
    const home = tempDir('ars-parity-home-')
    const defaultConfig = normalizeConfig({}, { home })
    assert.equal(defaultConfig.envDir, defaultEnvDir(defaultCacheRoot(home)))
    const defaultPython = writeProbePython(defaultConfig.envDir, 'DEFAULT')
    const defaultEnv = createPythonEnv({ paths, config: defaultConfig, run: enoent, home })
    const jsDefault = defaultEnv.scriptEnv()
    assert.equal(defaultEnv.pythonExecutable(), defaultPython)
    assert.equal(jsDefault.ARS_PAYLOAD_ROOT, paths.payloadRoot)
    assert.equal(jsDefault.PYTHONPATH, `${paths.payloadRoot}${delimiter}/parity/base`)
    assert.equal(jsDefault.PYTHONDONTWRITEBYTECODE, '1')
    assert.equal(jsDefault.ARS_DSH_VENV, defaultConfig.envDir)

    const shellDefault = runWrapper(home)
    assert.equal(shellDefault.MARKER, 'DEFAULT')
    assert.equal(shellDefault.SELF, defaultEnv.pythonExecutable(), 'default: wrapper and JS agree on the interpreter')
    assert.equal(shellDefault.PYTHONPATH, jsDefault.PYTHONPATH)
    assert.equal(shellDefault.ARS_PAYLOAD_ROOT, jsDefault.ARS_PAYLOAD_ROOT)
    assert.equal(shellDefault.PYTHONDONTWRITEBYTECODE, jsDefault.PYTHONDONTWRITEBYTECODE)
    assert.equal(shellDefault.ARS_DSH_VENV, jsDefault.ARS_DSH_VENV)
    assert.ok(shellDefault.lines.includes('ARG=two words'), shellDefault.lines.join('\n'))

    // Custom envDir: the state file written by env.writeRuntimeState() is what
    // makes a model-issued `bash bin/ars-python` find it.
    const customHome = tempDir('ars-parity-custom-home-')
    const customEnvDir = join(tempDir('ars-parity-custom-'), 'nested', 'venv')
    const customPython = writeProbePython(customEnvDir, 'CUSTOM')
    const customConfig = normalizeConfig({ envDir: customEnvDir }, { home: customHome })
    const customEnv = createPythonEnv({ paths, config: customConfig, run: enoent, home: customHome })
    assert.equal(customEnv.pythonExecutable(), customPython)
    assert.equal(existsSync(runtimeStatePath(customHome)), false)
    assert.equal(customEnv.writeRuntimeState(), true)

    const jsCustom = customEnv.scriptEnv()
    assert.equal(jsCustom.ARS_DSH_VENV, customEnvDir)
    assert.equal(jsCustom.PYTHONPATH, `${paths.payloadRoot}${delimiter}/parity/base`)

    const shellCustom = runWrapper(customHome)
    assert.equal(shellCustom.MARKER, 'CUSTOM', 'runtime-state file must select the custom envDir')
    assert.equal(shellCustom.SELF, customEnv.pythonExecutable(), 'custom: wrapper and JS agree on the interpreter')
    assert.equal(shellCustom.PYTHONPATH, jsCustom.PYTHONPATH)
    assert.equal(shellCustom.ARS_PAYLOAD_ROOT, jsCustom.ARS_PAYLOAD_ROOT)
    assert.equal(shellCustom.PYTHONDONTWRITEBYTECODE, jsCustom.PYTHONDONTWRITEBYTECODE)
    assert.equal(shellCustom.ARS_DSH_VENV, jsCustom.ARS_DSH_VENV)

    // ARS_DSH_VENV outranks the state file.
    const explicitEnvDir = join(tempDir('ars-parity-explicit-'), 'venv')
    const explicitPython = writeProbePython(explicitEnvDir, 'EXPLICIT')
    const explicit = runWrapper(customHome, { ARS_DSH_VENV: explicitEnvDir })
    assert.equal(explicit.MARKER, 'EXPLICIT')
    assert.equal(explicit.SELF, explicitPython)
  } finally {
    if (savedPythonPath === undefined) delete process.env.PYTHONPATH
    else process.env.PYTHONPATH = savedPythonPath
  }
})

test('ensure serializes concurrent setup calls behind one lock', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home)
  writeFileSync(paths.requirementsPath, 'pyyaml\n')
  const run = fakeRuntime({ missing: [...DEPENDENCY_MODULES] })
  const env = createPythonEnv({ paths, config, run })

  const [first, second] = await Promise.all([env.ensure(), env.ensure()])
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  const venvCalls = run.state.calls.filter((call) => call.command === 'uv' && call.args[0] === 'venv')
  const installCalls = run.state.calls.filter((call) => call.command === 'uv' && call.args[0] === 'pip')
  assert.equal(venvCalls.length, 1, 'concurrent ensure must create the venv once')
  assert.equal(installCalls.length, 1, 'concurrent ensure must install once')
  assert.equal(existsSync(config.envDir + '.lock'), false, 'the lock file is released')
})

test('ensure force rebuilds a broken managed virtualenv', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home)
  writeFileSync(paths.requirementsPath, 'pyyaml\n')
  createFakeVenvPython(config.envDir)
  const run = fakeRuntime({ missing: ['yaml'] })
  const env = createPythonEnv({ paths, config, run })

  const result = await env.ensure({ force: true })
  assert.equal(result.ok, true)
  assert.match(result.log, /force: removing the existing managed virtualenv/)
  assert.ok(
    hasCall(run, (call) => call.command === 'uv' && call.args[0] === 'venv'),
    'force must recreate the venv',
  )
})

test('scriptEnv drops an inherited ARS_DSH_VENV when no managed venv exists', async () => {
  const home = tempDir()
  const paths = makePaths(home)
  const config = makeConfig(home, { pythonPath: '/usr/bin/python3' })
  const run = fakeRuntime({ missing: ['yaml'] })
  const env = createPythonEnv({ paths, config, run })
  const previous = process.env.ARS_DSH_VENV
  process.env.ARS_DSH_VENV = join(home, 'not-our-venv')
  try {
    assert.equal(env.scriptEnv().ARS_DSH_VENV, undefined)
  } finally {
    if (previous === undefined) delete process.env.ARS_DSH_VENV
    else process.env.ARS_DSH_VENV = previous
  }
})
