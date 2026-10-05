// Model suggestions from viStack's fork layer: a `tier-selection` decision through
// scripts/vistack-decision.py (deterministic policy, then the tiers the person opted into
// with /vistack:decisions-on, Jev first). The tier maps to the model the matching agent
// file pins, so the suggestion and viStack's own dispatch agree.
export type Tier = 'mechanical' | 'complex'

export type Decision = {
  tier: Tier
  confidence: number
  backend: string
  decisionId?: string
  rationale: string
}

export type Roster = Readonly<Record<Tier, string>>

export const DEFAULT_ROSTER: Roster = { complex: 'opus', mechanical: 'sonnet' }

export const BUILT_IN_TYPES: readonly string[] = ['general-purpose', 'Explore', 'Plan']

export const decisionContext = (request: string, source: string): string =>
  JSON.stringify({
    metadata: { source },
    task: { request: request.slice(0, 2400) },
  })

export const parseDecision = (stdout: string): Decision | null => {
  try {
    const value: unknown = JSON.parse(stdout)

    if (typeof value !== 'object' || value === null) {
      return null
    }

    const record = value as Record<string, unknown>
    const outputs = (typeof record.outputs === 'object' && record.outputs !== null ? record.outputs : {}) as Record<
      string,
      unknown
    >
    const action = typeof outputs.tier === 'string' ? outputs.tier : record.action

    if (action !== 'mechanical' && action !== 'complex') {
      return null
    }

    return {
      backend: typeof record.backend === 'string' ? record.backend : 'unknown',
      confidence: typeof record.confidence === 'number' ? record.confidence : 0,
      rationale: typeof record.rationale === 'string' ? record.rationale : '',
      tier: action,
      ...(typeof record.decision_id === 'string' ? { decisionId: record.decision_id } : {}),
    }
  } catch {
    return null
  }
}

// The `model:` line of an agent file's frontmatter.
export const frontmatterModel = (source: string): string | null => {
  const head = /^---\n([\s\S]*?)\n---/.exec(source)
  const line = head?.[1]?.split('\n').find(row => /^model:\s*/.test(row))

  return line === undefined ? null : line.replace(/^model:\s*/, '').replace(/["']/g, '').trim() || null
}

// Apply mode only touches built-in types that named no model of their own.
export const mayApply = (mode: string, subagentType: string, model: string | undefined): boolean =>
  mode === 'apply' && model === undefined && BUILT_IN_TYPES.includes(subagentType)
