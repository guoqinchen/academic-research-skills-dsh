/**
 * Runtime model profile for the ARS port.
 *
 * The plugin targets DeepSeek Flash through DeepSeek Harness. It does not
 * require a Claude model, Claude CLI, or Claude API; upstream `sonnet`/`opus`
 * labels are treated as quality tiers and mapped to the session model.
 *
 * The guidance is included once in every adapted skill/command/agent prelude
 * and in the short system-prompt announcement. It is intentionally explicit:
 * Flash's large context, image input, native tool calling, and DeepSeek search
 * change how the upstream agent team should be driven.
 *
 * @module model-profile
 */

/** DeepSeek Flash facts used by the prompt guidance. */
export const DEEPSEEK_FLASH = Object.freeze({
  id: 'deepseek-flash',
  contextTokens: 1048576,
  maxOutputTokens: 256000,
  inputs: Object.freeze(['text', 'image']),
  reasoningEfforts: Object.freeze(['off', 'low', 'high', 'max']),
  searchTool: 'web_search',
  searchProvider: 'deepseek-official',
  maxQueriesPerSearch: 4,
})

/** Short label used by status and the announce section. */
export const MODEL_PROFILE_LABEL = `DeepSeek Flash (${DEEPSEEK_FLASH.id}; ${DEEPSEEK_FLASH.contextTokens.toLocaleString('en-US')}-token context; text + image input)`

/**
 * Markdown guidance appended to every adapted skill/command/agent prelude.
 *
 * @param {{webSearch?: boolean}} [options]
 * @returns {string}
 */
export function deepseekGuidance({ webSearch = true } = {}) {
  const lines = [
    '**DeepSeek Flash runtime (DeepSeek Harness).**',
    '',
    '- Run on DeepSeek Flash. No external proprietary-model CLI or API is required; upstream model-tier labels are quality tiers, not model requirements. Treat model names inside upstream reference files the same way: use DeepSeek Flash, and express a stronger tier through reasoning effort or a separate subagent.',
    `- Flash has a ${DEEPSEEK_FLASH.contextTokens.toLocaleString('en-US')}-token context and accepts text plus images. Load complete reference files in one pass; keep one evidence ledger instead of repeatedly re-reading the same sources.`,
    '- Use native tool calls precisely: `read`, `write`, `edit`, `bash`, `grep`, `glob`, `todo_write`, `ask_user_question`, `subagent`, `workflow`, and the ARS tools. Prefer `ars_script` for deterministic gates instead of asking the model to adjudicate what a script can decide.',
    '- Flash is fast; parallelize independent literature, verification, and review work with `subagent` or `workflow`. Do not serialize steps that have no dependency.',
    '- The session configures the reasoning effort (typically `max`). Spend reasoning on contradictions, gates, and evidence conflicts; keep routine steps direct and verifiable.',
    '- When dispatching `subagent` or `workflow`, let DSH use DeepSeek Flash; do not pass an upstream model alias as a model override.',
    '- Image input is real: use `read_image` for figures, tables, scans, and rendered pages when a visual check is needed.',
  ]
  if (webSearch) {
    lines.push(`- Web search defaults to the DeepSeek native \`${DEEPSEEK_FLASH.searchTool}\` service (provider \`${DEEPSEEK_FLASH.searchProvider}\`). Batch 1–${DEEPSEEK_FLASH.maxQueriesPerSearch} queries per call, then use \`web_fetch\` for known URLs; a search is a full model turn, so avoid one-query-at-a-time loops.`)
  }
  return lines.join('\n')
}

/** One-line statement for the system-prompt announcement. */
export function deepseekAnnouncement({ webSearch = true } = {}) {
  const search = webSearch
    ? `Default web search: DeepSeek native \`${DEEPSEEK_FLASH.searchTool}\` (\`${DEEPSEEK_FLASH.searchProvider}\`), batched 1–${DEEPSEEK_FLASH.maxQueriesPerSearch} queries; \`web_fetch\` for known URLs.`
    : ''
  return `Runtime model: ${MODEL_PROFILE_LABEL}. No external proprietary-model CLI or API is required; upstream model-tier labels are quality tiers only. ${search}`.trim()
}
