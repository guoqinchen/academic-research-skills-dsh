/**
 * Filesystem-aware reference policy.
 *
 * `reference-rules.js` owns the conventions; this module binds them to one
 * payload layout and one inventory. Adapt, agent registration, guard, status,
 * and tools read paths and conventions here instead of re-joining the layout.
 *
 * @module reference-policy
 */
import { join } from 'node:path'
import {
  PAYLOAD_ROOT_FILES,
  PAYLOAD_ROOT_PREFIXES,
  SKILL_LOCAL_PREFIXES,
  classifyReference,
  resolveReference,
  resolveScriptPath,
  skillScriptDirectory,
} from './reference-rules.js'

/**
 * @param {{paths: object, inventory: object}} options
 */
export function createReferencePolicy({ paths, inventory }) {
  const wrapperPath = join(paths.pluginRoot, 'bin', 'ars-python')
  const phaseManifest = join(paths.scriptsRoot, 'ars_phase_scope_manifest.json')
  const guardScript = join(paths.scriptsRoot, 'ars_write_scope_guard.py')

  const skillDirectory = (name) => join(paths.payloadRoot, name)
  const skillFile = (name) => join(paths.payloadRoot, name, 'SKILL.md')
  const commandFile = (file) => join(paths.commandsRoot, file)
  const agentMirror = (agentType) => {
    const entry = inventory.agentRoleByType(agentType)
    return entry === undefined || entry.mirror === null ? null : entry.mirror
  }
  const agentMirrorDirectory = (agentType) => {
    const mirror = agentMirror(agentType)
    return mirror === null ? null : join(paths.payloadRoot, mirror)
  }
  const scriptDirectory = (skill) => skillScriptDirectory(skill, paths.payloadRoot)
  const resolve = (raw, options = {}) => {
    const skill = options.skill ?? null
    return resolveReference(raw, {
      skill,
      payloadRoot: paths.payloadRoot,
      skillDir: skill === null ? null : join(paths.payloadRoot, skill),
    })
  }
  const resolveScript = (raw, options = {}) =>
    resolveScriptPath(raw, { skill: options.skill ?? null, payloadRoot: paths.payloadRoot })
  const conventionsText = (skill) => {
    const directory = skill === null ? null : skillDirectory(skill)
    const lines = []
    if (directory !== null) {
      lines.push(`- Skill directory: \`${directory}\`.`)
      lines.push('- Skill-relative prefixes — resolve against the skill directory: `references/`, `agents/`, `templates/`, `examples/`.')
    }
    lines.push('- Payload-root-relative prefixes — resolve against the payload root: `shared/`, `scripts/`, `docs/`, `tools/`, `MODE_REGISTRY.md`, and every other skill name.')
    if (skill === 'sr-screener') {
      lines.push(`- This skill also carries its own scripts: in \`sr-screener\`, \`scripts/\` resolves against \`${join(directory, 'scripts')}\`, not against the payload root.`)
    }
    return lines
  }

  return {
    wrapperPath,
    phaseManifest,
    guardScript,
    skillLocalPrefixes: SKILL_LOCAL_PREFIXES,
    payloadRootPrefixes: PAYLOAD_ROOT_PREFIXES,
    payloadRootFiles: PAYLOAD_ROOT_FILES,
    skillDirectory,
    skillFile,
    commandFile,
    agentMirror,
    agentMirrorDirectory,
    scriptDirectory,
    classify: classifyReference,
    resolveReference: resolve,
    resolveScriptPath: resolveScript,
    conventionsText,
  }
}
