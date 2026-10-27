import { AGENT_ROLE_SPECS, createInventory } from './inventory.js'
import { createIntake } from './intake.js'
import { createRegistrationReport, registerSurface } from './registration.js'

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

  return registerSurface({
    ctx,
    report,
    logger,
    warnings,
    entries: inventory.agentRoles,
    failLabel: (role) => `agent skill ${role.skillName}`,
    effectLabel: (role) => `ars-agent-skill-${role.skillName}`,
    prepare: (role) => {
      const prepared = intake.agentRole(role)
      return { name: role.skillName, definition: prepared.definition, warnings: prepared.warnings }
    },
    register: (definition) => ctx.skills.register(definition),
  })
}
