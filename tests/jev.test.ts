import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_LADDER,
  DEFAULT_ROSTER,
  askedOf,
  backendLabel,
  decidingPick,
  decisionArgs,
  failureOf,
  forkCallOf,
  forkLayerOf,
  forkTally,
  frontmatterModel,
  historyOf,
  isForkSwitch,
  ladderOf,
  mayApply,
  parseDecision,
  parseForkStatus,
  settledPick,
  statusArgs,
} from '../hooks/lib/jev'

const DECISION = JSON.stringify({
  action: 'complex',
  alternatives: [{ action: 'mechanical', reason: 'Use once a named pattern covers the whole slice.' }],
  backend: 'jev',
  confidence: 0.94,
  decision_id: 'dec_ca1b0225c502449f',
  fallback_reason: null,
  fallback_used: false,
  fork: 'sharp',
  outputs: {
    complex_signals: [],
    flags: ['no-pattern'],
    mechanical_signals: [],
    model_contract_change: { noul: 0.42, type: 'noul' },
    pattern: false,
    role: 'senior-implementer',
    tier: 'complex',
    tier_mismatch: false,
  },
  probabilities: { complex: 0.97, mechanical: 0.03 },
  rationale: 'No pattern or mechanical signal is evidenced; an unclear tier is complex. jev agreed at 0.94.',
  required_evidence: ['the pattern to follow, or the reason none exists'],
  risks: [],
})

const STATUS = JSON.stringify({
  cloudflare: { account: true, budget: { cap: 9000, used: 1800 }, enabled: true, token: true },
  config: '/work/.claude/vistack/decisions.json',
  enabled: true,
  forks: { by_type: {}, forks: 5, sharp: 4, split: 1 },
  jev: { enabled: true, key: true, refused: { refused_until: 2, status: 402 } },
  ladder: ['deterministic', 'jev', 'cloudflare:clef-flash', 'ollama:clef-flash'],
  ollama: { hint: 'run `ollama pull clef-flash`', missing: true, model: 'clef-flash', reachable: true },
})

describe('jev', () => {
  test('reads every field of a tier decision', async () => {
    expect(parseDecision(DECISION)).toEqual({
      alternatives: [{ action: 'mechanical', reason: 'Use once a named pattern covers the whole slice.' }],
      backend: 'jev',
      confidence: 0.94,
      contractChange: 0.42,
      decisionId: 'dec_ca1b0225c502449f',
      fallbackUsed: false,
      fork: 'sharp',
      probabilities: { complex: 0.97, mechanical: 0.03 },
      rationale: 'No pattern or mechanical signal is evidenced; an unclear tier is complex. jev agreed at 0.94.',
      requiredEvidence: ['the pattern to follow, or the reason none exists'],
      risks: [],
      role: 'senior-implementer',
      signals: { complex: [], flags: ['no-pattern'], mechanical: [], pattern: false, tierMismatch: false },
      tier: 'complex',
    })
    expect(parseDecision('{"action":"mechanical","backend":"deterministic","confidence":0.8}')?.tier).toBe('mechanical')
    expect(parseDecision('{"action":"maybe"}')).toBeNull()
    expect(parseDecision('not json')).toBeNull()
    expect(frontmatterModel('---\nname: implementer\nmodel: sonnet\n---\nbody')).toBe('sonnet')
  })

  test('reads decisions status: keys and tokens as presence, the budget, a refusal still in force', async () => {
    expect(parseForkStatus(STATUS, 1_000)).toEqual({
      cloudflare: { cap: 9000, enabled: true, hasAccount: true, hasToken: true, used: 1800 },
      config: '/work/.claude/vistack/decisions.json',
      enabled: true,
      forks: { forks: 5, sharp: 4, split: 1 },
      jev: { enabled: true, hasKey: true, refused: 'refused (HTTP 402)' },
      ladder: ['deterministic', 'jev', 'cloudflare:clef-flash', 'ollama:clef-flash'],
      ollama: { hint: 'run `ollama pull clef-flash`', missing: true, model: 'clef-flash', reachable: true },
    })
    expect(parseForkStatus(STATUS, 3_000)?.jev).toEqual({ enabled: true, hasKey: true })
    expect(parseForkStatus('{"ladder":["deterministic"],"ollama":{"missing":null,"reachable":false}}')?.ollama).toEqual({ missing: null, reachable: false })
    expect(parseForkStatus('{"enabled":true}')).toBeNull()
    expect(parseForkStatus('oops')).toBeNull()
  })

  test('walks the ladder: failed tiers with their reason, the answering tier, the rest skipped', async () => {
    const reason = [
      'jev unavailable or rejected: TYPESAFE_KEY is not set; export it',
      'cloudflare:clef-flash unavailable or rejected: confidence 0.600 is below 0.850',
    ].join('; ')

    expect(ladderOf(DEFAULT_LADDER, 'ollama:clef-flash', reason, 'Pick complex.')).toEqual([
      { note: 'split', outcome: 'answered', tier: 'deterministic' },
      { note: 'TYPESAFE_KEY is not set; export it', outcome: 'unavailable', tier: 'jev' },
      { note: 'confidence 0.600 is below 0.850', outcome: 'rejected', tier: 'cloudflare:clef-flash' },
      { outcome: 'answered', tier: 'ollama:clef-flash' },
    ])
    expect(ladderOf(DEFAULT_LADDER, 'jev', undefined, 'An unclear tier is complex. jev agreed at 0.94.')).toEqual([
      { note: 'split', outcome: 'answered', tier: 'deterministic' },
      { note: 'at 0.94', outcome: 'agreed', tier: 'jev' },
      { outcome: 'skipped', tier: 'cloudflare:clef-flash' },
      { outcome: 'skipped', tier: 'ollama:clef-flash' },
    ])
    expect(ladderOf(['deterministic', 'jev'], 'deterministic', undefined, '')).toEqual([
      { outcome: 'answered', tier: 'deterministic' },
      { outcome: 'skipped', tier: 'jev' },
    ])
    expect(ladderOf(['deterministic', 'jev'], 'deterministic-fallback', `jev unavailable or rejected: ${'x'.repeat(80)}`, '')).toEqual([
      { note: 'fallback: split, goes to the main session', outcome: 'answered', tier: 'deterministic' },
      { note: `${'x'.repeat(59)}…`, outcome: 'unavailable', tier: 'jev' },
    ])
    expect(ladderOf([], 'ollama:clef-flash', undefined, '').map(step => step.tier)).toEqual(['deterministic', 'ollama:clef-flash'])
  })

  test('builds the argv, names the history, and reads a failed run', async () => {
    expect(decisionArgs('/p/s.py', ['--no-history'])).toEqual(['python3', '/p/s.py', 'decision', 'tier-selection', '--backend', 'auto', '--no-history'])
    expect(statusArgs('/p/s.py')).toEqual(['python3', '/p/s.py', 'decisions', 'status'])
    expect(statusArgs('/p/s.py', '/w/d.json')).toEqual(['python3', '/p/s.py', 'decisions', 'status', '--config', '/w/d.json'])
    expect(historyOf(['--history', '/w/h.jsonl', '--config', '/w/d.json'])).toBe('/w/h.jsonl')
    expect(historyOf(['--no-history'])).toBe('off')
    expect(failureOf(2, '\nTYPESAFE_KEY unset\nTraceback')).toBe('exit 2: TYPESAFE_KEY unset')
    expect(failureOf(1, '')).toBe('exit 1')
    expect(isForkSwitch('python3 "/x/scripts/vistack-decision.py" decisions on --jev')).toBe(true)
    expect(isForkSwitch('python3 /x/scripts/vistack-decision.py decisions status')).toBe(false)
  })

  test('reads a process result into an answer, and a status result into the fork layer', async () => {
    const base = { ladder: [], mode: 'suggest', readAt: 1_000, script: '/p/s.py' }

    expect(askedOf({ exitCode: 0, stderr: '', stdout: DECISION }, 500).decision?.backend).toBe('jev')
    expect(askedOf({ exitCode: 0, stderr: '', stdout: '{}' }, 5)).toEqual({ decision: null, error: 'parse failed', ms: 5 })
    expect(askedOf({ exitCode: 2, stderr: 'TYPESAFE_KEY unset', stdout: '' }, 5)).toEqual({ decision: null, error: 'exit 2: TYPESAFE_KEY unset', ms: 5 })
    expect(askedOf('spawn python3 ENOENT', 0)).toEqual({ decision: null, error: 'spawn python3 ENOENT', ms: 0 })
    expect(forkLayerOf(base, { exitCode: 0, stderr: '', stdout: STATUS })).toMatchObject({ ...base, enabled: true, ladder: DEFAULT_LADDER })
    expect(forkLayerOf(base, { exitCode: 1, stderr: 'bad config\n', stdout: '' })).toEqual({ ...base, error: 'exit 1: bad config' })
    expect(forkLayerOf(base, 'timed out')).toEqual({ ...base, error: 'timed out' })
    expect(forkCallOf(null, [])).toEqual({ argv: null, shown: {} })
    expect(forkCallOf('/p/s.py', ['--no-history']).shown).toEqual({
      command: 'python3 /p/s.py decision tier-selection --backend auto --no-history',
      history: 'off',
    })
  })

  test('a deciding pick settles to decided or failed and keeps what changed it meanwhile', async () => {
    const asked = decidingPick({ at: 5, command: 'python3 s.py', history: 'off', id: 'turn-t1', scope: 'main', subject: 'fix it', trigger: 'prompt', turnId: 't1' })
    const meanwhile = { ...asked, actual: 'claude-opus-5-5' }
    const decided = settledPick(meanwhile, { decision: parseDecision(DECISION), ms: 500 }, DEFAULT_ROSTER, DEFAULT_LADDER)

    expect(asked.status).toBe('deciding')
    expect(decided).toMatchObject({ actual: 'claude-opus-5-5', backend: 'jev', ms: 500, recommended: 'opus', role: 'senior-implementer', status: 'decided', tier: 'complex' })
    expect(decided.ladder?.[1]).toEqual({ note: 'at 0.94', outcome: 'agreed', tier: 'jev' })
    expect(settledPick(asked, { decision: null, error: 'exit 2: TYPESAFE_KEY unset', ms: 300 }, DEFAULT_ROSTER, DEFAULT_LADDER)).toMatchObject({
      error: 'exit 2: TYPESAFE_KEY unset',
      ms: 300,
      status: 'failed',
    })
    expect(settledPick(asked, { decision: null, ms: 1 }, DEFAULT_ROSTER, DEFAULT_LADDER).error).toBe('parse failed')
    expect(settledPick(asked, { decision: parseDecision(DECISION), ms: 1 }, DEFAULT_ROSTER, []).ladder).toHaveLength(DEFAULT_LADDER.length)
  })

  test('tallies the session by status, fork and backend; an old pick reads decided', async () => {
    const base = decidingPick({ at: 1, id: 'p', scope: 'main', subject: 's', trigger: 'prompt' })
    const { status: _unused, trigger: _unusedToo, ...old } = { ...base, backend: 'deterministic', fork: 'sharp' as const }
    const picks = [
      { ...base, backend: 'jev', fork: 'sharp' as const, status: 'decided' as const },
      { ...base, backend: 'deterministic-fallback', fork: 'split' as const, status: 'decided' as const },
      { ...base, status: 'failed' as const },
      base,
      old as typeof base,
    ]

    expect(forkTally(picks)).toEqual({ asked: 5, byBackend: [['policy', 2], ['jev', 1]], deciding: 1, failed: 1, sharp: 2, split: 1 })
    expect(backendLabel('cloudflare:clef-flash')).toBe('cloudflare')
    expect(backendLabel('')).toBe('-')
  })

  test('applies only to built-in types that named no model', async () => {
    expect(mayApply('apply', 'Explore', undefined)).toBe(true)
    expect(mayApply('apply', 'vistack:implementer', undefined)).toBe(false)
    expect(mayApply('apply', 'Explore', 'haiku')).toBe(false)
    expect(mayApply('suggest', 'Explore', undefined)).toBe(false)
  })
})
