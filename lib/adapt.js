/**
 * Registration-time adapter from upstream Claude Code Markdown to DeepSeek
 * Harness text.
 *
 * The payload is an immutable snapshot of the upstream repository. Every
 * transformation in this module happens in memory when a skill, command, or
 * agent role is registered; no payload file is ever rewritten.
 *
 * Transformation order matters:
 *
 *  1. namespaced skill/agent references (`academic-research-skills:x` → `x`);
 *  2. the upstream command lead-in ("Skill tool" + `skill:` → `skill`/`name:`);
 *  3. Claude Code tool names in prose → DeepSeek Harness tool names;
 *  4. Python/shell invocations → the managed interpreter and absolute paths;
 *  5. `${CLAUDE_PLUGIN_ROOT}` → the absolute payload root;
 *  6. `Claude Code session` → `DeepSeek Harness session`;
 *  7. (commands only) `$ARGUMENTS` substitution and the raw user request.
 *
 * Paths that remain relative are resolvable because every adapted document
 * starts with a compatibility prelude that states which prefixes are
 * skill-relative and which are payload-root-relative.
 *
 * @module adapt
 */

import { join } from 'node:path'
import { SKILL_NAMES, AGENT_NAME_TO_SKILL, createInventory } from './inventory.js'
import { createReferencePolicy } from './reference-policy.js'
import { deepseekGuidance, deepseekAnnouncement } from './model-profile.js'

export { SKILL_NAMES, AGENT_NAME_TO_SKILL }

/** Tool-name mapping shown in the prelude and applied to prose. */
const TOOL_NAMES = Object.freeze([
  ['AskUserQuestion', '`ask_user_question`'],
  ['TodoWrite', '`todo_write`'],
  ['WebSearch', '`web_search`'],
  ['WebFetch', '`web_fetch`'],
  ['MultiEdit', '`edit` (one call per hunk)'],
  ['NotebookEdit', '`edit`'],
  ['BashOutput', '`job_output`'],
  ['KillShell', '`job_kill`'],
])

/**
 * Patterns that must never survive adaptation. A non-empty result is a
 * registration-time warning (logged and surfaced by `ars_status`), never a
 * crash.
 */
const RESIDUAL_TOKENS = Object.freeze([
  '${CLAUDE_PLUGIN_ROOT}',
  'academic-research-skills:',
  'Skill tool',
  'subagent_type',
  'python3 scripts/',
  'python scripts/',
  'Claude Code',
  'Claude-Code',
])

const SHELL_UNSAFE = /[\s"'\\$`;&|<>(){}[\]*?!#~]/u
const LEGACY_MODEL = /\b(?:sonnet|opus|haiku|Sonnet|Opus|Haiku)\b/gu
const CLAUDE_RUNTIME = /\bClaude\b/gu

/**
 * Product-name rewrites, longest first.
 *
 * A blanket `\bClaude\b` → "the session model" would corrupt prose that names
 * a person (Claude Shannon is common in research-methods text), so only the
 * actual Claude products are rewritten. Any other `Claude` occurrence is left
 * verbatim and reported by `lint` for a human to review.
 */
const CLAUDE_PRODUCT_REWRITES = Object.freeze([
  ['Claude Code session', 'DeepSeek Harness session'],
  ['Claude Code', 'DeepSeek Harness'],
  ['Claude Desktop', 'DeepSeek Harness Desktop'],
  ['Claude API', 'model API'],
  ['Claude CLI', 'DeepSeek Harness CLI'],
  ['Claude models', 'session models'],
  ['Claude model', 'session model'],
])

/**
 * Create the adapter for one payload layout.
 *
 * @param {{paths: {payloadRoot: string, binRoot?: string, pluginRoot?: string}}} deps
 * @returns {{
 *   payloadRoot: string,
 *   binRoot: string,
 *   pythonWrapper: string,
 *   prelude: (options?: {skill?: string | null}) => string,
 *   adaptSkillBody: (body: string, options?: {skill?: string | null}) => string,
 *   adaptCommandBody: (body: string, options?: {command?: string | null, skill?: string | null, args?: string}) => string,
 *   adaptAgentBody: (body: string, options?: {agent?: string | null, skill?: string | null}) => string,
 *   announceText: (options?: {commands?: Array<string | {name: string}>, agentSkills?: string[]}) => string,
 *   lint: (text: string) => string[],
 * }}
 */
export function createAdapter({ paths, inventory = null, policy = null, webSearch = true } = {}) {
  if (paths === null || typeof paths !== 'object') {
    throw new TypeError('createAdapter: { paths } is required')
  }
  if (typeof paths.payloadRoot !== 'string' || paths.payloadRoot.length === 0) {
    throw new TypeError('createAdapter: paths.payloadRoot must be a non-empty string')
  }

  const payloadRoot = stripTrailingSeparators(paths.payloadRoot)
  const binRoot = typeof paths.binRoot === 'string' && paths.binRoot.length > 0
    ? stripTrailingSeparators(paths.binRoot)
    : join(payloadRoot, 'bin')
  const pluginRoot = typeof paths.pluginRoot === 'string' && paths.pluginRoot.length > 0
    ? stripTrailingSeparators(paths.pluginRoot)
    : null
  const pythonWrapper = join(binRoot, 'ars-python')
  const resolvedInventory = inventory ?? createInventory({ paths })
  const resolvedPolicy = policy ?? createReferencePolicy({ paths, inventory: resolvedInventory })

  const context = {
    payloadRoot,
    binRoot,
    pluginRoot,
    pythonWrapper,
    inventory: resolvedInventory,
    policy: resolvedPolicy,
    webSearch,
    skillNames: resolvedInventory.skillNames,
  }

  return {
    payloadRoot,
    binRoot,
    pythonWrapper,
    inventory: resolvedInventory,
    policy: resolvedPolicy,

    /** Compatibility preamble for one skill (or a generic one). */
    prelude(options = {}) {
      const skill = optionalName(options.skill)
      return buildPrelude(context, { scope: skill === null ? 'command' : 'skill', skill })
    },

    /** Prelude plus the adapted skill body (frontmatter already stripped). */
    adaptSkillBody(body, options = {}) {
      const skill = optionalName(options.skill)
      const adapted = transformBody(context, requireText(body, 'adaptSkillBody'), { skill })
      return joinBlocks(buildPrelude(context, { scope: 'skill', skill }), adapted)
    },

    /** Prelude plus an adapted command prompt, with `$ARGUMENTS` substituted. */
    adaptCommandBody(body, options = {}) {
      const command = optionalName(options.command)
      const skill = optionalName(options.skill)
      const rawArgs = typeof options.args === 'string' ? options.args : options.args == null ? '' : String(options.args)
      const source = requireText(body, 'adaptCommandBody')
      const hadPlaceholder = source.includes('${ARGUMENTS}') || source.includes('$ARGUMENTS')
      let adapted = transformBody(context, source, { skill, kind: 'command', command })
      adapted = substituteArguments(adapted, rawArgs)
      const parts = [
        buildPrelude(context, { scope: 'command', skill, command }),
        adapted,
      ]
      if (!hadPlaceholder) parts.push(formatUserRequest(rawArgs))
      return joinBlocks(...parts)
    },

    /** Prelude plus an adapted agent-role body (frontmatter already stripped). */
    adaptAgentBody(body, options = {}) {
      const agent = optionalName(options.agent)
      const skill = optionalName(options.skill)
      const adapted = transformBody(context, requireText(body, 'adaptAgentBody'), {
        skill,
        kind: 'agent',
        agent,
      })
      return joinBlocks(buildPrelude(context, { scope: 'agent', skill, agent }), adapted)
    },

    /** Short availability block for the DeepSeek Harness system prompt. */
    announceText(options = {}) {
      return buildAnnounce(context, options)
    },

    /** Residual Claude-Code-only tokens found in adapted text. */
    lint(text) {
      return lintText(text)
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Prelude                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build the compatibility preamble for one adapted document.
 *
 * @param {{payloadRoot: string, pythonWrapper: string}} context
 * @param {{scope: 'skill' | 'command' | 'agent', skill?: string | null, command?: string | null, agent?: string | null}} options
 * @returns {string}
 */
function buildPrelude(context, { scope, skill = null, command = null, agent = null }) {
  const { payloadRoot, pythonWrapper } = context
  const lines = [
    '## DeepSeek Harness compatibility layer (Academic Research Skills)',
    '',
    'This Markdown is the upstream Academic Research Skills document adapted for DeepSeek Harness at registration time. Keep following the upstream instructions exactly; only paths, tool names, and invocation syntax follow the DeepSeek Harness conventions below.',
    '',
    `- Payload root (immutable upstream repository layout): \`${payloadRoot}\`.`,
  ]

  const directory = skill === null ? null : context.policy.skillDirectory(skill)
  if (directory !== null) {
    lines.push(`- Skill directory: \`${directory}\`.`)
  }
  if (scope === 'command' && command !== null) {
    lines.push(`- Upstream command: \`/${command}\`.`)
  }
  if (scope === 'agent' && agent !== null) {
    lines.push(`- Agent role: \`${agent}\`; a workflow dispatches it with the \`subagent\` tool, passing this document and the task as the child prompt.`)
  }

  if (scope === 'skill' || scope === 'command' || (scope === 'agent' && directory !== null)) {
    lines.push(...context.policy.conventionsText(skill))
    if (scope !== 'agent') {
      lines.push('- Invoke an ARS skill with the `skill` tool using its plain name, for example `{ name: "deep-research" }`. There is no plugin namespace and no arguments parameter: put the mode and the request in the message that follows the skill load.')
    }
  } else {
    lines.push('- Every relative reference resolves against the payload root: `shared/`, `scripts/`, `docs/`, `tools/`, `agents/`, `references/`, `MODE_REGISTRY.md`, and skill names such as `deep-research` or `academic-paper`.')
  }

  if (scope !== 'agent') {
    lines.push('- A separately dispatched agent role runs through the `subagent` tool with the role instructions as the child prompt; load the matching agent-role skill when the workflow names one.')
  }
  lines.push(
    '',
    deepseekGuidance({ webSearch: context.webSearch }),
  )
  lines.push(
    `- Run ARS Python scripts through the managed interpreter at \`${shellPath(pythonWrapper)}\`. It selects the managed ARS virtual environment and exports \`PYTHONPATH\` (\`${payloadRoot}\`) and \`ARS_PAYLOAD_ROOT\`; invoke it as \`<interpreter> <absolute script path> [args...]\`. Run shell scripts as \`bash <absolute script path>\`.`,
    '- Upstream tool names map to DeepSeek Harness tools: Read → `read`; Write → `write`; Edit → `edit`; Bash → `bash`; Grep → `grep`; Glob → `glob`; WebSearch → `web_search`; WebFetch → `web_fetch`; TodoWrite → `todo_write`; AskUserQuestion → `ask_user_question`; Task / Agent → `subagent`; MultiEdit → `edit` (one call per hunk); NotebookEdit → `edit`; BashOutput → `job_output`; KillShell → `job_kill`; Workflow → `workflow`.',
    '- The payload is read-only: never write into it; adapt in memory only.',
  )
  return lines.join('\n')
}

/* -------------------------------------------------------------------------- */
/* Body transformation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Apply every in-body transformation.
 *
 * @param {{payloadRoot: string, pythonWrapper: string}} context
 * @param {string} body
 * @param {{skill?: string | null, kind?: 'skill' | 'command' | 'agent', command?: string | null, agent?: string | null}} options
 * @returns {string}
 */
function transformBody(context, body, options = {}) {
  const skill = optionalName(options.skill)
  let text = body

  text = replaceNamespace(text)
  text = adaptCommandLeadIn(text)
  text = adaptToolNames(text)
  text = rewriteScriptInvocations(context, text, skill)
  text = text.replaceAll('${CLAUDE_PLUGIN_ROOT}', context.payloadRoot)
  text = rewriteAbsoluteScriptInvocations(context, text)
  text = replaceLegacyRuntimeReferences(text)
  return text
}

/**
 * Remove the remaining Claude-specific runtime vocabulary from adapted prose.
 * Upstream model labels become DeepSeek Flash; Claude-only filesystem references
 * become the plugin's own layout; no adapted document requires a Claude model.
 *
 * @param {string} text
 * @returns {string}
 */
function replaceLegacyRuntimeReferences(text) {
  let adapted = text
  adapted = adapted.replaceAll('.claude/CLAUDE.md', 'shared/references/routing_core.md')
  adapted = adapted.replaceAll('~/.claude/agents/', 'the plugin\'s agent-role skills')
  adapted = adapted.replaceAll('.claude/agents/', 'the plugin\'s agent-role skills')
  adapted = adapted.replaceAll('Claude-Code-format', 'legacy workflow-script format')
  for (const [from, to] of CLAUDE_PRODUCT_REWRITES) adapted = adapted.replaceAll(from, to)
  adapted = adapted.replace(/\bOpus-class\b/gu, 'high-reasoning tier')
  adapted = adapted.replace(LEGACY_MODEL, 'deepseek-flash')
  return adapted
}

/**
 * `academic-research-skills:deep-research` → `deep-research`.
 * Agent names are mapped to their DeepSeek Harness agent-role skill names.
 *
 * @param {string} text
 * @returns {string}
 */
function replaceNamespace(text) {
  return text.replace(/academic-research-skills:([A-Za-z0-9_-]+)/gu, (match, name) => {
    if (SKILL_NAMES.includes(name)) return name
    if (Object.hasOwn(AGENT_NAME_TO_SKILL, name)) return AGENT_NAME_TO_SKILL[name]
    return name
  })
}

/**
 * Convert the upstream command lead-in:
 *
 *   First invoke the Skill tool with `skill: "academic-research-skills:x"`.
 *   Pass the mode and the user's request described below as its arguments.
 *
 * to DeepSeek Harness invocation semantics (the `skill` tool takes `name` and
 * has no arguments parameter).
 *
 * @param {string} text
 * @returns {string}
 */
function adaptCommandLeadIn(text) {
  return text
    .replace(
      /First invoke the Skill tool with `skill: "([A-Za-z0-9_-]+)"`/gu,
      'First invoke the `skill` tool with `name: "$1"`',
    )
    .replace(
      'Pass the mode and the user\'s request described below as its arguments.',
      'After the skill loads, execute the mode and the user\'s request described below.',
    )
    .replace(/\bSkill tool\b/gu, '`skill` tool')
}

/**
 * Map Claude Code tool names in prose to DeepSeek Harness tool names.
 *
 * @param {string} text
 * @returns {string}
 */
function adaptToolNames(text) {
  let adapted = text
  for (const [upstream, harness] of TOOL_NAMES) {
    adapted = adapted.replace(wordPattern(upstream), harness)
  }

  adapted = adapted
    .replace(/Workflow\(\{scriptPath: "<printed path>"\}\)/gu, 'run the printed script with the `workflow` tool')
    .replace(/\bWorkflow tool\b/gu, '`workflow` tool')
    .replace(/-> Workflow\b/gu, '-> `workflow` tool')
    .replace(/\bWorkflow \/ Agent\b/gu, '`workflow` tool / `subagent` tool')
    .replace(/\bTask tool\b/gu, '`subagent` tool')
    .replace(/\bAgent tool\b/gu, '`subagent` tool')
    .replace(/\bAgent call\b/gu, '`subagent` call')
    .replace(/\bsubagent_type\s*:\s*["']?([A-Za-z0-9_:-]+(?:\.[A-Za-z0-9_:-]+)*)["']?/gu, (match, role) => {
      const mapped = Object.hasOwn(AGENT_NAME_TO_SKILL, role) ? AGENT_NAME_TO_SKILL[role] : role
      return `the ARS agent-role skill for \`${mapped}\``
    })

  // "Read and Grep tools" / "(Read and Grep only": tool lists written with the
  // upstream capitalized tool names. Ordinary prose "Read scope", "Write a
  // paper", "Bash deny" is deliberately left untouched.
  adapted = adapted.replace(
    /\b(Read|Write|Edit|Bash|Grep|Glob)(?:\s+and\s+(Read|Write|Edit|Bash|Grep|Glob))?\s+tools?\b/gu,
    (match, ...names) => names
      .filter((name) => typeof name === 'string' && /^(?:Read|Write|Edit|Bash|Grep|Glob)$/u.test(name))
      .map((name) => `\`${name.toLowerCase()}\``)
      .join(' and ')
      + ' tools',
  )
  adapted = adapted.replace(/\bRead and Grep\b/gu, '`read` and `grep`')
  return adapted
}

/**
 * Rewrite Python and shell script invocations to the managed interpreter and
 * absolute script paths.
 *
 * Handles the upstream shapes:
 *   - `python3 scripts/x.py` and `python scripts/x.py` (payload root scripts);
 *   - `python $S/x.py` after `S=<this skill's folder>/scripts` (sr-screener);
 *   - `PYTHONPATH=. python3 -m unittest scripts.test_*` (module invocation);
 *   - `bash scripts/x.sh`.
 *
 * @param {{payloadRoot: string, pythonWrapper: string}} context
 * @param {string} text
 * @param {string | null} skill
 * @returns {string}
 */
function rewriteScriptInvocations(context, text, skill) {
  let adapted = text

  // sr-screener declares `S=<this skill's folder>/scripts` before its commands.
  adapted = adapted.replace(
    /S=<this skill's folder>\/scripts/gu,
    () => 'S=' + shellPath(context.policy.scriptDirectory(skill === null ? 'deep-research' : skill)),
  )
  adapted = adapted.replace(
    /\bpython3?\s+\$S\/([A-Za-z0-9_./-]+\.py)\b/gu,
    (match, script) => `${shellPath(context.pythonWrapper)} "$S/${script}"`,
  )

  // Relative script paths. For every skill except sr-screener these resolve
  // against the payload root, matching the upstream repository layout.
  adapted = adapted.replace(
    /\bpython3?\s+((?:\.\/)?(?:sr-screener\/)?scripts\/[A-Za-z0-9_./-]+\.py)\b/gu,
    (match, script) => {
      const absolute = context.policy.resolveScriptPath(script, { skill })
      return `${shellPath(context.pythonWrapper)} ${shellPath(absolute)}`
    },
  )

  // `PYTHONPATH=. python3 -m unittest scripts.test_x` — the wrapper already
  // sets PYTHONPATH to the payload root, so the explicit prefix is redundant.
  adapted = adapted.replace(
    /\bPYTHONPATH=\.\s+python3?\s+-m\s+unittest\s+scripts\.([A-Za-z0-9_.]+)/gu,
    (match, module) => `${shellPath(context.pythonWrapper)} -m unittest scripts.${module}`,
  )

  // Any remaining `python3 -m module` invocation. The lookbehind keeps the
  // already-rewritten `.../ars-python -m ...` form from being matched again.
  adapted = adapted.replace(
    /(?<![\w-])python3?\s+-m\s+/gu,
    () => `${shellPath(context.pythonWrapper)} -m `,
  )

  // Shell scripts invoked with bash.
  adapted = adapted.replace(
    /\bbash\s+((?:\.\/)?(?:sr-screener\/)?scripts\/[A-Za-z0-9_./-]+\.sh)\b/gu,
    (match, script) => `bash ${shellPath(context.policy.resolveScriptPath(script, { skill }))}`,
  )
  return adapted
}

/**
 * Second pass for Python/shell invocations that became absolute only after the
 * `${CLAUDE_PLUGIN_ROOT}` substitution.
 *
 * @param {{payloadRoot: string, pythonWrapper: string}} context
 * @param {string} text
 * @returns {string}
 */
function rewriteAbsoluteScriptInvocations(context, text) {
  const prefix = escapeRegExp(context.payloadRoot)
  const python = new RegExp(`\\bpython3?[ \\t]+(${prefix}/[A-Za-z0-9_./-]+\\.py)`, 'gu')
  const bash = new RegExp(`\\bbash[ \\t]+(${prefix}/[A-Za-z0-9_./-]+\\.sh)`, 'gu')
  return text
    .replace(python, (match, script) => `${shellPath(context.pythonWrapper)} ${shellPath(script)}`)
    .replace(bash, (match, script) => `bash ${shellPath(script)}`)
}

/**
 * Replace `$ARGUMENTS` / `${ARGUMENTS}` with the raw user input, verbatim.
 *
 * @param {string} text
 * @param {string} args
 * @returns {string}
 */
function substituteArguments(text, args) {
  return text.split('${ARGUMENTS}').join(args).split('$ARGUMENTS').join(args)
}

/**
 * The command fallback when upstream has no `$ARGUMENTS` placeholder: append
 * the raw user input so the request is never dropped.
 *
 * @param {string} rawArgs
 * @returns {string}
 */
function formatUserRequest(rawArgs) {
  const request = rawArgs.length === 0 ? '_No additional input was provided._' : rawArgs
  return `## User request (raw input)\n\n${request}`
}

/* -------------------------------------------------------------------------- */
/* Announce                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Build the short system-prompt availability block.
 *
 * @param {{payloadRoot: string}} context
 * @param {{commands?: Array<string | {name: string}>, agentSkills?: string[]}} options
 * @returns {string}
 */
function buildAnnounce(context, options = {}) {
  const commands = normalizeNames(options.commands).map((name) => `/${name}`)
  const agentSkills = normalizeNames(options.agentSkills)
  const skills = normalizeNames(options.skills ?? context.skillNames)

  const lines = [
    '## Academic Research Skills (ARS) — DeepSeek Harness port',
    '',
    `Bundled ARS payload root: \`${context.payloadRoot}\`.`,
    '',
    `- Research skills (load with the \`skill\` tool by plain name): ${skills.map((name) => `\`${name}\``).join(', ')}.`,
  ]
  if (agentSkills.length > 0) {
    lines.push(`- Agent-role skills (dispatch with the \`subagent\` tool): ${agentSkills.map((name) => `\`${name}\``).join(', ')}.`)
  }
  if (commands.length > 0) {
    lines.push(`- Commands (${commands.length}): ${commands.join(', ')}.`)
  }
  lines.push(
    '',
    deepseekAnnouncement({ webSearch: context.webSearch }),
    '',
    'Use these skills only for academic research requests: research design, literature review, paper drafting, planning and revision, peer review, citation checks, disclosure, and systematic-review screening. Route unrelated coding, office, or general requests outside ARS.',
  )
  return lines.join('\n')
}

/* -------------------------------------------------------------------------- */
/* Lint                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Report residual Claude-Code-only tokens in adapted text.
 *
 * @param {string} text
 * @returns {string[]} one summary entry per residual token
 */
function lintText(text) {
  if (typeof text !== 'string') {
    throw new TypeError('lint: text must be a string')
  }
  const lines = text.split(/\r?\n/u)
  const findings = []
  const legacyModels = text.match(LEGACY_MODEL) ?? []
  if (legacyModels.length > 0) findings.push(`legacy model label (sonnet/opus/haiku) × ${legacyModels.length}`)
  const claude = text.match(CLAUDE_RUNTIME) ?? []
  if (claude.length > 0) findings.push(`Claude runtime reference × ${claude.length}`)
  for (const token of RESIDUAL_TOKENS) {
    let count = 0
    let firstLine = 0
    for (let index = 0; index < lines.length; index += 1) {
      const occurrences = lines[index].split(token).length - 1
      if (occurrences > 0) {
        if (count === 0) firstLine = index + 1
        count += occurrences
      }
    }
    if (count > 0) findings.push(`${token} × ${count} (first at line ${firstLine})`)
  }
  return findings
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} text
 * @param {string} operation
 * @returns {string}
 */
function requireText(text, operation) {
  if (typeof text !== 'string') {
    throw new TypeError(`${operation}: body must be a string`)
  }
  return text
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalName(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * @param {string} path
 * @returns {string}
 */
function stripTrailingSeparators(path) {
  return path.replace(/[\\/]+$/u, '') || path
}

/**
 * Quote an absolute path only when it contains shell-special characters. The
 * dev workspace lives under a directory with a space, so unquoted absolute
 * paths would break copy-pasted commands.
 *
 * @param {string} path
 * @returns {string}
 */
function shellPath(path) {
  const value = String(path)
  if (!SHELL_UNSAFE.test(value)) return value
  // Double quotes with escaped dollar, backtick, backslash, and quote characters.
  return '"' + value.replace(/(["\\$`])/gu, '\\$1') + '"'
}

/**
 * @param {string} value
 * @returns {RegExp}
 */
function wordPattern(value) {
  return new RegExp(`\\b${escapeRegExp(value)}\\b`, 'gu')
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Normalize a list of command/agent names: strings or `{name}` objects,
 * optional leading slash, unique, preserving caller order.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeNames(value) {
  if (!Array.isArray(value)) return []
  const names = []
  for (const entry of value) {
    const raw = typeof entry === 'string'
      ? entry
      : entry !== null && typeof entry === 'object' && typeof entry.name === 'string'
        ? entry.name
        : null
    if (raw === null) continue
    const name = raw.trim().replace(/^\/+/u, '')
    if (name.length > 0 && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Join non-empty blocks with one blank line between them.
 *
 * @param {...(string | null | undefined)} blocks
 * @returns {string}
 */
function joinBlocks(...blocks) {
  return blocks
    .filter((block) => typeof block === 'string' && block.trim().length > 0)
    .map((block) => block.trim())
    .join('\n\n')
}
