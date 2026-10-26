/**
 * One fake DSH host adapter for every suite.
 *
 * The plugin only needs a small Host contract: a logger, effect ownership, and
 * the skills/commands/tools/systemPrompt registries. Six suites used to
 * re-implement that contract with drifting semantics; this module implements it
 * once. Payload fixtures stay per-suite because synthetic and real payloads
 * encode different claims.
 *
 * @module test/support/host
 */
import assert from 'node:assert/strict'

/**
 * @param {{skills?: string[], commands?: string[]}} [options]
 *   Optional pre-existing skill/command names for read-only status lookups.
 */
export function createHost({ skills = [], commands = [] } = {}) {
  const availableSkills = new Set(skills)
  const availableCommands = new Set(commands)
  const state = {
    skills: new Map(),
    commands: new Map(),
    tools: new Map(),
    registeredTools: [],
    guards: [],
    sections: [],
    effects: [],
    disposers: [],
    warnings: [],
    infos: [],
    skillGets: [],
    commandFinds: [],
    unregisterCalls: { count: 0 },
  }

  const ctx = {
    logger: {
      info(...args) {
        state.infos.push(args)
      },
      warn(message) {
        state.warnings.push(String(message))
      },
      debug() {},
      error() {},
    },
    effect(factory) {
      const disposer = factory()
      state.effects.push(disposer)
      if (typeof disposer === 'function') state.disposers.push(disposer)
      return disposer
    },
    skills: {
      register(definition) {
        assert.ok(!state.skills.has(definition.name), `duplicate skill ${definition.name}`)
        state.skills.set(definition.name, definition)
        return () => state.skills.delete(definition.name)
      },
      async get(name) {
        state.skillGets.push(name)
        return state.skills.get(name) ?? (availableSkills.has(name) ? { name, content: '' } : undefined)
      },
    },
    commands: {
      register(definition) {
        assert.ok(!state.commands.has(definition.name), `duplicate command ${definition.name}`)
        state.commands.set(definition.name, definition)
        return () => {
          state.commands.delete(definition.name)
          state.unregisterCalls.count += 1
        }
      },
      find(_agent, name) {
        state.commandFinds.push({ agent: _agent, name })
        return state.commands.get(name) ?? (availableCommands.has(name) ? { name } : undefined)
      },
    },
    tools: {
      register(definition) {
        assert.ok(!state.tools.has(definition.name), `duplicate tool ${definition.name}`)
        state.tools.set(definition.name, definition)
        state.registeredTools.push(definition)
        return () => {
          state.tools.delete(definition.name)
          state.unregisterCalls.count += 1
        }
      },
      guard(fn) {
        state.guards.push(fn)
        return () => {
          const index = state.guards.indexOf(fn)
          if (index >= 0) state.guards.splice(index, 1)
        }
      },
    },
    systemPrompt: {
      section(section) {
        assert.ok(
          !state.sections.some((existing) => existing.name === section.name),
          `duplicate prompt section ${section.name}`,
        )
        state.sections.push(section)
        return () => {
          const index = state.sections.findIndex((existing) => existing.name === section.name)
          if (index >= 0) state.sections.splice(index, 1)
        }
      },
    },
  }

  return {
    ctx,
    state,
    get registeredTools() {
      return state.registeredTools
    },
    /** Run every recorded effect-owned disposer (registrations unregister). */
    disposeAll() {
      for (const disposer of [...state.disposers].reverse()) disposer()
    },
  }
}


/**
 * Mount a plugin's `apply(ctx, config)` once on a fresh fake host.
 *
 * @param {(ctx: object, config?: object) => void} applyFn
 * @param {object} [rawConfig]
 */
export function mountHost(applyFn, rawConfig) {
  const host = createHost()
  applyFn(host.ctx, rawConfig)
  return host
}
