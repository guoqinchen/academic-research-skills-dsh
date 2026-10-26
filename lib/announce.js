import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { COMMAND_FALLBACK_NAMES, createInventory } from './inventory.js'
import { own } from './registration.js'

export const ANNOUNCE_SECTION_NAME = 'academic-research-skills'
export const ANNOUNCE_ORDER = 40

/** Compatibility export: the fallback lives with the inventory owner. */
export const FALLBACK_COMMAND_NAMES = COMMAND_FALLBACK_NAMES

/**
 * List the payload command names through the inventory owner.
 *
 * @param {{payloadRoot?: string, commandsRoot?: string}} paths
 * @returns {string[]}
 */
export function listCommandNames(paths = {}) {
  const payloadRoot = typeof paths.payloadRoot === 'string'
    ? paths.payloadRoot
    : typeof paths.commandsRoot === 'string'
      ? join(paths.commandsRoot, '..')
      : null
  if (payloadRoot === null || !existsSync(payloadRoot)) return [...FALLBACK_COMMAND_NAMES]
  try {
    const inventory = createInventory({
      paths: {
        ...paths,
        payloadRoot,
        commandsRoot: typeof paths.commandsRoot === 'string' ? paths.commandsRoot : join(payloadRoot, 'commands'),
      },
      strict: false,
    })
    return inventory.commands.length > 0 ? inventory.commandNames : [...FALLBACK_COMMAND_NAMES]
  } catch {
    return [...FALLBACK_COMMAND_NAMES]
  }
}

/**
 * Register the availability prompt section.
 *
 * @param {object} ctx
 * @param {{paths: object, adapter: object, config?: object, inventory?: object,
 *   report?: object}} options
 * @returns {boolean} whether a section was registered
 */
export function registerAnnounce(ctx, options = {}) {
  const { paths, adapter, config } = options
  if (config?.announce === false) return false
  if (ctx === null || typeof ctx !== 'object') {
    throw new TypeError('registerAnnounce: ctx is required')
  }
  if (ctx.systemPrompt === null || typeof ctx.systemPrompt !== 'object') {
    throw new TypeError('registerAnnounce: ctx.systemPrompt is required')
  }
  if (typeof ctx.systemPrompt.section !== 'function') {
    throw new TypeError('registerAnnounce: ctx.systemPrompt.section must be a function')
  }
  if (adapter === null || typeof adapter !== 'object' || typeof adapter.announceText !== 'function') {
    throw new TypeError('registerAnnounce: adapter.announceText is required')
  }
  if (typeof ctx.effect !== 'function') {
    throw new TypeError('registerAnnounce: ctx.effect must be a function')
  }

  const inventory = options.inventory ?? createInventory({ paths })
  const text = adapter.announceText({
    commands: inventory.commandNames,
    agentSkills: inventory.agentRoleNames,
    skills: inventory.skillNames,
  })
  own(ctx, () => ctx.systemPrompt.section({
    name: ANNOUNCE_SECTION_NAME,
    order: ANNOUNCE_ORDER,
    text,
    interpolate: false,
  }), 'ars-announce')
  return true
}
