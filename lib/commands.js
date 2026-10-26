import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInventory, readCommandEntry } from './inventory.js'
import { createIntake } from './intake.js'
import { createRegistrationReport, own } from './registration.js'

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
    .sort((left, right) => left.localeCompare(right))
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
  const registered = []

  const warn = (message) => {
    logger?.warn?.(message)
    if (Array.isArray(warnings)) warnings.push(message)
    report.warn(message)
  }

  for (const entry of inventory.commands) {
    try {
      const prepared = intake.command(entry)
      for (const finding of prepared.warnings) warn(`academic-research-skills: ${finding}`)
      const definition = {
        ...prepared.definition,
        handler: (invocation) => dispatchCommand({
          command: entry,
          prompt: prepared.prompt,
          invocation,
          logger,
        }),
      }
      own(ctx, () => ctx.commands.register(definition), `ars-command-${entry.name}`)
      registered.push(entry.name)
    } catch (error) {
      const message = report.fail(`command /${entry.name}`, error)
      logger?.warn?.(`academic-research-skills: ${message}`)
      if (Array.isArray(warnings)) warnings.push(`academic-research-skills: ${message}`)
    }
  }
  return { registered, report }
}

/**
 * Execute one command by submitting its adapted prompt.
 *
 * @param {{command: object, prompt?: (args: string) => string, adapter?: object, invocation: object, logger?: object}} args
 */
export async function dispatchCommand({ command, prompt, adapter, invocation, logger }) {
  try {
    const rawInput = typeof invocation.rawInput === 'string' ? invocation.rawInput : ''
    const text = typeof prompt === 'function'
      ? prompt(rawInput)
      : adapter.adaptCommandBody(command.body, {
        command: command.name,
        skill: command.skill,
        args: rawInput,
      })
    const findings = typeof adapter?.lint === 'function' ? adapter.lint(text) : []
    for (const finding of findings) {
      logger?.warn?.(`academic-research-skills: /${command.name} adapted with residual token: ${finding}`)
    }
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
