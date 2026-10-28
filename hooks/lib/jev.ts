// Model suggestions from viStack's fork layer: a `tier-selection` decision through
// scripts/vistack-decision.py (deterministic policy, then the tiers the person opted into
// with /vistack:decisions-on, Jev first). The tier maps to the model the matching agent
// file pins, so the suggestion and viStack's own dispatch agree.
import { fit } from './format'

import type { DeckForkLayer, DeckLadderStep, DeckPick, DeckPickStatus } from '../../types'

export type Tier = 'mechanical' | 'complex'

export type Decision = {
  tier: Tier
  confidence: number
  backend: string
  decisionId?: string
  rationale: string
  fork?: 'sharp' | 'split'
  fallbackUsed?: boolean
  fallbackReason?: string
  probabilities?: Record<string, number>
  role?: string
  signals: NonNullable<DeckPick['signals']>
  contractChange?: number
  alternatives: { action: string; reason: string }[]
  requiredEvidence: string[]
  risks: string[]
}

// `error` is set exactly when `decision` is null.
export type Asked = { decision: Decision | null; ms: number; error?: string }

// A process's result, or the text of the error that kept it from running.
export type Ran = { exitCode: number; stdout: string; stderr: string } | string

export type ForkStatus = Omit<DeckForkLayer, 'readAt' | 'mode' | 'script'>

export type ForkTally = {
  asked: number
  sharp: number
  split: number
  failed: number
  deciding: number
  byBackend: [string, number][]
}

export type Roster = Readonly<Record<Tier, string>>

export const DEFAULT_ROSTER: Roster = { complex: 'opus', mechanical: 'sonnet' }

export const BUILT_IN_TYPES: readonly string[] = ['general-purpose', 'Explore', 'Plan']

// What `decisions status` reports with every tier opted in.
export const DEFAULT_LADDER: readonly string[] = ['deterministic', 'jev', 'cloudflare:clef-flash', 'ollama:clef-flash']

const NOTE_CAP = 60

const REJECTION = /gate|below|malformed|invalid|rejected|not available in the context|missing typed/i

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

const parseObject = (stdout: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(stdout)

    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const decisionContext = (request: string, source: string): string =>
  JSON.stringify({
    metadata: { source },
    task: { request: request.slice(0, 2400) },
  })

export const decisionArgs = (script: string, flags: readonly string[]): string[] => [
  'python3',
  script,
  'decision',
  'tier-selection',
  '--backend',
  'auto',
  ...flags,
]

export const statusArgs = (script: string, configPath?: string): string[] => [
  'python3',
  script,
  'decisions',
  'status',
  ...(configPath === undefined ? [] : ['--config', configPath]),
]

export const historyOf = (flags: readonly string[]): string => {
  const at = flags.indexOf('--history')

  return at === -1 ? 'off' : (flags[at + 1] ?? 'off')
}

export const failureOf = (exitCode: number, stderr: string): string => {
  const line = stderr
    .split('\n')
    .map(one => one.trim())
    .find(one => one !== '')

  return line === undefined ? `exit ${exitCode}` : `exit ${exitCode}: ${line}`
}

export const forkCallOf = (script: string | null, flags: readonly string[]): { argv: string[] | null; shown: Pick<DeckPick, 'command' | 'history'> } => {
  if (script === null) {
    return { argv: null, shown: {} }
  }

  const argv = decisionArgs(script, flags)

  return { argv, shown: { command: argv.join(' '), history: historyOf(flags) } }
}

export const isForkSwitch = (command: string): boolean => /vistack-decision\.py["']?\s+(?:decisions|laya)\s+(?:on|off)\b/.test(command)

export const parseDecision = (stdout: string): Decision | null => {
  const root = parseObject(stdout)

  if (root === null) {
    return null
  }

  const outputs = record(root.outputs)
  const action = typeof outputs.tier === 'string' ? outputs.tier : root.action

  if (action !== 'mechanical' && action !== 'complex') {
    return null
  }

  const probabilities = Object.entries(record(root.probabilities)).filter((entry): entry is [string, number] => number(entry[1]) !== undefined)
  const fork = root.fork === 'sharp' || root.fork === 'split' ? root.fork : undefined
  const decisionId = text(root.decision_id)
  const fallbackReason = text(root.fallback_reason)
  const role = text(outputs.role)
  const contractChange = number(record(outputs.model_contract_change).noul)

  return {
    alternatives: (Array.isArray(root.alternatives) ? root.alternatives : [])
      .map(record)
      .filter(item => typeof item.action === 'string')
      .map(item => ({ action: String(item.action), reason: typeof item.reason === 'string' ? item.reason : '' })),
    backend: text(root.backend) ?? 'unknown',
    confidence: number(root.confidence) ?? 0,
    rationale: typeof root.rationale === 'string' ? root.rationale : '',
    requiredEvidence: strings(root.required_evidence),
    risks: strings(root.risks),
    signals: {
      complex: strings(outputs.complex_signals),
      flags: strings(outputs.flags),
      mechanical: strings(outputs.mechanical_signals),
      ...(typeof outputs.pattern === 'boolean' ? { pattern: outputs.pattern } : {}),
      ...(typeof outputs.tier_mismatch === 'boolean' ? { tierMismatch: outputs.tier_mismatch } : {}),
    },
    tier: action,
    ...(decisionId === undefined ? {} : { decisionId }),
    ...(fork === undefined ? {} : { fork }),
    ...(typeof root.fallback_used === 'boolean' ? { fallbackUsed: root.fallback_used } : {}),
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
    ...(probabilities.length === 0 ? {} : { probabilities: Object.fromEntries(probabilities) }),
    ...(role === undefined ? {} : { role }),
    ...(contractChange === undefined ? {} : { contractChange }),
  }
}

export const askedOf = (ran: Ran, ms: number): Asked => {
  if (typeof ran === 'string') {
    return { decision: null, error: ran, ms }
  }

  const decision = ran.exitCode === 0 ? parseDecision(ran.stdout) : null

  return decision === null ? { decision, error: ran.exitCode === 0 ? 'parse failed' : failureOf(ran.exitCode, ran.stderr), ms } : { decision, ms }
}

// A Jev refusal record ({ refused_until: epoch s, status }) still in force at `now`.
const refusalOf = (value: unknown, now: number | undefined): string | undefined => {
  if (typeof value === 'string') {
    return text(value)
  }

  const refusal = record(value)
  const until = number(refusal.refused_until)

  if (Object.keys(refusal).length === 0 || (until !== undefined && now !== undefined && until * 1000 <= now)) {
    return undefined
  }

  return refusal.status === undefined || refusal.status === null ? 'refused' : `refused (HTTP ${String(refusal.status)})`
}

export const parseForkStatus = (stdout: string, now?: number): ForkStatus | null => {
  const root = parseObject(stdout)

  if (root === null || !Array.isArray(root.ladder)) {
    return null
  }

  const jev = record(root.jev)
  const cloudflare = record(root.cloudflare)
  const budget = record(cloudflare.budget)
  const ollama = record(root.ollama)
  const forks = record(root.forks)
  const refused = refusalOf(jev.refused, now)
  const config = text(root.config)
  const used = number(budget.used)
  const cap = number(budget.cap)
  const cloudflareHint = text(cloudflare.hint)
  const ollamaModel = text(ollama.model)
  const ollamaHint = text(ollama.hint)

  return {
    ladder: strings(root.ladder),
    ...(typeof root.enabled === 'boolean' ? { enabled: root.enabled } : {}),
    ...(config === undefined ? {} : { config }),
    ...(Object.keys(jev).length === 0
      ? {}
      : { jev: { enabled: jev.enabled === true, hasKey: jev.key === true, ...(refused === undefined ? {} : { refused }) } }),
    ...(Object.keys(cloudflare).length === 0
      ? {}
      : {
          cloudflare: {
            enabled: cloudflare.enabled === true,
            hasAccount: cloudflare.account === true,
            hasToken: cloudflare.token === true,
            ...(used === undefined ? {} : { used }),
            ...(cap === undefined ? {} : { cap }),
            ...(cloudflareHint === undefined ? {} : { hint: cloudflareHint }),
          },
        }),
    ...(Object.keys(ollama).length === 0
      ? {}
      : {
          ollama: {
            ...(ollamaModel === undefined ? {} : { model: ollamaModel }),
            ...(typeof ollama.reachable === 'boolean' ? { reachable: ollama.reachable } : {}),
            ...(typeof ollama.missing === 'boolean' || ollama.missing === null ? { missing: ollama.missing } : {}),
            ...(ollamaHint === undefined ? {} : { hint: ollamaHint }),
          },
        }),
    ...(Object.keys(forks).length === 0
      ? {}
      : { forks: { forks: number(forks.forks) ?? 0, sharp: number(forks.sharp) ?? 0, split: number(forks.split) ?? 0 } }),
  }
}

export const forkLayerOf = (base: Pick<DeckForkLayer, 'readAt' | 'mode' | 'script' | 'ladder'>, ran: Ran): DeckForkLayer => {
  if (typeof ran === 'string') {
    return { ...base, error: ran }
  }

  const status = ran.exitCode === 0 ? parseForkStatus(ran.stdout, base.readAt) : null

  return status === null ? { ...base, error: ran.exitCode === 0 ? 'parse failed' : failureOf(ran.exitCode, ran.stderr) } : { ...base, ...status }
}

// The engine joins one "<tier> unavailable or rejected: <reason>" per failed tier with "; ";
// a reason may itself hold "; ", so each runs to the next tier's marker.
const reasonsOf = (fallbackReason: string | undefined): Map<string, string> => {
  const source = fallbackReason ?? ''
  const marker = /(?:^|; )([\w:.-]+) unavailable or rejected: /g
  const marks: { tier: string; start: number; end: number }[] = []
  let match = marker.exec(source)

  while (match !== null) {
    marks.push({ end: match.index + match[0].length, start: match.index, tier: match[1] ?? '' })
    match = marker.exec(source)
  }

  return new Map(marks.map((mark, index) => [mark.tier, source.slice(mark.end, marks[index + 1]?.start ?? source.length).trim()]))
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The policy answers first; a split fork climbs the model tiers until one clears every gate.
export const ladderOf = (
  ladder: readonly string[],
  backend: string,
  fallbackReason: string | undefined,
  rationale: string | undefined,
): DeckLadderStep[] => {
  const reasons = reasonsOf(fallbackReason)
  const isModelAnswer = !backend.startsWith('deterministic')
  const walk = ladder.includes('deterministic') ? [...ladder] : ['deterministic', ...ladder]

  for (const tier of [...reasons.keys(), ...(isModelAnswer ? [backend] : [])]) {
    if (!walk.includes(tier)) {
      walk.push(tier)
    }
  }

  const answeredAt = isModelAnswer ? walk.indexOf(backend) : 0
  const agreed = new RegExp(`${escapeRegExp(backend)} agreed at (\\d+(?:\\.\\d+)?)\\.?$`).exec((rationale ?? '').trim())

  return walk.map((tier, index): DeckLadderStep => {
    const reason = reasons.get(tier)

    if (tier === 'deterministic') {
      if (backend === 'deterministic-fallback') {
        return { note: 'fallback: split, goes to the main session', outcome: 'answered', tier }
      }

      return isModelAnswer ? { note: 'split', outcome: 'answered', tier } : { outcome: 'answered', tier }
    }
    if (reason !== undefined) {
      return { note: fit(reason, NOTE_CAP), outcome: REJECTION.test(reason) ? 'rejected' : 'unavailable', tier }
    }
    if (index === answeredAt && isModelAnswer) {
      return agreed === null ? { outcome: 'answered', tier } : { note: `at ${agreed[1] ?? ''}`, outcome: 'agreed', tier }
    }

    return { outcome: 'skipped', tier }
  })
}

const answeredBy = (backend: string): string => {
  if (backend === '') {
    return '-'
  }

  return backend.startsWith('deterministic') ? 'policy' : (backend.split(':')[0] ?? backend)
}

export const backendLabel = (backend: string): string => (backend === 'deterministic-fallback' ? 'policy fallback' : answeredBy(backend))

export const pickStatus = (pick: DeckPick): DeckPickStatus => pick.status ?? 'decided'

export const pickTrigger = (pick: DeckPick): DeckPick['trigger'] => pick.trigger ?? (pick.scope === 'main' ? 'prompt' : 'spawn')

export const decidingPick = (
  input: Pick<DeckPick, 'id' | 'scope' | 'subject' | 'at' | 'trigger' | 'command' | 'history'> &
    Partial<Pick<DeckPick, 'turnId' | 'agentId' | 'actual'>>,
): DeckPick => ({
  ...input,
  backend: '',
  confidence: 0,
  decisionType: 'tier-selection',
  isApplied: false,
  recommended: '',
  status: 'deciding',
  tier: '',
})

// Spreads `current`, so what changed the pick while the script ran survives.
export const settledPick = (current: DeckPick, asked: Asked, roster: Roster, ladder: readonly string[]): DeckPick => {
  const { decision } = asked

  if (decision === null) {
    return { ...current, error: asked.error ?? 'parse failed', ms: asked.ms, status: 'failed' }
  }

  return {
    ...current,
    alternatives: decision.alternatives,
    backend: decision.backend,
    confidence: decision.confidence,
    ladder: ladderOf(ladder.length === 0 ? DEFAULT_LADDER : ladder, decision.backend, decision.fallbackReason, decision.rationale),
    ms: asked.ms,
    rationale: decision.rationale,
    recommended: roster[decision.tier],
    requiredEvidence: decision.requiredEvidence,
    risks: decision.risks,
    signals: decision.signals,
    status: 'decided',
    tier: decision.tier,
    ...(decision.decisionId === undefined ? {} : { decisionId: decision.decisionId }),
    ...(decision.fork === undefined ? {} : { fork: decision.fork }),
    ...(decision.fallbackReason === undefined ? {} : { fallbackReason: decision.fallbackReason }),
    ...(decision.probabilities === undefined ? {} : { probabilities: decision.probabilities }),
    ...(decision.role === undefined ? {} : { role: decision.role }),
    ...(decision.contractChange === undefined ? {} : { contractChange: decision.contractChange }),
  }
}

export const forkTally = (picks: readonly DeckPick[]): ForkTally => {
  const byBackend = new Map<string, number>()
  const tally: ForkTally = { asked: picks.length, byBackend: [], deciding: 0, failed: 0, sharp: 0, split: 0 }

  for (const pick of picks) {
    const status = pickStatus(pick)

    if (status === 'failed') {
      tally.failed += 1
    } else if (status === 'deciding') {
      tally.deciding += 1
    } else if (status === 'decided') {
      const label = answeredBy(pick.backend)

      byBackend.set(label, (byBackend.get(label) ?? 0) + 1)
      tally.sharp += pick.fork === 'sharp' ? 1 : 0
      tally.split += pick.fork === 'split' ? 1 : 0
    }
  }
  tally.byBackend = [...byBackend].sort((left, right) => right[1] - left[1])

  return tally
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
