import { describe, expect, test } from 'claude-code/testing'

import { applyReasonOf, tierFinalOf } from '../hooks/lib/apply-reason'
import { marginText, votesOf } from '../hooks/lib/fork-text'
import { NOT_A_SLICE, TYPE_LABELS, headlineOf, isNotSlice, nextFilter, sliceLikeOf } from '../hooks/lib/fork-types'
import { DEFAULT_ROSTER, decidedPick, decidingPick, forkTally, parseDecision, rosterModel } from '../hooks/lib/jev'
import { HAND_BACK, READ_ONLY_ROLE, TASK_NOTIFICATION, promptNonSliceOf, skippedPick, spawnNonSliceOf } from '../hooks/lib/non-slice'
import { askedHintOf, historyTallyOf, overviewHeadOf, overviewLineOf, typeOverviewOf } from '../hooks/lib/type-overview'

import type { DeckPick } from '../types'

const ALL_TYPES = TYPE_LABELS.map(([type]) => type)

const tierPick = (extra: Partial<DeckPick> = {}): DeckPick => ({
  ...decidingPick({ at: 1, id: 'agent-a1', scope: 'agent', subject: 'Explore: map it', trigger: 'spawn' }),
  backend: 'deterministic',
  confidence: 0.9,
  recommended: 'sonnet',
  role: 'implementer',
  status: 'decided',
  tier: 'mechanical',
  ...extra,
})

const tierAnswer = (outputs: Record<string, unknown>) =>
  JSON.stringify({ action: 'mechanical', backend: 'deterministic', confidence: 0.95, decision_type: 'tier-selection', fork: 'sharp', outputs: { tier: 'mechanical', ...outputs } })

const historyRow = (type: string, action: string, extra: Record<string, unknown> = {}, id = `dec_${type}_${action}`): string =>
  JSON.stringify({
    context: { metadata: { source: 'main-session' }, task: { request: `ask ${type}` } },
    decision: { action, backend: 'deterministic', confidence: 0.9, decision_id: id, decision_type: type, outputs: {}, ...extra },
    decision_id: id,
    kind: 'decision',
    timestamp: '2026-11-03T10:00:00Z',
  })

describe('why a tier pick did or did not set its model', () => {
  test('names one reason per branch', async () => {
    const spawn = { hasCallerModel: false, mode: 'suggest', subagentType: 'Explore' }

    expect(applyReasonOf(tierPick({ ...spawn, isApplied: true, mode: 'apply', trigger: 'spawn-apply' }))).toBe('applied')
    expect(applyReasonOf(tierPick({ id: 'turn-t1', scope: 'main', trigger: 'prompt' }))).toBe('advisory: a prompt has no model to set')
    expect(applyReasonOf(tierPick({ id: 'history-dec_1', scope: 'main', trigger: 'cli' }))).toBe('advisory: the main session asked it and decides')
    expect(applyReasonOf(tierPick({ ...spawn, hasCallerModel: true }))).toBe("kept the caller's model")
    expect(applyReasonOf(tierPick({ ...spawn, hasCallerModel: true, subagentType: 'vistack:implementer' }))).toBe("kept the caller's model")
    expect(applyReasonOf(tierPick({ ...spawn, subagentType: 'vistack:implementer' }))).toBe("the coordinator picks this role's model (model-selection)")
    expect(applyReasonOf(tierPick({ ...spawn, mode: 'apply', subagentType: 'superpowers:code-reviewer' }))).toBe('the deck sets only general-purpose, Explore, Plan')
    expect(applyReasonOf(tierPick(spawn))).toBe('suggest mode; jevMode=apply would set it')
    expect(applyReasonOf(tierPick({ ...spawn, subagentType: 'general-purpose' }))).toBe('suggest mode; jevMode=apply would set it')
    expect(applyReasonOf(tierPick({ ...spawn, mode: 'apply', trigger: 'spawn-apply' }))).toBe('not applied: the answer named no model')
    expect(applyReasonOf(tierPick())).toBe('suggested; an earlier deck kept no reason')
  })

  test('a pick the deck never asked says why first, and the tier chain ends with the reason', async () => {
    const handBack = skippedPick(decidingPick({ at: 1, id: 'turn-t9', scope: 'main', subject: '<agent-message from="a1">', trigger: 'prompt' }), HAND_BACK)
    const readOnly = skippedPick(tierPick({ subagentType: 'vistack:analyst' }), READ_ONLY_ROLE)
    const decidedNotSlice = tierPick({ outputs: { slice_like: 'false' }, recommended: '', scope: 'main', trigger: 'prompt' })

    expect(applyReasonOf(handBack)).toBe('hand-back: the deck asked nothing')
    expect(applyReasonOf(readOnly)).toBe('read-only role: the deck asked nothing')
    expect(tierFinalOf(handBack, '→')).toBe('not a slice · hand-back: the deck asked nothing')
    expect(tierFinalOf(readOnly, '→')).toBe('not a slice · read-only role: the deck asked nothing')
    expect(tierFinalOf(decidedNotSlice, '→')).toBe('not a slice · no model to suggest')
    expect(tierFinalOf(tierPick({ hasCallerModel: false, mode: 'suggest', subagentType: 'Explore' }), '->')).toBe(
      'mechanical -> implementer -> Sonnet 5.5 · suggest mode; jevMode=apply would set it',
    )
    expect(isNotSlice(skippedPick(tierPick(), 'jevMode off'))).toBe(false)
    expect(forkTally([handBack, readOnly, tierPick({ fork: 'sharp' })])).toEqual({ asked: 1, byBackend: [['policy', 1]], deciding: 0, failed: 0, sharp: 1, skipped: 2, split: 0 })
  })

  test('a hand-back, a task notification and a read-only role are no slice', async () => {
    expect(promptNonSliceOf('<agent-message from="ab4f">\n[Subagent hand-back] The text below is the final report')).toBe(HAND_BACK)
    expect(promptNonSliceOf('  <task-notification>\n<task-type>artifact-watch-lifecycle</task-type>')).toBe(TASK_NOTIFICATION)
    expect(promptNonSliceOf('fix the failing upload test')).toBeUndefined()
    expect(promptNonSliceOf('why did <agent-message> show up in my prompt?')).toBeUndefined()
    for (const role of ['vistack:analyst', 'researcher', 'vistack:reviewer', 'vistack:health-check', 'vistack:advisor', 'vistack:planner', 'vistack:groomer']) {
      expect(spawnNonSliceOf(role)).toBe(READ_ONLY_ROLE)
    }
    for (const role of ['vistack:implementer', 'vistack:pr-reviewer', 'Explore', 'general-purpose', 'superpowers:code-reviewer']) {
      expect(spawnNonSliceOf(role)).toBeUndefined()
    }
  })

  test('an older pick with no trigger reads its scope', async () => {
    const { trigger: _unused, ...old } = tierPick({ id: 'turn-t1', scope: 'main' })

    expect(applyReasonOf(old as DeckPick)).toBe('advisory: a prompt has no model to set')
  })
})

describe('a prompt the engine reads as no slice', () => {
  test('slice_like false, true, as text, and missing', async () => {
    expect(sliceLikeOf('tier-selection', { slice_like: 'false' })).toBe(false)
    expect(sliceLikeOf('tier-selection', { slice_like: false })).toBe(false)
    expect(sliceLikeOf('tier-selection', { slice_like: 'False' })).toBe(false)
    expect(sliceLikeOf('tier-selection', { slice_like: 'true' })).toBe(true)
    expect(sliceLikeOf('tier-selection', { slice_like: true })).toBe(true)
    expect(sliceLikeOf('tier-selection', {})).toBeUndefined()
    expect(sliceLikeOf('tier-selection', undefined)).toBeUndefined()
    expect(sliceLikeOf('tier-selection', { slice_like: 'maybe' })).toBeUndefined()
    expect(sliceLikeOf('grooming', { slice_like: 'false' })).toBeUndefined()
  })

  test('heads the row "not a slice" with no model, and recommends none', async () => {
    const base = decidingPick({ at: 1, id: 'turn-t1', scope: 'main', subject: 'thanks, that works', trigger: 'prompt' })
    const settle = (outputs: Record<string, unknown>): DeckPick => {
      const decision = parseDecision(tierAnswer(outputs))

      return decision === null ? base : decidedPick(base, decision, DEFAULT_ROSTER, [])
    }
    const notSlice = settle({ slice_like: false })
    const textNotSlice = settle({ slice_like: 'false' })
    const slice = settle({ slice_like: true })
    const unknown = settle({})

    expect(headlineOf(notSlice)).toEqual({ lead: NOT_A_SLICE })
    expect(notSlice.recommended).toBe('')
    expect(isNotSlice(notSlice)).toBe(true)
    expect(headlineOf(textNotSlice)).toEqual({ lead: NOT_A_SLICE })
    expect(headlineOf(slice)).toEqual({ lead: 'mechanical', model: 'sonnet' })
    expect(isNotSlice(slice)).toBe(false)
    expect(headlineOf(unknown)).toEqual({ lead: 'mechanical', model: 'sonnet' })
    expect(isNotSlice(unknown)).toBe(false)

    const decision = parseDecision(tierAnswer({ slice_like: 'false' }))

    expect(decision === null ? 'parse failed' : rosterModel(DEFAULT_ROSTER, decision)).toBeUndefined()
  })
})

describe('the chain wording', () => {
  test('a gate rejection reads margin; other text keeps confidence', async () => {
    expect(marginText('confidence 0.080 is below 0.650')).toBe('margin 0.080 is below 0.650')
    expect(marginText('Laya refinement was not used: jev unavailable or rejected: confidence 0.46 is below 0.65.')).toBe(
      'Laya refinement was not used: jev unavailable or rejected: margin 0.46 is below 0.65.',
    )
    expect(marginText('an unclear tier lowers confidence')).toBe('an unclear tier lowers confidence')
  })

  test('corroboration, dissent and the answering model, compact', async () => {
    expect(votesOf({ backend_model: '@cf/clef-flash', corroborated_by: '["cloudflare:clef-flash","ollama:clef-flash"]', dissent: '[]' })).toEqual([
      'corroborated by cloudflare, ollama',
      'model @cf/clef-flash',
    ])
    expect(votesOf({ dissent: '[{"backend":"jev","action":"complex","confidence":0.4}]' })).toEqual(['dissent jev complex'])
    expect(votesOf({ corroborated_by: '["cloudflare:clef-flash","ollama:clef-fl…' })).toEqual(['corroborated by ["cloudflare:clef-flash","ollama:clef-fl…'])
    expect(votesOf({ corroborated_by: 'jev' })).toEqual(['corroborated by jev'])
    expect(votesOf({ dissent: '["ollama:clef-flash"]', margins: '{"jev":0.08,"ollama:clef-flash":0.41,"bad":"x"}' })).toEqual(['dissent ollama', 'margins jev .08, ollama .41'])
    expect(votesOf({ margins: '{}' })).toEqual([])
    expect(votesOf({ tier: 'complex' })).toEqual([])
    expect(votesOf(undefined)).toEqual([])
  })
})

describe('every decision type, in one overview', () => {
  test('an empty session and no history list all 12, each never asked', async () => {
    const rows = typeOverviewOf([], historyTallyOf(null))

    expect(rows.map(row => row.type)).toEqual(ALL_TYPES)
    expect(rows.every(row => row.session === 0 && row.allTime === null && row.isNeverAsked)).toBe(true)
    expect(rows.filter(row => row.askedBy === 'deck').map(row => row.type)).toEqual(['intake-analysis', 'playbook-selection', 'tier-selection'])
    expect(typeOverviewOf([], null).map(row => row.type)).toEqual(ALL_TYPES)
  })

  test('tallies the whole history in one pass: once per decision id, fallback share, newest action', async () => {
    const history = [
      historyRow('tier-selection', 'complex', { confidence: 0.5 }),
      historyRow('tier-selection', 'mechanical', { backend: 'deterministic-fallback', confidence: 0.25 }),
      historyRow('tier-selection', 'complex', { confidence: 0.75, outputs: { slice_like: false } }, 'dec_chat'),
      historyRow('tier-selection', 'complex', { confidence: 0.5 }),
      JSON.stringify({ decision_id: 'dec_tier-selection_complex', kind: 'outcome', outcome: 'answer' }),
      '{"kind":"decision","decision":',
      historyRow('verification', 'accept'),
    ].join('\n')
    const tally = historyTallyOf(history)

    expect(tally.hasHistory).toBe(true)
    expect(tally.byType['tier-selection']).toEqual({ confidenceSum: 1.5, fallbacks: 1, forks: 3, lastAction: NOT_A_SLICE })
    expect(tally.byType.verification).toEqual({ confidenceSum: 0.9, fallbacks: 0, forks: 1, lastAction: 'accept' })
    expect(historyTallyOf('')).toEqual({ byType: {}, hasHistory: true })
  })

  test('mixes this session with the whole history, and falls back to the status counts', async () => {
    const tally = historyTallyOf([historyRow('tier-selection', 'complex'), historyRow('model-selection', 'keep', { backend: 'deterministic-fallback', confidence: 0.5 })].join('\n'))
    const live = tierPick({ confidence: 0.7, id: 'turn-t1', scope: 'main', trigger: 'prompt' })
    const intake = { ...live, action: 'classify', decisionType: 'intake-analysis', id: 'turn-t1-intake' }
    const asking = decidingPick({ at: 2, decisionType: 'intake-analysis', id: 'turn-t2-intake', scope: 'main', subject: 's', trigger: 'prompt' })
    const odd = { ...live, action: 'ship', decisionType: 'brand-new-type', id: 'history-dec_new' }
    const rows = typeOverviewOf([live, intake, asking, odd], tally)
    const byType = new Map(rows.map(row => [row.type, row]))

    expect(rows.map(row => row.type)).toEqual([...ALL_TYPES, 'brand-new-type'])
    expect(byType.get('tier-selection')).toMatchObject({ allTime: 1, fallbackShare: 0, isNeverAsked: false, lastAction: 'complex', meanMargin: 0.9, session: 1 })
    expect(byType.get('intake-analysis')).toMatchObject({ allTime: 0, askedBy: 'deck', fallbackShare: 0, lastAction: 'classify', meanMargin: 0.7, session: 2 })
    expect(byType.get('model-selection')).toMatchObject({ allTime: 1, askedBy: 'coordinator', fallbackShare: 1, isNeverAsked: false, lastAction: 'keep', session: 0 })
    expect(byType.get('grooming')).toMatchObject({ allTime: 0, isNeverAsked: true, session: 0 })
    expect(byType.get('brand-new-type')).toMatchObject({ askedBy: 'coordinator', session: 1 })

    const status = [{ forks: 7, meanConfidence: 0.81, sharp: 5, type: 'grooming' }]
    const unread = new Map(typeOverviewOf([], historyTallyOf(null), status).map(row => [row.type, row]))

    expect(unread.get('grooming')).toMatchObject({ allTime: 7, isNeverAsked: false, meanMargin: 0.81 })
    expect(unread.get('verification')).toMatchObject({ allTime: null, isNeverAsked: true })
  })

  test('lays each row out in fixed columns that fit the width', async () => {
    const rows = typeOverviewOf([tierPick({ id: 'turn-t1', scope: 'main', trigger: 'prompt' })], historyTallyOf(historyRow('tier-selection', 'complex')))
    const tier = rows.find(row => row.type === 'tier-selection')
    const grooming = rows.find(row => row.type === 'grooming')

    const gap = (count: number): string => ' '.repeat(count)

    expect(overviewHeadOf(64)).toBe(`type${gap(15)}now${gap(2)}all margin fall by${gap(4)}last`)
    expect(tier === undefined ? '' : overviewLineOf(tier, 64)).toBe(`tier-selection${gap(7)}1${gap(4)}1${gap(4)}.90${gap(3)}0% deck${gap(2)}complex`)
    expect(grooming === undefined ? '' : overviewLineOf(grooming, 64)).toBe(`grooming${gap(13)}0${gap(4)}0${gap(6)}-${gap(4)}- coord never asked`)
    expect(rows.every(row => overviewLineOf(row, 50).length <= 50)).toBe(true)
    expect(rows.every(row => overviewLineOf(row, 30).length <= 30)).toBe(true)
  })

  test('says who asks each type, and when', async () => {
    expect(askedHintOf('tier-selection')).toBe('the deck asks it on each prompt and each subagent spawn')
    expect(askedHintOf('decomposition')).toBe('the coordinator asks it after slice-plan')
    expect(askedHintOf('brand-new-type')).toBe('the coordinator asks it at a boundary in skills/laya-decision/SKILL.md')
    expect(ALL_TYPES.every(type => askedHintOf(type) !== askedHintOf('brand-new-type'))).toBe(true)
  })
})

describe('the type filter', () => {
  test('cycles all, then all 12 types in schema order, then any other type present', async () => {
    const seen: string[] = []
    let current = ''

    for (let step = 0; step < ALL_TYPES.length + 1; step += 1) {
      current = nextFilter(current, [])
      seen.push(current)
    }
    expect(seen).toEqual([...ALL_TYPES, ''])
    expect(nextFilter('file-selection', [{ ...tierPick(), decisionType: 'zzz' }])).toBe('zzz')
    expect(nextFilter('zzz', [{ ...tierPick(), decisionType: 'zzz' }])).toBe('')
    expect(nextFilter('gone', [])).toBe('')
  })
})
