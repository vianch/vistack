import { expect, mock, test } from 'claude-code/testing'

import { DEFAULT_LADDER, DEFAULT_ROSTER, decidedPick, decidingPick, parseDecision } from '../hooks/lib/jev'

import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import type { DeckPick } from '../types'

const STARTED_AT = 5_000

const NOT_A_SLICE = {
  action: 'complex',
  backend: 'deterministic',
  confidence: 0.6,
  decision_id: 'dec_chat',
  decision_type: 'tier-selection',
  fork: 'split',
  outputs: { complex_signals: [], flags: [], mechanical_signals: [], role: 'senior-implementer', slice_like: false, tier: 'complex' },
  rationale: 'The request reads as conversation, not a unit of work.',
}

const FELL_BACK = {
  action: 'mechanical',
  backend: 'deterministic-fallback',
  confidence: 0.55,
  decision_id: 'dec_fell',
  decision_type: 'tier-selection',
  fallback_reason:
    'jev unavailable or rejected: confidence 0.080 is below 0.650; agrees: mechanical; cloudflare:clef-flash unavailable or rejected: confidence 0.41 is below 0.65; dissents: complex',
  fork: 'split',
  outputs: {
    corroborated_by: ['jev'],
    dissent: ['cloudflare:clef-flash'],
    fallback: true,
    margins: { 'cloudflare:clef-flash': 0.41, jev: 0.08 },
    role: 'implementer',
    slice_like: true,
    tier: 'mechanical',
  },
  rationale: 'A named pattern covers the slice.',
  risks: ['Laya refinement was not used: jev unavailable or rejected: confidence 0.080 is below 0.650.'],
}

const settled = (answer: Record<string, unknown>, id: string, subject: string): DeckPick => {
  const asking = decidingPick({ at: STARTED_AT + 1_000, id, scope: 'main', subject, trigger: 'prompt', turnId: id })
  const decision = parseDecision(JSON.stringify(answer))

  return decision === null ? asking : { ...decidedPick(asking, decision, DEFAULT_ROSTER, DEFAULT_LADDER), ms: 400 }
}

const pane = () => ({
  component: 'Pane' as const,
  plugin: 'vistack',
  props: { bodyColumns: 64, isFocused: true, placement: 'dock' as const, scroll: { bodyRows: 120, offset: 0 }, title: 'viStack', view: {} },
  requestId: 'vistack-deck',
  surface: 'terminal' as const,
})

const session = async ($: Engine, on: On, clock: MockClock, picks: readonly DeckPick[]): Promise<void> => {
  mock.store(on, { deckKeepAwake: 'off' })
  mock.env(on, { HOME: '/home/me' })
  on('state.get', { key: 'picks', plugin: 'vistack' }, () => ({ value: { value: [...picks], version: 1 } }))
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [], startedAt: STARTED_AT } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', (_engine, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'deck' } }))
  on('fs.stat', (_engine, e) => (e.path.endsWith('/scripts/vistack-decision.py') ? { value: { isLink: false, kind: 'file' as const, mtimeMs: 0, size: 1 } } : { deny: 'ENOENT' }))
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('process.run', () => ({ value: { exitCode: 0, isStderrTruncated: false, isStdoutTruncated: false, stderr: '', stdout: '{"ladder":["deterministic","jev","cloudflare:clef-flash"]}' } }))
  await $.session.start({ cwd: '/work', isInteractive: false, surface: null })
  await clock.advance(600)
}

test('a no-slice row names no tier or model, and a fallen-back row shows its votes and margins', async ($, on) => {
  const clock = mock.clock(on, { now: STARTED_AT })

  await session($, on, clock, [settled(NOT_A_SLICE, 'turn-t1', 'thanks, that works'), settled(FELL_BACK, 'turn-t2', 'rename the helper')])

  const ui = await $.ui.mount(pane())

  await ui.press({ key: 'tab-decisions' })
  expect(await ui.find({ text: /^ {3}not a slice · \.60 · policy · split · 0\.4s$/ })).toBeDefined()
  expect(await ui.find({ text: /^ {3}mechanical ▸ Sonnet 5\.5 · \.55 · policy fallback · split/ })).toBeDefined()
  await ui.press({ key: 'pick-turn-t1' })
  expect(await ui.find({ text: /final: not a slice · no model to suggest$/ })).toBeDefined()
  expect(await ui.find({ text: /^ {3}ran: not yet · ended: running/ })).toBeDefined()
  expect(await ui.find({ text: /senior-implementer|suggested, not applied/ })).toBeUndefined()
  await ui.press({ key: 'pick-turn-t2' })
  expect(await ui.find({ text: /jev: rejected margin 0\.080 is below 0\.650; agrees:/ })).toBeDefined()
  expect(await ui.find({ text: /cloudflare: rejected margin 0\.41 is below 0\.65; dissents:/ })).toBeDefined()
  expect(await ui.find({ text: /votes: corroborated by jev · dissent cloudflare · margins/ })).toBeDefined()
  expect(await ui.find({ text: /risks: Laya refinement was not used: jev unavailable or/ })).toBeDefined()
  expect(await ui.find({ text: /rejected: confidence 0\.080/ })).toBeUndefined()
  expect(await ui.find({ text: /^confidence = the margin between a model's top two odds$/ })).toBeDefined()
  await ui.unmount()
})

test('t reaches a type no fork of this session has, and says who asks it', async ($, on) => {
  const clock = mock.clock(on, { now: STARTED_AT })

  await session($, on, clock, [settled(FELL_BACK, 'turn-t2', 'rename the helper')])

  const ui = await $.ui.mount(pane())

  await ui.press({ key: 'tab-decisions' })
  for (const type of ['intake-analysis', 'grooming', 'playbook-selection', 'decomposition']) {
    await ui.press({ key: 'fork-type' })
    expect((await ui.find({ key: 'fork-type' }))?.text).toBe(`type: ${type}`)
  }
  expect(await ui.find({ text: /^No decomposition fork this session\.$/ })).toBeDefined()
  expect(await ui.find({ text: /^The coordinator asks it after slice-plan\.$/ })).toBeDefined()
  expect(await ui.find({ text: /rename the helper/ })).toBeUndefined()
  await ui.unmount()
})
