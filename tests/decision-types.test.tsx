import { describe, expect, mock, test } from 'claude-code/testing'

import { headlineOf, nextFilter, typesOf } from '../hooks/lib/fork-types'
import { HISTORY_ROWS, historyPicksOf, mergePicks } from '../hooks/lib/history'
import { DEFAULT_LADDER, DEFAULT_ROSTER, decidedPick, decidingPick, isMatchPath, parseDecision, parseForkStatus } from '../hooks/lib/jev'

import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import type { Headline } from '../hooks/lib/fork-types'
import type { DeckPick } from '../types'

const answer = (type: string, action: string, outputs: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  action,
  alternatives: [{ action: 'other', reason: `why not ${action}` }],
  backend: 'deterministic',
  change_conditions: [`Change when ${type} sees new evidence.`],
  confidence: 0.9,
  decision_id: `dec_${type}`,
  decision_type: type,
  fork: 'sharp',
  outputs,
  probabilities: { [action]: 0.9 },
  rationale: `${type} rationale`,
  required_evidence: [`evidence for ${type}`],
  risks: [],
  ...extra,
})

type Case = { answer: ReturnType<typeof answer>; headline: Headline; row: RegExp }

// One answer per laya/schema.py decision type, shaped as the CLI prints it.
const CASES: readonly Case[] = [
  {
    answer: answer('intake-analysis', 'ready-for-grooming', { classification: 'bug-fix', readiness: 'needs-grooming' }),
    headline: { choice: 'ready-for-grooming', lead: 'intake' },
    row: /intake ▸ ready-for-grooming · \.90 · policy · sharp$/,
  },
  {
    answer: answer('grooming', 'needs-information', { missing: ['acceptance criteria'], ready: false }),
    headline: { choice: 'needs-information', lead: 'grooming' },
    row: /grooming ▸ needs-information · \.90 · policy · sharp$/,
  },
  {
    answer: answer('playbook-selection', 'bug-fix', { classification: 'bug-fix', playbook: 'bug-fix', route_source: 'signals' }),
    headline: { choice: 'bug-fix', lead: 'playbook' },
    row: /playbook ▸ bug-fix · \.90 · policy · sharp$/,
  },
  {
    answer: answer('decomposition', 'single-slice', { estimated_files: 0, parallelizable: false, shared_files: [] }),
    headline: { choice: 'single-slice', lead: 'slices' },
    row: /slices ▸ single-slice · \.90 · policy · sharp$/,
  },
  {
    answer: answer('tier-selection', 'complex', { complex_signals: ['contract'], flags: [], mechanical_signals: [], role: 'senior-implementer', tier: 'complex' }),
    headline: { lead: 'complex', model: 'opus' },
    row: /complex ▸ Opus 5\.5 · \.90 · policy · sharp$/,
  },
  {
    answer: answer('model-selection', 'step-up', { changed: true, dispatch_effort: 'xhigh', dispatch_model: 'opus', role: 'implementer' }),
    headline: { choice: 'step-up', lead: 'model', model: 'opus' },
    row: /model ▸ step-up ▸ Opus 5\.5 · \.90 · policy · sharp$/,
  },
  {
    answer: answer('dispatch-readiness', 'hold', { missing: ['writable file list'], ready: false }),
    headline: { choice: 'hold', lead: 'dispatch' },
    row: /dispatch ▸ hold · \.90 · policy · sharp$/,
  },
  {
    answer: answer('runtime-progress', 'continue', { attempts: 0, phase: '', stalled: false }),
    headline: { choice: 'continue', lead: 'progress' },
    row: /progress ▸ continue · \.90 · policy · sharp$/,
  },
  {
    answer: answer('verification', 'request-evidence', { evidence_count: 0, sufficient: false }),
    headline: { choice: 'request-evidence', lead: 'verify' },
    row: /verify ▸ request-evidence · \.90 · policy · sharp$/,
  },
  {
    answer: answer('skill-improvement', 'collect-evidence', { override_count: 0, repeated_pattern: false }),
    headline: { lead: 'collect-evidence' },
    row: /^\s*collect-evidence · \.90 · policy · sharp$/,
  },
  {
    answer: answer('tool-selection', 'Read', { irreversible_options: [], options: ['Read', 'Grep', 'Bash'], signal: 'named' }),
    headline: { choice: 'Read', lead: 'tool' },
    row: /tool ▸ Read · \.90 · policy · sharp$/,
  },
  {
    answer: answer('file-selection', 'hooks/lib/jev.ts', { options: ['hooks/lib/jev.ts', 'hooks/register.tsx'], signal: 'none' }, { backend: 'deterministic-fallback', confidence: 0.5, fork: 'split' }),
    headline: { choice: 'hooks/lib/jev.ts', lead: 'file' },
    row: /file ▸ hooks\/lib\/jev\.ts · \.50 · policy fallback · split$/,
  },
]

const SESSION_START = 5_000

const IN_SESSION = '1970-01-01T00:00:05Z'

const historyRow = (decision: Record<string, unknown>, at = IN_SESSION, source: string | null = 'main-session'): string =>
  JSON.stringify({
    context: { metadata: source === null ? {} : { source }, task: { request: `ask ${String(decision.decision_type)}` } },
    decision: { ...decision, created_at: at },
    decision_id: decision.decision_id,
    event_id: `decision:${String(decision.decision_id)}`,
    kind: 'decision',
    timestamp: at,
  })

// Every type in the session, then what the reader must skip: a torn line, an outcome, a row from
// before the session, a row the deck wrote, and a repeated decision id.
const HISTORY = [
  ...CASES.map(one => historyRow(one.answer)),
  '{"kind":"decision","decision":',
  JSON.stringify({ decision_id: 'dec_grooming', kind: 'outcome', outcome: 'answer', timestamp: IN_SESSION }),
  historyRow({ ...answer('verification', 'accept', {}), decision_id: 'dec_earlier' }, '1970-01-01T00:00:04Z'),
  historyRow({ ...answer('tier-selection', 'mechanical', { tier: 'mechanical' }), decision_id: 'dec_deck' }, IN_SESSION, 'main-turn'),
  historyRow({ ...answer('grooming', 'ready', {}), decision_id: 'dec_grooming' }),
].join('\n')

const base = decidingPick({ at: 1, id: 'p', scope: 'main', subject: 's', trigger: 'cli' })

describe('every decision type', () => {
  test('parses, settles, and heads its row by type', async () => {
    for (const one of CASES) {
      const decision = parseDecision(JSON.stringify(one.answer), one.answer.decision_type)

      expect(decision).toMatchObject({ action: one.answer.action, decisionType: one.answer.decision_type })
      expect(decision === null ? null : headlineOf(decidedPick(base, decision, DEFAULT_ROSTER, DEFAULT_LADDER))).toEqual(one.headline)
    }
    expect(parseDecision(JSON.stringify(answer('playbook-selection', 'feature', { route_source: 'signals' })))?.outputs).toEqual({ route_source: 'signals' })
    expect(headlineOf({ ...base, action: 'bug-fix', decisionType: 'playbook-selection' })).toEqual({ choice: 'bug-fix', lead: 'playbook' })
    expect(headlineOf({ ...base, action: 'ship', decisionType: 'brand-new-type' })).toEqual({ choice: 'ship', lead: 'brand-new-type' })
  })

  test('a pick saved by 0.30.0 heads a tier row: no action, no type, no outputs', async () => {
    const { decisionType: _unused, ...old } = { ...base, recommended: 'claude-opus-5-5', tier: 'complex' }

    expect(headlineOf(old as DeckPick)).toEqual({ lead: 'complex', model: 'claude-opus-5-5' })
  })

  test('reads this session\'s CLI forks from the history tail and nothing else', async () => {
    const picks = historyPicksOf(HISTORY, SESSION_START + 700, DEFAULT_ROSTER, DEFAULT_LADDER)

    expect(picks.map(pick => pick.decisionType)).toEqual(CASES.map(one => one.answer.decision_type))
    expect(picks[0]).toMatchObject({ id: 'history-dec_intake-analysis', status: 'decided', subject: 'ask intake-analysis', trigger: 'cli' })
    expect(picks.find(pick => pick.decisionId === 'dec_grooming')?.action).toBe('needs-information')
    expect(historyPicksOf(null, 0, DEFAULT_ROSTER, [])).toEqual([])
    expect(historyPicksOf('not json\n\n[]\n', 0, DEFAULT_ROSTER, [])).toEqual([])
    expect(historyPicksOf(HISTORY, SESSION_START + 1_000, DEFAULT_ROSTER, [])).toEqual([])

    const long = Array.from({ length: HISTORY_ROWS + 50 }, (_, index) => historyRow(answer('grooming', 'ready', {}, { decision_id: `dec_${index}` })))

    expect(historyPicksOf(long.join('\n'), 0, DEFAULT_ROSTER, [])).toHaveLength(HISTORY_ROWS)
  })

  test('merges history under the live picks without repeating a decision id', async () => {
    const live = [{ ...base, at: 9, decisionId: 'dec_playbook-selection', id: 'turn-t1-playbook' }]
    const merged = mergePicks(live, historyPicksOf(HISTORY, SESSION_START, DEFAULT_ROSTER, []))

    expect(merged).toHaveLength(CASES.length)
    expect(merged.filter(pick => pick.decisionId === 'dec_playbook-selection').map(pick => pick.id)).toEqual(['turn-t1-playbook'])
    expect(mergePicks(live, [])).toEqual(live)
  })

  test('counts, cycles and orders by type; the match path is the first prompt or a new task', async () => {
    const picks = [{ ...base, decisionType: 'verification' }, base, { ...base, decisionType: 'zzz' }, base]

    expect(typesOf(picks)).toEqual([['tier-selection', 2], ['verification', 1], ['zzz', 1]])
    expect(nextFilter('', picks)).toBe('intake-analysis')
    expect(nextFilter('verification', picks)).toBe('skill-improvement')
    expect(nextFilter('file-selection', picks)).toBe('zzz')
    expect(nextFilter('zzz', picks)).toBe('')
    expect(nextFilter('grooming', picks)).toBe('playbook-selection')
    expect(isMatchPath([{ startedAt: 0, text: 'a', turnId: 't1' }], 't1', 'fix it')).toBe(true)
    expect(isMatchPath([{ startedAt: 0, text: 'a', turnId: 't1' }, { startedAt: 1, text: 'b', turnId: 't2' }], 't2', 'fix it')).toBe(false)
    expect(isMatchPath([{ startedAt: 0, text: 'a', turnId: 't1' }, { startedAt: 1, text: 'b', turnId: 't2' }], 't2', '  New task: port it')).toBe(true)
  })

  test('reads forks.by_type from decisions status in schema order', async () => {
    const status = JSON.stringify({
      forks: {
        by_type: { 'playbook-selection': { forks: 3, mean_confidence: 0.92, sharp: 3 }, 'tier-selection': { forks: 41, mean_confidence: 0.81, sharp: 30 } },
        forks: 44,
        sharp: 33,
        split: 11,
      },
      ladder: ['deterministic'],
    })

    expect(parseForkStatus(status)?.forks?.byType).toEqual([
      { forks: 3, meanConfidence: 0.92, sharp: 3, type: 'playbook-selection' },
      { forks: 41, meanConfidence: 0.81, sharp: 30, type: 'tier-selection' },
    ])
  })
})

const pane = () => ({
  component: 'Pane' as const,
  plugin: 'vistack',
  props: { bodyColumns: 72, isFocused: true, placement: 'dock' as const, scroll: { bodyRows: 120, offset: 0 }, title: 'viStack', view: {} },
  requestId: 'vistack-deck',
  surface: 'terminal' as const,
})

const STATUS = JSON.stringify({
  enabled: true,
  forks: { by_type: { 'playbook-selection': { forks: 3, mean_confidence: 0.92, sharp: 3 }, 'tier-selection': { forks: 41, mean_confidence: 0.81, sharp: 30 } }, forks: 44, sharp: 33, split: 11 },
  ladder: ['deterministic'],
})

// A session whose consuming repo holds `history`; the deck reads it with the status at start.
const historySession = async ($: Engine, on: On, clock: MockClock, history: string): Promise<void> => {
  mock.store(on, { deckKeepAwake: 'off' })
  mock.env(on, { HOME: '/home/me' })
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [], startedAt: SESSION_START + 700 } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', (_engine, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'deck' } }))
  on('fs.stat', (_engine, e) => (e.path.endsWith('/scripts/vistack-decision.py') ? { value: { isLink: false, kind: 'file' as const, mtimeMs: 0, size: 1 } } : { deny: 'ENOENT' }))
  on('fs.read', (_engine, e) => (e.path === '/work/.claude/vistack/decision-history.jsonl' ? { value: history } : { deny: 'ENOENT' }))
  on('process.run', (_engine, e) => ({
    value: { exitCode: 0, isStderrTruncated: false, isStdoutTruncated: false, stderr: '', stdout: e.argv[2] === 'decisions' && e.argv[3] === 'status' ? STATUS : '' },
  }))
  await $.session.start({ cwd: '/work', isInteractive: false, surface: null })
  await clock.advance(600)
}

test('the Decisions tab draws every type from the history, filters by type with t, and opens a non-tier chain', async ($, on) => {
  const clock = mock.clock(on, { now: SESSION_START })

  await historySession($, on, clock, HISTORY)

  const ui = await $.ui.mount(pane())

  await ui.press({ key: 'tab-decisions' })
  for (const one of CASES) {
    const type = one.answer.decision_type

    expect(await ui.find({ text: one.row })).toBeDefined()
    expect(await ui.find({ text: new RegExp(`\\$ ${type === 'tier-selection' ? '' : `${type} `}ask ${type}$`) })).toBeDefined()
  }
  expect(await ui.find({ text: /verify ▸ accept/ })).toBeUndefined()
  expect(await ui.find({ text: /complex ▸ Opus 5\.5 · \.90 · policy · sharp/ })).toBeDefined()
  expect(await ui.find({ text: /mechanical ▸/ })).toBeUndefined()
  expect(await ui.find({ text: /^12 of 12 asked this session$/ })).toBeDefined()
  expect(await ui.find({ text: /^verification +1 +2 +\.90 +0% coord accept$/ })).toBeDefined()
  expect(await ui.find({ text: /^tier-selection +1 +2 +\.90 +0% deck +mechanical$/ })).toBeDefined()
  expect(await ui.find({ text: /^file-selection +1 +1 +\.50 +100% coord hooks\/lib\/jev\.ts$/ })).toBeDefined()
  expect(await ui.find({ text: /history by type:|^by type:/ })).toBeUndefined()
  expect(await ui.find({ text: /other types: the main session's own CLI calls/ })).toBeDefined()
  expect((await ui.find({ key: 'fork-type' }))?.text).toBe('type: all')
  await ui.press({ key: 'fork-type' })
  await ui.press({ key: 'fork-type' })
  expect((await ui.find({ key: 'fork-type' }))?.text).toBe('type: grooming')
  expect(await ui.find({ text: /grooming ▸ needs-information/ })).toBeDefined()
  expect(await ui.find({ text: /playbook ▸ bug-fix/ })).toBeUndefined()
  expect(await ui.find({ text: /^grooming · newest first$/ })).toBeDefined()
  await ui.press({ key: 'fork-type' })
  await ui.press({ key: 'pick-history-dec_playbook-selection' })
  expect(await ui.find({ text: /on main-session CLI call · playbook-selection$/ })).toBeDefined()
  expect(await ui.find({ text: /type: playbook-selection · action bug-fix/ })).toBeDefined()
  expect(await ui.find({ text: /out: playbook bug-fix/ })).toBeDefined()
  expect(await ui.find({ text: /P: bug-fix \.90/ })).toBeDefined()
  expect(await ui.find({ text: /final: playbook → bug-fix · advisory, the main session decides/ })).toBeDefined()
  expect(await ui.find({ text: /needs: evidence for playbook-selection/ })).toBeDefined()
  expect(await ui.find({ text: /changes if: Change when playbook-selection sees new evidence\./ })).toBeDefined()
  expect(await ui.find({ text: /else: other: "why not bug-fix"/ })).toBeDefined()
  expect(await ui.find({ text: /policy: sharp "playbook-selection rationale"/ })).toBeDefined()
  await ui.unmount()
})

test('a 0.30.0 pick from $.state still draws as a tier row and opens to its tier chain', async ($, on) => {
  const clock = mock.clock(on, { now: SESSION_START })
  const old = { at: SESSION_START, backend: 'jev', confidence: 0.94, id: 'turn-t1', isApplied: false, recommended: 'claude-opus-5-5', role: 'senior-implementer', scope: 'main', subject: 'fix the parser', tier: 'complex' }

  on('state.get', { key: 'picks', plugin: 'vistack' }, () => ({ value: { value: [old], version: 1 } }))
  await historySession($, on, clock, '')

  const ui = await $.ui.mount(pane())

  await ui.press({ key: 'tab-decisions' })
  expect(await ui.find({ text: / fix the parser$/ })).toBeDefined()
  expect(await ui.find({ text: /complex ▸ Opus 5\.5 · \.94 · jev/ })).toBeDefined()
  await ui.press({ key: 'pick-turn-t1' })
  expect(await ui.find({ text: /on prompt · tier-selection/ })).toBeDefined()
  expect(await ui.find({ text: /final: complex → senior-implementer → Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ text: /· action / })).toBeUndefined()
  await ui.unmount()
})
