import { expect, mock, test } from 'claude-code/testing'

import { cells } from '../hooks/lib/theme'

import type { DeckPick } from '../types'

const SURFACES = ['terminal', 'desktop'] as const

// The pane draws its tabs one column narrower than the body.
const COLUMNS = 59

const pane = (surface: (typeof SURFACES)[number]) => ({
  component: 'Pane' as const,
  plugin: 'vistack',
  props: {
    bodyColumns: COLUMNS + 1,
    isFocused: true,
    placement: 'dock' as const,
    scroll: { bodyRows: 40, offset: 0 },
    title: 'viStack',
    view: {},
  },
  requestId: 'vistack-deck',
  surface,
})

type Drawn = { findAll: (query: { type: string }) => Promise<{ text: string }[]> }

const texts = async (ui: Drawn): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map(element => element.text)

const PICK = { decisionType: 'tier-selection', isApplied: false } as const

const SAVED_BY_AN_EARLIER_DECK = { at: 2_000, backend: 'jev', confidence: 0.94, id: 'turn-t1', isApplied: false, recommended: 'claude-opus-5-5', scope: 'main', subject: 'fix the parser', tier: 'complex' }

const PICKS_OLDEST_FIRST = [
  { ...PICK, at: 1_000, backend: 'deterministic', confidence: 0.8, id: 'turn-t0', recommended: 'sonnet', scope: 'main', status: 'decided', subject: 'rename the helper', tier: 'mechanical', trigger: 'prompt' },
  SAVED_BY_AN_EARLIER_DECK,
  {
    ...PICK,
    at: 3_000,
    backend: '',
    confidence: 0,
    error: 'exit 2 · TYPESAFE_KEY unset',
    id: 'agent-a1',
    ms: 300,
    recommended: '',
    scope: 'agent',
    status: 'failed',
    subject: 'implementer: wire the atom',
    tier: '',
    trigger: 'spawn',
  },
  { ...PICK, at: 4_000, backend: '', confidence: 0, id: 'turn-t2', recommended: '', scope: 'main', status: 'deciding', subject: 'plan the change', tier: '', trigger: 'prompt' },
] as unknown as DeckPick[]

test('the Board leads with what waits on you, then what runs now and the last fork; charts and comms live on their own tabs', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const drawn = await texts(ui)
    const at = [/Needs reply$/, /Nothing waits on you\./, /Now$/, /Nothing running\./, /Last fork$/, /No fork asked yet\./].map(pattern =>
      drawn.findIndex(text => pattern.test(text)),
    )

    expect(at.every(index => index >= 0)).toBe(true)
    expect([...at].sort((left, right) => left - right)).toEqual(at)
    expect(await ui.find({ text: /delegates only/ })).toBeDefined()
    for (const gone of [/Cost by member/, /Org at a glance/, /Activity/, /Comms/, /needs reply$/]) {
      expect(await ui.find({ text: gone })).toBeUndefined()
    }
    await ui.press({ key: 'tab-cost' })
    expect(await ui.find({ text: /Cost by member/ })).toBeDefined()
    expect(await ui.find({ text: /No fork asked yet\. Run \/vistack:decisions-on to add a model tier\./ })).toBeDefined()
    await ui.press({ key: 'tab-session' })
    expect(await ui.find({ text: /Activity/ })).toBeDefined()
    expect(await ui.find({ text: /tool calls \/ min/ })).toBeDefined()
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ text: /^👤 You · Owner · asks 0 · no prompt yet$/ })).toBeDefined()
    await ui.press({ key: 'tab-board' })
    await ui.unmount()
  }
})

test('folding Monitors hides the section and keeps its counts in the header', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /0 running · 0 active/ })).toBeDefined()
  expect(await ui.find({ text: /Running/ })).toBeDefined()

  const isFoldKept = (await ui.find({ key: 'fold-monitors' })) !== undefined

  if (isFoldKept) {
    await ui.press({ key: 'fold-monitors' })
    expect((await ui.find({ key: 'fold-monitors' }))?.text).toBe('▸ Monitors')
    expect(await ui.find({ text: /Running/ })).toBeUndefined()
    expect(await ui.find({ key: 'mon-refresh' })).toBeUndefined()
    expect(await ui.find({ text: /0 running · 0 active/ })).toBeDefined()
    await ui.press({ key: 'fold-monitors' })
    expect(await ui.find({ text: /Running/ })).toBeDefined()
    await ui.press({ key: 'tab-settings' })
    await ui.select({ key: 'set-icons', value: 'ascii' })
    await ui.press({ key: 'tab-board' })
    expect((await ui.find({ key: 'fold-monitors' }))?.text).toBe('v Monitors')
  }
  await ui.unmount()
})

const MONITOR = { canCancel: false, canStop: true, detail: '', kind: 'shell', source: 'tool', startedAt: 0 } as const

const MONITORS = [
  { ...MONITOR, id: 'r1', label: 'dev server', status: 'running' },
  { ...MONITOR, canStop: false, endedAt: 500, endedBy: 'report', id: 'e1', label: 'unit tests', status: 'done' },
]

const SHERLOCK = { agentId: 'a1', description: 'map the call sites', endedAt: 2_500, model: 'claude-sonnet-4-6', nickname: 'Sherlock', startedAt: 2_000, status: 'completed', toolUseId: 'tool-a1', type: 'Explore' }

const FALLBACK_PICK = {
  ...PICK,
  agentId: 'a1',
  at: 3_000,
  backend: 'deterministic-fallback',
  confidence: 0.6,
  fork: 'split',
  id: 'agent-a1',
  recommended: 'claude-opus-5-5',
  scope: 'agent',
  status: 'decided',
  subject: 'Explore: map the call sites',
  tier: 'complex',
  trigger: 'spawn',
}

const CROWDED_PICK = { ...FALLBACK_PICK, at: 2_500, id: 'agent-a1-long', subject: `Explore: ${'trace every caller of the fold map '.repeat(3)}` }

test('an open Monitors fold names its counts once: the section under it draws no header of its own', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))

    expect((await ui.find({ key: 'fold-monitors' }))?.text).toBe('▾ Monitors')
    expect((await texts(ui)).filter(text => /running · \d+ active/.test(text))).toEqual(['0 running · 0 active'])
    expect(await ui.find({ key: 'mon-awake' })).toBeDefined()
    await ui.unmount()
  }
})

test('Ended rows wait behind "show ended (n)", fold-monitors-ended toggles them, and a selected ended row stays in view while folded', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('state.get', { key: 'monitors', plugin: 'vistack' }, () => ({ value: { value: MONITORS, version: 1 } }))

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ key: 'sel-mon-r1' })).toBeDefined()
  expect(await ui.find({ key: 'sel-mon-e1' })).toBeUndefined()
  expect((await ui.find({ key: 'fold-monitors-ended' }))?.text).toBe('▸ show ended (1)')
  await ui.press({ key: 'fold-monitors-ended' })
  expect(await ui.find({ key: 'sel-mon-e1' })).toBeDefined()
  expect((await ui.find({ key: 'fold-monitors-ended' }))?.text).toBe('▾ Ended (1)')
  await ui.press({ key: 'fold-monitors-ended' })
  expect(await ui.find({ key: 'sel-mon-e1' })).toBeUndefined()
  await ui.press({ key: 'fold-monitors-ended' })
  await ui.press({ key: 'sel-mon-e1' })
  await ui.press({ key: 'fold-monitors-ended' })
  expect((await ui.find({ key: 'fold-monitors-ended' }))?.text).toBe('▸ show ended (1)')
  expect(await ui.find({ key: 'sel-mon-e1' })).toBeDefined()
  await ui.unmount()
})

test('the New loop form waits behind its fold while keep-awake stays in view, and fold-loop-form opens it', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ key: 'mon-loop-prompt' })).toBeUndefined()
  expect(await ui.find({ key: 'mon-awake' })).toBeDefined()
  expect((await ui.find({ key: 'fold-loop-form' }))?.text).toBe('▸ New loop')
  await ui.press({ key: 'fold-loop-form' })
  expect(await ui.find({ key: 'mon-loop-prompt' })).toBeDefined()
  expect(await ui.find({ key: 'mon-loop-title' })).toBeUndefined()
  await ui.unmount()
})

test('Board, Cost and Decisions draw the same fork in the same two lines; a nickname follows the subject only when it fits', async ($, on) => {
  mock.clock(on, { now: 5_000 })
  on('state.get', { key: 'picks', plugin: 'vistack' }, () => ({ value: { value: [CROWDED_PICK, FALLBACK_PICK], version: 1 } }))
  on('state.get', { key: 'agents', plugin: 'vistack' }, () => ({ value: { value: [SHERLOCK], version: 1 } }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const onBoard = await texts(ui)
    const subject = onBoard.find(text => /◇ Explore: map the call sites · Sherlock$/.test(text))
    const result = onBoard.find(text => /^ {3}complex ▸ Opus 5\.5 · \.60 · policy fallback · split$/.test(text))

    expect(subject).toBeDefined()
    expect(result).toBeDefined()
    await ui.press({ key: 'tab-cost' })
    expect(await texts(ui)).toEqual(expect.arrayContaining([subject, result]))
    await ui.press({ key: 'tab-decisions' })
    expect((await ui.find({ key: 'pick-agent-a1' }))?.text).toBe(subject)
    expect(await texts(ui)).toContain(result)

    const crowded = (await ui.find({ key: 'pick-agent-a1-long' }))?.text ?? ''

    expect(crowded).toMatch(/◇ Explore: trace every caller/)
    expect(crowded).not.toMatch(/Sherlock/)
    for (const text of [subject ?? '', result ?? '', crowded]) {
      expect(cells(text) <= COLUMNS, `${cells(text)} cells: ${text}`).toBe(true)
    }
    await ui.press({ key: 'tab-board' })
    await ui.unmount()
  }
})

test('Cost shows the three newest forks in two lines each, reading an older pick as decided', async ($, on) => {
  mock.clock(on, { now: 5_000 })
  on('state.get', { key: 'picks', plugin: 'vistack' }, () => ({ value: { value: PICKS_OLDEST_FIRST, version: 1 } }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))

    await ui.press({ key: 'tab-cost' })
    expect(await ui.find({ text: /see Decisions \(8\)/ })).toBeDefined()
    expect(await ui.find({ text: /⌨ fix the parser$/ })).toBeDefined()
    expect(await ui.find({ text: /^ {3}complex ▸ Opus 5\.5 · \.94 · jev$/ })).toBeDefined()
    expect(await ui.find({ text: /◇ implementer: wire the atom$/ })).toBeDefined()
    expect(await ui.find({ text: /^ {3}.+ failed: exit 2 · TYPESAFE_KEY unset · 0\.3s$/ })).toBeDefined()
    expect(await ui.find({ text: /⌨ plan the change$/ })).toBeDefined()
    expect(await ui.find({ text: /^ {3}.+ asking the fork layer…$/ })).toBeDefined()
    expect(await ui.find({ text: /rename the helper/ })).toBeUndefined()
    for (const text of await texts(ui)) {
      expect(cells(text) <= COLUMNS, `${cells(text)} cells: ${text}`).toBe(true)
    }
    await ui.press({ key: 'tab-board' })
    await ui.unmount()
  }
})
