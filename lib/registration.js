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
 * `tools` (the registry) and `toolGuard` (the write-scope hook) are separate
 * capabilities: a host that can register tools but exposes no guard should
 * still get the tools, with the guard reported as failed.
 *
 * @param {object} ctx
 * @returns {{skills: boolean, commands: boolean, tools: boolean, toolGuard: boolean,
 *   systemPrompt: boolean, missing: string[]}}
 */
export function hostCapabilities(ctx) {
  const capabilities = {
    skills: typeof ctx?.skills?.register === 'function',
    commands: typeof ctx?.commands?.register === 'function',
    tools: typeof ctx?.tools?.register === 'function',
    toolGuard: typeof ctx?.tools?.guard === 'function',
    systemPrompt: typeof ctx?.systemPrompt?.section === 'function',
  }
  capabilities.missing = Object.entries(capabilities)
    .filter(([, available]) => !available)
    .map(([name]) => name)
  return capabilities
}

/** Create the warn/fail pair every registrar shares. */
function createSurfaceLogger({ report, logger, warnings }, prefix = 'academic-research-skills') {
  const emit = (message) => {
    const text = `${prefix}: ${message}`
    logger?.warn?.(text)
    if (Array.isArray(warnings)) warnings.push(text)
    report.warn(message)
    return text
  }
  return {
    warn: emit,
    fail(label, error) {
      return emit(report.fail(label, error))
    },
  }
}

/**
 * Register one document surface (skills, agent roles, or commands).
 *
 * The three registrars differed only in their labels, effect names, and the
 * definition handed to the host; this is that shared loop. Keeping it in one
 * place is why the warning and failure rules cannot drift between surfaces.
 *
 * @param {object} options
 * @param {object} options.ctx
 * @param {object} options.report
 * @param {object} [options.logger]
 * @param {string[]} [options.warnings]
 * @param {Array<object>} options.entries
 * @param {(entry: object) => string} options.failLabel
 * @param {(entry: object) => string} options.effectLabel
 * @param {(entry: object) => {name: string, definition: object, warnings?: string[]}} options.prepare
 * @param {(definition: object, entry: object) => unknown} options.register
 * @returns {{registered: string[], report: object}}
 */
export function registerSurface({
  ctx,
  report,
  logger,
  warnings,
  entries,
  failLabel,
  effectLabel,
  prepare,
  register,
}) {
  const surface = createSurfaceLogger({ report, logger, warnings })
  const registered = []
  for (const entry of entries) {
    if (entry.valid === false) {
      surface.fail(failLabel(entry), new Error('invalid frontmatter; skipped'))
      continue
    }
    try {
      const prepared = prepare(entry)
      for (const finding of prepared.warnings ?? []) surface.warn(finding)
      own(ctx, () => register(prepared.definition, entry), effectLabel(entry))
      registered.push(prepared.name)
    } catch (error) {
      surface.fail(failLabel(entry), error)
    }
  }
  return { registered, report }
}
