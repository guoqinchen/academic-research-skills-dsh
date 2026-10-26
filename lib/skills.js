import { createInventory, SKILL_NAMES } from './inventory.js'
import { createIntake, SR_SCREENER_WORKFLOW_NOTE } from './intake.js'
import { createRegistrationReport, own } from './registration.js'

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
  const registered = []

  const warn = (message) => {
    logger?.warn?.(message)
    if (Array.isArray(warnings)) warnings.push(message)
    report.warn(message)
  }

  for (const entry of inventory.skills) {
    try {
      const { definition, warnings: findings } = intake.skill(entry)
      for (const finding of findings) warn(`academic-research-skills: ${finding}`)
      own(ctx, () => ctx.skills.register(definition), `ars-skill-${entry.name}`)
      registered.push(entry.name)
    } catch (error) {
      const message = report.fail(`skill ${entry.name}`, error)
      logger?.warn?.(`academic-research-skills: ${message}`)
      if (Array.isArray(warnings)) warnings.push(`academic-research-skills: ${message}`)
    }
  }
  return { registered, report }
}
