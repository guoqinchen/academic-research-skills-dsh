import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/** Absolute directory of the installed plugin package. */
export const DEFAULT_PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Resolve every directory the plugin reads.
 *
 * The payload keeps the upstream repository layout verbatim so that paths inside
 * the ported Markdown continue to resolve. Skills therefore live at
 * `<payloadRoot>/<skill>/SKILL.md`, not under a synthetic `skills/` folder.
 *
 * @param {string} [pluginRoot] absolute plugin package directory
 * @returns {{pluginRoot: string, payloadRoot: string, commandsRoot: string,
 *   agentsRoot: string, scriptsRoot: string, sharedRoot: string, docsRoot: string,
 *   hooksRoot: string, binRoot: string, requirementsPath: string,
 *   provenancePath: string, referenceIndexPath: string}}
 */
export function createPaths(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const payloadRoot = join(pluginRoot, 'payload')
  return {
    pluginRoot,
    payloadRoot,
    commandsRoot: join(payloadRoot, 'commands'),
    agentsRoot: join(payloadRoot, 'agents'),
    scriptsRoot: join(payloadRoot, 'scripts'),
    sharedRoot: join(payloadRoot, 'shared'),
    docsRoot: join(payloadRoot, 'docs'),
    hooksRoot: join(payloadRoot, 'hooks'),
    binRoot: join(pluginRoot, 'bin'),
    requirementsPath: join(pluginRoot, 'requirements-runtime.txt'),
    provenancePath: join(payloadRoot, 'PROVENANCE.json'),
    referenceIndexPath: join(payloadRoot, 'REFERENCE-INDEX.json'),
    phaseManifestPath: join(payloadRoot, 'scripts', 'ars_phase_scope_manifest.json'),
    guardScriptPath: join(payloadRoot, 'scripts', 'ars_write_scope_guard.py'),
    wrapperPath: join(pluginRoot, 'bin', 'ars-python'),
    skillFile: (skill) => join(payloadRoot, skill, 'SKILL.md'),
    skillDirectory: (skill) => join(payloadRoot, skill),
    commandFile: (file) => join(payloadRoot, 'commands', file),
  }
}

/** Resolve one skill directory inside the payload. */
export function skillDir(paths, skill) {
  return join(paths.payloadRoot, skill)
}
