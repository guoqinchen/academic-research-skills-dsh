import { AGENT_ROLE_SPECS, createInventory } from './inventory.js'
import { createIntake } from './intake.js'
import { createRegistrationReport, own } from './registration.js'

/**
 * Upstream plugin-exposed agents. The mirror skill is derived by byte equality
 * in `inventory.js`; this compatibility list keeps the file/skill shape used by
 * tests and older callers.
 */
export const AGENT_SKILLS = Object.freeze(AGENT_ROLE_SPECS.map((entry) => ({ ...entry })))

/**
 * Read one top-level agent role as a DSH skill definition.
 *
 * @param {{paths: object, adapter: object, inventory?: object, intake?: object}} deps
 * @param {{file: string, skill: string} | string} entry agent spec or agent-role skill name
 */
export function readAgentSkill({ paths, adapter, inventory, intake }, entry) {
  const resolvedInventory = inventory ?? createInventory({ paths })
  const spec = typeof entry === 'string'
    ? AGENT_ROLE_SPECS.find((candidate) => candidate.skill === entry)
    : entry
  if (spec === undefined) throw new Error(`academic-research-skills: unknown agent role ${String(entry)}`)
  const role = resolvedInventory.agentRole(spec.skill)
  if (role === undefined) throw new Error(`academic-research-skills: missing agent file ${paths.agentsRoot}/${spec.file}`)
  const resolvedIntake = intake ?? createIntake({ paths, adapter, inventory: resolvedInventory })
  return resolvedIntake.agentRole(role).definition
}

/**
 * Register the four agent-role skills.
 *
 * @param {object} ctx Cordis context with `skills`
 * @param {{paths: object, adapter?: object, inventory?: object, intake?: object,
 *   logger?: object, report?: object, warnings?: string[]}} deps
 */
export function registerAgentSkills(ctx, options = {}) {
  const { paths, adapter, logger, warnings } = options
  const inventory = options.inventory ?? createInventory({ paths })
  const intake = options.intake ?? createIntake({ paths, adapter, inventory })
  const report = options.report ?? createRegistrationReport()
  const registered = []

  const warn = (message) => {
    logger?.warn?.(message)
    if (Array.isArray(warnings)) warnings.push(message)
    report.warn(message)
  }

  for (const role of inventory.agentRoles) {
    if (role.valid === false) {
      const message = report.fail(`agent skill ${role.skillName}`, new Error('invalid frontmatter; skipped'))
      logger?.warn?.(`academic-research-skills: ${message}`)
      if (Array.isArray(warnings)) warnings.push(`academic-research-skills: ${message}`)
      continue
    }
    try {
      const { definition, warnings: findings } = intake.agentRole(role)
      for (const finding of findings) warn(`academic-research-skills: ${finding}`)
      own(ctx, () => ctx.skills.register(definition), `ars-agent-skill-${role.skillName}`)
      registered.push(role.skillName)
    } catch (error) {
      const message = report.fail(`agent skill ${role.skillName}`, error)
      logger?.warn?.(`academic-research-skills: ${message}`)
      if (Array.isArray(warnings)) warnings.push(`academic-research-skills: ${message}`)
    }
  }
  return { registered, report }
}
