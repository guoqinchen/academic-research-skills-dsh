/**
 * Single owner of the ARS surface inventory.
 *
 * The plugin used to carry the same skill, command, and agent-role lists in
 * five runtime modules plus tooling and tests. This module derives those
 * surfaces from the immutable payload once and exposes them through one small
 * interface:
 *
 *   createInventory({ paths }) -> {
 *     skillNames, agentRoleNames, commandNames,
 *     skills, agentRoles, commands,
 *     skill(name), agentRole(name), command(name),
 *     errors
 *   }
 *
 * Skills and commands are directory-derived. The four plugin-exposed agent
 * files are byte-identical mirrors of one skill's `agents/` copy, so the mirror
 * skill is derived by content comparison instead of a second hand-written
 * mapping. The explicit `SKILL_NAMES` and `AGENT_ROLE_SPECS` declarations are
 * the only name lists in the shipped runtime; everything else reads them.
 *
 * @module inventory
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMarkdownFile } from './frontmatter.js'
import { SKILL_NAMES } from './payload-contract.js'

export { SKILL_NAMES }

/** The four plugin-exposed agent roles and the file that defines each one. */
export const AGENT_ROLE_SPECS = Object.freeze([
  { file: 'synthesis_agent.md', skill: 'ars-agent-synthesis' },
  { file: 'research_architect_agent.md', skill: 'ars-agent-research-architect' },
  { file: 'report_compiler_agent.md', skill: 'ars-agent-report-compiler' },
  { file: 'screening_reviewer_agent.md', skill: 'ars-agent-screening-reviewer' },
])

/**
 * Fallback command names, used only when the payload commands directory cannot
 * be read (for example a degraded `ars_status` call). The live list is always
 * derived from the payload.
 */
export const COMMAND_FALLBACK_NAMES = Object.freeze([
  'ars-3w',
  'ars-abstract',
  'ars-cache-invalidate',
  'ars-citation-check',
  'ars-disclosure',
  'ars-format-convert',
  'ars-full',
  'ars-lit-review',
  'ars-mark-read',
  'ars-outline',
  'ars-plan',
  'ars-rebuttal-audit',
  'ars-reviewer',
  'ars-revision',
  'ars-revision-coach',
  'ars-unmark-read',
])

/** AGENT_NAME_TO_SKILL derived from the one role-spec list. */
export const AGENT_NAME_TO_SKILL = Object.freeze(Object.fromEntries(
  AGENT_ROLE_SPECS.map((entry) => [entry.file.replace(/\.md$/u, ''), entry.skill]),
))

function readDocument(file, label) {
  if (!existsSync(file)) throw new Error(`academic-research-skills: missing ${label}: ${file}`)
  return parseMarkdownFile(readFileSync(file, 'utf8'))
}

function readSkills(paths, errors, strict) {
  const skills = []
  for (const skill of SKILL_NAMES) {
    const directory = join(paths.payloadRoot, skill)
    const file = join(directory, 'SKILL.md')
    let parsed
    try {
      parsed = readDocument(file, `skill file ${skill}`)
      const name = typeof parsed.data.name === 'string' ? parsed.data.name : ''
      const description = typeof parsed.data.description === 'string' ? parsed.data.description : ''
      if (name !== skill) throw new Error(`skill name "${name}" does not match directory "${skill}"`)
      if (description.length === 0) throw new Error(`skill "${skill}" has no description`)
      skills.push({
        kind: 'skill',
        name,
        description,
        data: parsed.data,
        body: parsed.body,
        file,
        directory,
        metadata: parsed.data.metadata,
        valid: true,
      })
    } catch (error) {
      errors.push({ kind: 'skill', name: skill, message: error instanceof Error ? error.message : String(error) })
      if (strict) throw error
      if (parsed !== undefined) {
        skills.push({
          kind: 'skill',
          name: skill,
          description: typeof parsed.data.description === 'string' ? parsed.data.description : '',
          data: parsed.data,
          body: parsed.body,
          file,
          directory,
          metadata: parsed.data.metadata,
          valid: false,
        })
      }
    }
  }
  return skills
}

function readCommands(paths, errors, strict) {
  const directory = paths.commandsRoot
  let files = []
  try {
    files = readdirSync(directory).filter((file) => file.endsWith('.md')).sort((a, b) => a.localeCompare(b))
  } catch (error) {
    errors.push({ kind: 'commands', name: null, message: error instanceof Error ? error.message : String(error) })
    if (strict) throw error
    return []
  }
  const commands = []
  for (const file of files) {
    try {
      commands.push(readCommandEntry(paths, join(directory, file)))
    } catch (error) {
      errors.push({ kind: 'command', name: file, message: error instanceof Error ? error.message : String(error) })
      if (strict) throw error
      try {
        const parsed = readDocument(join(directory, file), `command file ${file}`)
        commands.push({
          kind: 'command',
          name: typeof parsed.data.name === 'string' ? parsed.data.name : file.replace(/\.md$/u, ''),
          description: typeof parsed.data.description === 'string' ? parsed.data.description : '',
          data: parsed.data,
          body: parsed.body,
          file: join(directory, file),
          skill: null,
          hint: '[arguments]',
          disableModelInvocation: false,
          valid: false,
        })
      } catch {
        /* unreadable command is already reported */
      }
    }
  }
  return commands
}

/**
 * Read and validate one command file. Shared by inventory discovery and the
 * compatibility `readCommand` wrapper so validation exists once.
 *
 * @param {{commandsRoot: string}} paths
 * @param {string} file absolute command file path
 */
export function readCommandEntry(paths, file) {
  const parsed = readDocument(file, `command file ${file}`)
  const name = typeof parsed.data.name === 'string' ? parsed.data.name : ''
  const description = typeof parsed.data.description === 'string' ? parsed.data.description : ''
  if (name.length === 0) throw new Error(`command ${file} has no name`)
  if (description.length === 0) throw new Error(`command ${file} has no description`)
  const upstreamSkill = /academic-research-skills:([a-z0-9-]+)/u.exec(parsed.body)
  const skill = upstreamSkill === null ? null : upstreamSkill[1]
  const hint = typeof parsed.data['argument-hint'] === 'string'
    ? parsed.data['argument-hint']
    : skill === null ? '[arguments]' : '[request]'
  return {
    kind: 'command',
    name,
    description,
    data: parsed.data,
    body: parsed.body,
    file,
    skill,
    hint,
    disableModelInvocation: parsed.data['disable-model-invocation'] === true,
  }
}

function readAgentRoles(paths, errors, strict) {
  const roles = []
  for (const spec of AGENT_ROLE_SPECS) {
    const file = join(paths.agentsRoot, spec.file)
    try {
      const parsed = readDocument(file, `agent file ${spec.file}`)
      const agentType = typeof parsed.data.name === 'string'
        ? parsed.data.name
        : spec.file.replace(/\.md$/u, '')
      const description = typeof parsed.data.description === 'string' ? parsed.data.description : ''
      if (description.length === 0) throw new Error(`agent ${agentType} has no description`)

      const mirror = SKILL_NAMES.find((skill) => {
        const candidate = join(paths.payloadRoot, skill, 'agents', spec.file)
        return existsSync(candidate) && readFileSync(candidate).equals(readFileSync(file))
      })
      if (mirror === undefined) throw new Error(`agent file ${spec.file} has no byte-identical skill mirror`)

      roles.push({
        kind: 'agent-role',
        name: spec.skill,
        skillName: spec.skill,
        agentType,
        mirror,
        file,
        directory: join(paths.payloadRoot, mirror),
        description,
        data: parsed.data,
        body: parsed.body,
        tools: typeof parsed.data.tools === 'string' ? parsed.data.tools : undefined,
      })
    } catch (error) {
      errors.push({ kind: 'agent-role', name: spec.skill, message: error instanceof Error ? error.message : String(error) })
      if (strict) throw error
      roles.push({
        kind: 'agent-role',
        name: spec.skill,
        skillName: spec.skill,
        agentType: spec.file.replace(/\.md$/u, ''),
        mirror: null,
        file,
        directory: paths.payloadRoot,
        description: '',
        data: {},
        body: '',
        tools: undefined,
        valid: false,
      })
    }
  }
  return roles
}

/**
 * Build one immutable view of the payload surfaces.
 *
 * @param {{paths: object, strict?: boolean}} options
 *   `strict` (default true) throws on the first malformed or missing document;
 *   a non-strict call returns the readable subset plus `errors`, which is what
 *   `ars_status` uses to degrade instead of crashing.
 */
export function createInventory({ paths, strict = true }) {
  const errors = []
  const skills = readSkills(paths, errors, strict)
  const commands = readCommands(paths, errors, strict)
  const agentRoles = readAgentRoles(paths, errors, strict)
  const skillByName = new Map(skills.map((entry) => [entry.name, entry]))
  const commandByName = new Map(commands.map((entry) => [entry.name, entry]))
  const roleByName = new Map(agentRoles.map((entry) => [entry.name, entry]))
  return {
    paths,
    skills,
    commands,
    agentRoles,
    errors,
    skillNames: skills.length > 0 ? skills.map((entry) => entry.name) : [...SKILL_NAMES],
    commandNames: commands.length > 0 ? commands.map((entry) => entry.name) : [...COMMAND_FALLBACK_NAMES],
    agentRoleNames: agentRoles.length > 0 ? agentRoles.map((entry) => entry.name) : AGENT_ROLE_SPECS.map((entry) => entry.skill),
    skill: (name) => skillByName.get(name),
    command: (name) => commandByName.get(name),
    agentRole: (name) => roleByName.get(name),
    agentRoleByType: (agentType) => agentRoles.find((entry) => entry.agentType === agentType),
  }
}

/** Resolve one skill directory without building the full inventory. */
export function skillDirectory(paths, skill) {
  return join(paths.payloadRoot, skill)
}
