import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const pane = (surface: 'terminal' | 'desktop') => ({
  component: 'Pane' as const,
  plugin: 'vistack',
  props: {
    bodyColumns: 60,
    isFocused: true,
    placement: 'dock' as const,
    scroll: { bodyRows: 40, offset: 0 },
    title: 'viStack',
    view: {},
  },
  requestId: 'vistack-deck',
  surface,
})

const FORK_STATUS = JSON.stringify({
  cloudflare: { account: true, budget: { cap: 9000, used: 1800 }, enabled: true, token: true },
  config: '/work/.claude/vistack/decisions.json',
  enabled: true,
  forks: { by_type: {}, forks: 5, sharp: 4, split: 1 },
  jev: { enabled: true, key: true, refused: null },
  ladder: ['deterministic', 'jev', 'cloudflare:clef-flash', 'ollama:clef-flash'],
  ollama: { missing: false, model: 'clef-flash', reachable: true },
})

// The engine's answer for a split fork Jev agreed with; every value invented.
const FORK_DECISION = JSON.stringify({
  action: 'complex',
  alternatives: [{ action: 'mechanical', reason: 'Use once a named pattern covers the whole slice.' }],
  backend: 'jev',
  confidence: 0.94,
  decision_id: 'dec_0000000000000001',
  decision_type: 'tier-selection',
  fallback_reason: null,
  fallback_used: false,
  fork: 'sharp',
  outputs: { complex_signals: [], flags: [], mechanical_signals: [], model_contract_change: { noul: 0.42, type: 'noul' }, pattern: false, role: 'senior-implementer', tier: 'complex', tier_mismatch: false },
  probabilities: { complex: 0.97, mechanical: 0.03 },
  rationale: 'No pattern or mechanical signal is evidenced; an unclear tier is complex. jev agreed at 0.94.',
  required_evidence: ['the pattern to follow, or the reason none exists'],
  risks: [],
})

type ForkAnswer = { exitCode: number; stderr: string; stdout: string }

// A started session, its decision script on disk unless `isScriptFound` is false: `decisions status`
// answers at once and a fork 500 ms later with `answer`. Resolves to every argv the deck ran.
const forkSession = async ($: Engine, on: On, clock: MockClock, answer: ForkAnswer, isScriptFound = true): Promise<string[][]> => {
  const ran: string[][] = []

  mock.store(on, { deckKeepAwake: 'off' })
  mock.env(on, { HOME: '/home/me' })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', (_engine, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'deck' } }))
  on('turn.start', (_engine, e) => ({ turnId: e.turnId }))
  on('command.run', { command: 'vistack:decisions-off' }, () => ({ text: '' }))
  on('fs.stat', (_engine, e) =>
    isScriptFound && e.path.endsWith('/scripts/vistack-decision.py') ? { value: { isLink: false, kind: 'file' as const, mtimeMs: 0, size: 1 } } : { deny: 'ENOENT' },
  )
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('process.run', async (_engine, e) => {
    const [, , verb, noun] = e.argv

    ran.push([...e.argv])
    if (verb === 'decision') {
      await clock.sleep(500)

      return { value: { ...answer, isStderrTruncated: false, isStdoutTruncated: false } }
    }

    return { value: { exitCode: 0, isStderrTruncated: false, isStdoutTruncated: false, stderr: '', stdout: verb === 'decisions' && noun === 'status' ? FORK_STATUS : '' } }
  })
  await $.session.start({ cwd: '/work', isInteractive: false, surface: null })
  await clock.advance(300)

  return ran
}

const statusCalls = (ran: string[][]) => ran.filter(argv => argv[2] === 'decisions' && argv[3] === 'status')

test('a prompt asks the fork layer: its row shows while the script runs, reads the pick, and opens to the chain', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const ran = await forkSession($, on, clock, { exitCode: 0, stderr: '', stdout: FORK_DECISION })

  expect(statusCalls(ran)).toHaveLength(1)
  await $.turn.start({ text: 'we already implemented a deck panel', turnId: 't1' })
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-decisions' })
  expect(await ui.find({ text: /ladder: policy ▸ jev ✓key ▸ cloudflare 1\.8k\/9k ▸ ollama ✓/ })).toBeDefined()
  expect(await ui.find({ text: /asking the fork layer/ })).toBeDefined()
  await clock.advance(600)
  expect(await ui.find({ text: /asking the fork layer/ })).toBeUndefined()
  expect(await ui.find({ text: /complex ▸ Opus 5\.5 · \.94 · jev · sharp · 0\.5s/ })).toBeDefined()
  expect(await ui.find({ text: /this session: 1 asked · 1 sharp · 0 split · jev 1/ })).toBeDefined()
  expect(ran.find(argv => argv[2] === 'decision')).toEqual(['python3', expect.any(String), 'decision', 'tier-selection', '--backend', 'auto', '--no-history'])
  await ui.press({ key: 'pick-turn-t1' })
  expect(await ui.find({ text: /on prompt · tier-selection · took 0\.5s/ })).toBeDefined()
  expect(await ui.find({ text: /jev: agreed at 0\.94 · complex \.94/ })).toBeDefined()
  expect(await ui.find({ text: /final: complex → senior-implementer → Opus 5\.5/ })).toBeDefined()
  await $.command.run({ args: '', command: 'vistack:decisions-off', origin: { kind: 'composer' }, presentation: { columns: 80, isFullscreen: false } })
  await clock.advance(300)
  expect(statusCalls(ran)).toHaveLength(2)
  await ui.unmount()
})

test('a fork whose script exits non-zero reads failed with the exit code and the first stderr line', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const ran = await forkSession($, on, clock, { exitCode: 2, stderr: 'TYPESAFE_KEY unset\nTraceback (most recent call last):', stdout: '' })

  await $.turn.start({ text: 'fix the typo in README', turnId: 't2' })
  await clock.advance(900)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-decisions' })
  expect(await ui.find({ text: /failed: exit 2: TYPESAFE_KEY unset · 0\.5s/ })).toBeDefined()
  expect(await ui.find({ text: /this session: 1 asked · 0 sharp · 0 split · failed 1/ })).toBeDefined()
  await ui.press({ key: 'fork-refresh' })
  await clock.advance(300)
  expect(statusCalls(ran)).toHaveLength(2)
  await ui.unmount()
})

test('/deck decisions opens the Decisions tab, which says when the script is missing', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const ran = await forkSession($, on, clock, { exitCode: 0, stderr: '', stdout: FORK_DECISION }, false)
  const said = await $.command.run({ args: 'decisions', command: 'deck', origin: { kind: 'composer' }, presentation: { columns: 80, isFullscreen: false } })

  expect(said.text).toBe('viStack deck open on Decisions. Keys 1-9 switch tabs.')

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /Fork layer/ })).toBeDefined()
  expect(await ui.find({ text: /vistack-decision\.py not found: set the vistackRoot option/ })).toBeDefined()
  expect(ran).toEqual([])
  await ui.unmount()
})
