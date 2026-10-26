/**
 * Registration ownership helpers.
 *
 * The composition root (`index.js`) owns the config flags and host-capability
 * negotiation. Registrars report outcomes to one collector instead of each
 * carrying its own warning array, double-gating on config, or re-deriving lint
 * warnings in `ars_status`.
 *
 * @module registration
 */

/** Create one mutable registration report. */
export function createRegistrationReport() {
  const warnings = []
  const failures = []
  return {
    warnings,
    failures,
    warn(message) {
      const text = String(message)
      warnings.push(text)
      return text
    },
    fail(surface, error) {
      const message = `${surface}: ${error instanceof Error ? error.message : String(error)}`
      failures.push({ surface, message })
      return message
    },
    snapshot() {
      return { warnings: [...warnings], failures: failures.map((entry) => ({ ...entry })) }
    },
  }
}

/** Run one registration factory under the calling context's effect scope. */
export function own(ctx, factory, label) {
  if (typeof ctx?.effect === 'function') return ctx.effect(factory, label)
  return factory()
}

/**
 * Report which host registries are usable. Index decides whether to skip or
 * fail; registrars can assume the capability they were called with.
 *
 * @param {object} ctx
 * @returns {{skills: boolean, commands: boolean, tools: boolean, systemPrompt: boolean, missing: string[]}}
 */
export function hostCapabilities(ctx) {
  const capabilities = {
    skills: typeof ctx?.skills?.register === 'function',
    commands: typeof ctx?.commands?.register === 'function',
    tools: typeof ctx?.tools?.register === 'function' && typeof ctx?.tools?.guard === 'function',
    systemPrompt: typeof ctx?.systemPrompt?.section === 'function',
  }
  capabilities.missing = Object.entries(capabilities)
    .filter(([, available]) => !available)
    .map(([name]) => name)
  return capabilities
}

/** Lint one adapted document and fold findings into the report. */
export function collectLint(adapter, report, text, label) {
  const findings = typeof adapter?.lint === 'function' ? adapter.lint(text) : []
  for (const finding of findings) report.warn(`${label} adapted with residual token: ${finding}`)
  return findings
}
