/**
 * Academic Research Skills for DeepSeek Harness.
 *
 * One Host row that registers:
 *   - the five ARS skills;
 *   - the four plugin-exposed agent roles as model-invocable agent-role skills;
 *   - the sixteen `/ars-*` user commands;
 *   - `ars_status`, `ars_script`, `ars_env_setup`;
 *   - the write-scope guard (infrastructure protection; the upstream phase fence
 *     has no Host role source and is reported honestly);
 *   - the short session announce section.
 *
 * Runtime model: DeepSeek Flash. No Claude model, CLI, or API is required.
 * Default source discovery: the DeepSeek native `web_search` tool.
 *
 * The plugin has no npm dependencies: it imports Node built-ins plus its own
 * local modules only.
 *
 * @module academic-research-skills-dsh
 */
import { createPaths } from './lib/paths.js'
import { normalizeConfig } from './lib/config.js'
import { createInventory } from './lib/inventory.js'
import { createReferencePolicy } from './lib/reference-policy.js'
import { createAdapter } from './lib/adapt.js'
import { createIntake } from './lib/intake.js'
import { createRegistrationReport, hostCapabilities } from './lib/registration.js'
import { registerSkills } from './lib/skills.js'
import { registerAgentSkills } from './lib/agents.js'
import { registerCommands } from './lib/commands.js'
import { createPythonEnv } from './lib/env.js'
import { registerTools } from './lib/tools.js'
import { registerGuard } from './lib/guard.js'
import { registerAnnounce } from './lib/announce.js'

/** Cordis plugin name (also the plugin row's `name` identity). */
export const name = 'academic-research-skills'

/** Services this plugin reads; a profile without them leaves the row inactive. */
export const inject = ['skills', 'commands', 'tools', 'systemPrompt']

/**
 * Mount the plugin.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} [rawConfig] row config from cordis.patch.yml
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const paths = createPaths()
  const inventory = createInventory({ paths })
  const policy = createReferencePolicy({ paths, inventory })
  const adapter = createAdapter({ paths, inventory, policy, webSearch: config.webSearch })
  const intake = createIntake({ paths, adapter, inventory })
  const env = createPythonEnv({ paths, config })
  const report = createRegistrationReport()
  const logger = ctx.logger

  // The contract with the session shell: a model-issued `bash bin/ars-python`
  // must see the same envDir as `ars_script`. The wrapper reads this file.
  if (typeof env.writeRuntimeState === 'function') {
    try {
      env.writeRuntimeState()
    } catch (error) {
      logger?.warn?.(`[ars] could not publish Python runtime state: ${error?.message || error}`)
    }
  }

  const host = hostCapabilities(ctx)
  if (config.guard) {
    if (host.tools) registerGuard(ctx, { paths, config, logger, policy })
    else report.fail('guard', 'ctx.tools.guard is unavailable')
  }
  if (config.announce) {
    if (host.systemPrompt) registerAnnounce(ctx, { paths, adapter, config, inventory, report, logger })
    else report.fail('announce', 'ctx.systemPrompt.section is unavailable')
  }

  if (host.skills) {
    registerSkills(ctx, { paths, adapter, inventory, intake, report, logger })
    registerAgentSkills(ctx, { paths, adapter, inventory, intake, report, logger })
  } else {
    report.fail('skills', 'ctx.skills.register is unavailable')
  }
  if (config.commands) {
    if (host.commands) registerCommands(ctx, { paths, adapter, inventory, intake, report, logger })
    else report.fail('commands', 'ctx.commands.register is unavailable')
  }
  if (config.tools) {
    if (!host.tools) report.fail('tools', 'ctx.tools.register/guard is unavailable')
    else registerTools(ctx, {
      paths,
      config,
      env,
      adapter,
      inventory,
      policy,
      report,
      logger,
    })
  }

  const snapshot = report.snapshot()
  logger?.info?.('academic-research-skills: ARS port loaded', {
    payloadRoot: paths.payloadRoot,
    modelProfile: config.modelProfile,
    webSearch: config.webSearch,
    announce: config.announce,
    commands: config.commands,
    tools: config.tools,
    guard: config.guard,
    registered: {
      skills: inventory.skills.length,
      agentRoles: inventory.agentRoles.length,
      commands: inventory.commands.length,
    },
    warnings: snapshot.warnings.length,
    failures: snapshot.failures.length,
  })
}
