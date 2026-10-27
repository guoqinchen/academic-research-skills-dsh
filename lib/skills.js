import { createInventory, SKILL_NAMES } from './inventory.js'
import { createIntake, SR_SCREENER_WORKFLOW_NOTE } from './intake.js'
import { createRegistrationReport, registerSurface } from './registration.js'

export { SKILL_NAMES, SR_SCREENER_WORKFLOW_NOTE }

/**
 * Read one skill definition from the payload without registering it.
 *
 * @param {{paths: object, adapter: object, inventory?: object, intake?: object}} deps
 * @param {string} skill
 */
export function readSkill({ paths, adapter, inventory, intake }, skill) {
  const resolvedInventory = inventory ?? createInventory({ paths })
  const entry = resolvedInventory.skill(skill)
  if (entry === undefined) throw new Error(`academic-research-skills: missing skill file ${paths.payloadRoot}/${skill}/SKILL.md`)
  const resolvedIntake = intake ?? createIntake({ paths, adapter, inventory: resolvedInventory })
  return resolvedIntake.skill(entry).definition
}

/**
 * Register the five ARS skills into the calling context's skill layer.
 *
 * @param {object} ctx Cordis context with `skills`
 * @param {{paths: object, adapter?: object, inventory?: object, intake?: object,
 *   logger?: object, report?: object, warnings?: string[]}} deps
 */
export function registerSkills(ctx, options = {}) {
  const { paths, adapter, logger, warnings } = options
  const inventory = options.inventory ?? createInventory({ paths })
  const intake = options.intake ?? createIntake({ paths, adapter, inventory })
  const report = options.report ?? createRegistrationReport()

  return registerSurface({
    ctx,
    report,
    logger,
    warnings,
    entries: inventory.skills,
    failLabel: (entry) => `skill ${entry.name}`,
    effectLabel: (entry) => `ars-skill-${entry.name}`,
    prepare: (entry) => {
      const prepared = intake.skill(entry)
      return { name: entry.name, definition: prepared.definition, warnings: prepared.warnings }
    },
    register: (definition) => ctx.skills.register(definition),
  })
}
