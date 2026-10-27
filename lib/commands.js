import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInventory, compareNames, readCommandEntry } from './inventory.js'
import { createIntake } from './intake.js'
import { createRegistrationReport, registerSurface } from './registration.js'

/**
 * Build one model-visible user message with a fresh identity.
 *
 * DSH's own `createUserMessage` is not resolvable from a linked workspace
 * bundle, and its runtime shape is just this object plus an id.
 *
 * @param {string} text
 */
export function createUserMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/**
 * List the upstream command files in stable name order.
 * @param {{commandsRoot: string}} paths
 * @returns {string[]} absolute file paths
 */
export function listCommandFiles(paths) {
  return readdirSync(paths.commandsRoot)
    .filter((file) => file.endsWith('.md'))
    .sort(compareNames)
    .map((file) => join(paths.commandsRoot, file))
}

/**
 * Read one upstream command without registering it.
 *
 * @param {{paths: object, adapter?: object}} deps
 * @param {string} file absolute command file path
 */
export function readCommand({ paths }, file) {
  return readCommandEntry(paths, file)
}

/**
 * Register the 16 `/ars-*` commands.
 *
 * @param {object} ctx Cordis context with `commands`
 * @param {{paths: object, adapter?: object, inventory?: object, intake?: object,
 *   logger?: object, report?: object, warnings?: string[]}} deps
 * @returns {{registered: string[], report: object}}
 */
export function registerCommands(ctx, options = {}) {
  const { paths, adapter, logger, warnings } = options
  const inventory = options.inventory ?? createInventory({ paths })
  const intake = options.intake ?? createIntake({ paths, adapter, inventory })
  const report = options.report ?? createRegistrationReport()

  return registerSurface({
    ctx,
    report,
    logger,
    warnings,
    entries: inventory.commands,
    failLabel: (entry) => `command /${entry.name}`,
    effectLabel: (entry) => `ars-command-${entry.name}`,
    prepare: (entry) => {
      const prepared = intake.command(entry)
      return {
        name: entry.name,
        definition: {
          ...prepared.definition,
          handler: (invocation) => dispatchCommand({
            command: entry,
            prompt: prepared.prompt,
            invocation,
            logger,
          }),
        },
        warnings: prepared.warnings,
      }
    },
    register: (definition) => ctx.commands.register(definition),
  })
}

/**
 * Execute one command by submitting its adapted prompt.
 *
 * The prompt factory is built once at registration time (`intake.command`),
 * which is also where the adapted text is linted. Dispatch deliberately does
 * **not** lint again: the raw user input is part of the finished prompt, and a
 * user writing "Claude Code" must not produce a compatibility warning.
 *
 * @param {{command: object, prompt: (args: string) => string, invocation: object, logger?: object}} args
 */
export async function dispatchCommand({ command, prompt, invocation, logger }) {
  try {
    const rawInput = typeof invocation.rawInput === 'string' ? invocation.rawInput : ''
    if (typeof prompt !== 'function') {
      throw new TypeError('command was registered without a prompt factory')
    }
    const text = prompt(rawInput)
    invocation.agent.followup(createUserMessage(text))
    return {
      kind: 'success',
      text: `ARS /${command.name} dispatched — follow the injected instructions.`,
    }
  } catch (error) {
    return {
      kind: 'error',
      text: `ARS /${command.name} could not be dispatched: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
