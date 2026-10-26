/**
 * One intake pipeline for every registered Markdown surface.
 *
 * Skills, agent roles, and commands share the same read → parse → validate →
 * adapt → lint path; the three surface adapters below are the only differences.
 * Registration code consumes the prepared definitions instead of re-implementing
 * validation, adaptation, and warning collection.
 *
 * @module intake
 */
import { join } from 'node:path'

/** DSH override for sr-screener's generated Claude-Code-format workflow scripts. */
export const SR_SCREENER_WORKFLOW_NOTE = [
  '> **DeepSeek Harness workflow compatibility note (sr-screener).**',
  '> `scripts/build_workflow.py` generates legacy workflow scripts that use an',
  '> `agentType` agent option and JSON-Schema `pattern` keywords; DSH\'s `workflow`',
  '> tool supports neither, so do **not** pass the generated script to `workflow`.',
  '> On DeepSeek Harness use the prompt-file path instead: run',
  '> `build_workflow.py ... --emit-prompts <dir>` through the managed interpreter,',
  '> dispatch one `subagent` call per emitted prompt file (Reviewer A/B,',
  '> adjudicator, QC reviewer), and merge the returned decisions with',
  '> `scripts/merge_decisions.py`; or use the single-session screening path',
  '> described in `references/orchestration.md`. Everything else in this skill',
  '> applies unchanged. Upstream model fields in screening_config.json are',
  '> quality tiers: override them with `deepseek-flash`; do not dispatch a legacy proprietary model.',
].join('\n')

/**
 * @param {{paths: object, adapter: object, inventory: object}} options
 */
export function createIntake({ paths, adapter, inventory }) {
  function lintWarnings(content, label) {
    return adapter.lint(content).map((finding) => `${label} adapted with residual token: ${finding}`)
  }

  function skill(entry) {
    const adapted = adapter.adaptSkillBody(entry.body, { skill: entry.name })
    const content = entry.name === 'sr-screener' ? `${SR_SCREENER_WORKFLOW_NOTE}\n\n${adapted}` : adapted
    return {
      definition: {
        name: entry.name,
        description: entry.description,
        content,
        source: 'bundled',
        path: entry.file,
        resourceBase: { kind: 'directory', path: entry.directory },
        invocation: { modelInvocable: true, userInvocable: true },
        ...entry.metadata !== undefined && typeof entry.metadata === 'object' && entry.metadata !== null
          ? { metadata: entry.metadata }
          : {},
      },
      warnings: lintWarnings(content, `skill ${entry.name}`),
    }
  }

  function agentRole(entry) {
    const description = `${entry.description.replace(/[.!?]$/u, '')}. Load this ARS agent-role skill when the workflow calls for ${entry.agentType}; pass its instructions to the subagent tool to run it as a separate agent.`
    const content = adapter.adaptAgentBody(entry.body, { agent: entry.agentType, skill: entry.mirror })
    return {
      definition: {
        name: entry.skillName,
        description,
        content,
        source: 'bundled',
        path: entry.file,
        resourceBase: { kind: 'directory', path: join(paths.payloadRoot, entry.mirror) },
        invocation: { modelInvocable: true, userInvocable: false },
        metadata: {
          arsAgentType: entry.agentType,
          arsUpstreamFile: `agents/${entry.file.split('/').pop()}`,
          arsMirrorSkill: entry.mirror,
          ...entry.tools === undefined ? {} : { arsTools: entry.tools },
        },
      },
      warnings: lintWarnings(content, `agent skill ${entry.skillName}`),
    }
  }

  function command(entry) {
    const prompt = (args) => adapter.adaptCommandBody(entry.body, {
      command: entry.name,
      skill: entry.skill,
      args,
    })
    // Registration-time lint uses an empty argument; command arguments are
    // user text and may legitimately contain legacy tokens.
    const warnings = lintWarnings(prompt(''), `command /${entry.name}`)
    return {
      definition: {
        name: entry.name,
        description: entry.description,
        input: { hint: entry.hint },
        handler: null, // filled by the registrar with the dispatch closure
      },
      prompt,
      warnings,
    }
  }

  return { skill, agentRole, command, inventory }
}
