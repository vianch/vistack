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

const PLAYBOOK_DECISION = JSON.stringify({
  action: 'investigation',
  alternatives: [],
  backend: 'deterministic',
  change_conditions: ['Change route when the request adds a different finish condition.'],
  confidence: 0.92,
  decision_id: 'dec_0000000000000002',
  decision_type: 'playbook-selection',
  fork: 'sharp',
  outputs: { classification: 'investigation', playbook: 'investigation', route_source: 'signals' },
  probabilities: { investigation: 0.92 },
  rationale: 'The request asks for understanding and no code change.',
  required_evidence: ["the matched playbook's finish predicate"],
  risks: [],
})

const INTAKE_DECISION = JSON.stringify({
  action: 'investigate',
  alternatives: [],
  backend: 'deterministic',
  confidence: 0.88,
  decision_id: 'dec_0000000000000003',
  decision_type: 'intake-analysis',
  fork: 'sharp',
  outputs: { classification: 'investigation', readiness: 'needs-investigation' },
  probabilities: { investigate: 0.88 },
  rationale: 'The request asks what exists before any change.',
  required_evidence: [],
  risks: [],
})

type ForkAnswer = { exitCode: number; stderr: string; stdout: string }

const ANSWERS: Readonly<Record<string, string>> = { 'intake-analysis': INTAKE_DECISION, 'playbook-selection': PLAYBOOK_DECISION }

const answered = (type: string): ForkAnswer => ({ exitCode: 0, stderr: '', stdout: ANSWERS[type] ?? FORK_DECISION })

const forkTypes = (ran: string[][]) => ran.filter(argv => argv[2] === 'decision').map(argv => argv[3])

// A started session, its decision script on disk unless `isScriptFound` is false: `decisions status`
// answers at once and each fork 500 ms later with `answer` for its decision type. Resolves to every
// argv the deck ran.
const forkSession = async (
  $: Engine,
  on: On,
  clock: MockClock,
  answer: ForkAnswer | ((type: string) => ForkAnswer),
  isScriptFound = true,
): Promise<string[][]> => {
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

      return { value: { ...(typeof answer === 'function' ? answer(noun ?? '') : answer), isStderrTruncated: false, isStdoutTruncated: false } }
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
  const ran = await forkSession($, on, clock, answered)

  expect(statusCalls(ran)).toHaveLength(1)
  await $.turn.start({ text: 'we already implemented a deck panel', turnId: 't1' })
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-decisions' })
  expect(await ui.find({ text: /ladder: policy ▸ jev ✓key ▸ cloudflare 1\.8k\/9k ▸ ollama ✓/ })).toBeDefined()
  expect(await ui.find({ text: /asking the fork layer/ })).toBeDefined()
  await clock.advance(2_000)
  expect(await ui.find({ text: /asking the fork layer/ })).toBeUndefined()
  expect(await ui.find({ text: /complex ▸ Opus 5\.5 · \.94 · jev · sharp · 0\.5s/ })).toBeDefined()
  expect(await ui.find({ text: /playbook ▸ investigation · \.92 · policy · sharp · 0\.5s/ })).toBeDefined()
  expect(await ui.find({ text: /intake ▸ investigate · \.88 · policy · sharp · 0\.5s/ })).toBeDefined()
  expect(await ui.find({ text: / playbook-selection we already implemented a deck/ })).toBeDefined()
  expect(await ui.find({ text: /this session: 3 asked · 3 sharp · 0 split/ })).toBeDefined()
  expect(await ui.find({ text: /^intake-analysis +1 +- +\.88 +0% deck +investigate$/ })).toBeDefined()
  expect(await ui.find({ text: /^grooming +0 +- +- +- coord never asked$/ })).toBeDefined()
  expect(ran.filter(argv => argv[2] === 'decision')).toEqual([
    ['python3', expect.any(String), 'decision', 'tier-selection', '--backend', 'auto', '--no-history'],
    ['python3', expect.any(String), 'decision', 'playbook-selection', '--backend', 'auto', '--no-history'],
    ['python3', expect.any(String), 'decision', 'intake-analysis', '--backend', 'auto', '--no-history'],
  ])
  await ui.press({ key: 'pick-turn-t1' })
  expect(await ui.find({ text: /on prompt · tier-selection · took 0\.5s/ })).toBeDefined()
  expect(await ui.find({ text: /jev: agreed at 0\.94 · complex \.94/ })).toBeDefined()
  expect(await ui.find({ text: /final: complex → senior-implementer → Opus 5\.5 ·$/ })).toBeDefined()
  expect(await ui.find({ text: /^ +advisory: a prompt has no model to set$/ })).toBeDefined()
  expect(await ui.find({ text: /suggested, not applied/ })).toBeUndefined()
  await $.command.run({ args: '', command: 'vistack:decisions-off', origin: { kind: 'composer' }, presentation: { columns: 80, isFullscreen: false } })
  await clock.advance(300)
  expect(statusCalls(ran)).toHaveLength(2)
  await ui.unmount()
})

test('intake-analysis joins the match path only; a hand-back and a read-only role are settled without the CLI', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })

  on('agent.spawn', (_engine, e) => ({ agentId: e.subagentType === 'vistack:analyst' ? 'a2' : 'a1', model: 'claude-sonnet-5-5' }))

  const ran = await forkSession($, on, clock, answered)
  const turn = async (turnId: string, text: string): Promise<void> => {
    await $.turn.start({ text, turnId })
    await clock.advance(2_000)
  }

  await turn('t1', 'map the deck panel')
  expect(forkTypes(ran)).toEqual(['tier-selection', 'playbook-selection', 'intake-analysis'])
  await turn('t2', 'and its tests too')
  expect(forkTypes(ran)).toHaveLength(4)
  await turn('t3', 'new task: port the parser')
  expect(forkTypes(ran).slice(4)).toEqual(['tier-selection', 'playbook-selection', 'intake-analysis'])
  await turn('t4', '<agent-message from="a9">\n[Subagent hand-back] The text below is the final report of a subagent.')
  await turn('t5', '<task-notification>\n<task-type>artifact-watch-lifecycle</task-type>')
  await $.agent.spawn({ description: 'map the call sites', prompt: 'Map every call site.', subagentType: 'vistack:analyst' } as never)
  await $.agent.spawn({ description: 'list the hooks', prompt: 'List the hooks.', subagentType: 'Explore' } as never)
  await clock.advance(2_000)
  expect(forkTypes(ran)).toHaveLength(8)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-decisions' })
  expect(await ui.find({ text: /^ {3}not a slice · hand-back: the deck asked nothing$/ })).toBeDefined()
  expect(await ui.find({ text: /^ {3}not a slice · task notification: the deck asked nothing$/ })).toBeDefined()
  expect(await ui.find({ text: /^ {3}not a slice · read-only role: the deck asked nothing$/ })).toBeDefined()
  expect(await ui.find({ text: /this session: 8 asked · 8 sharp · 0 split/ })).toBeDefined()
  expect(await ui.find({ text: / · not asked 3$/ })).toBeDefined()
  expect(await ui.find({ text: /^tier-selection +4 +- +\.94 +0% deck +complex$/ })).toBeDefined()
  await ui.press({ key: 'pick-turn-t4' })
  expect(await ui.find({ text: /not asked: \d\d:\d\d:\d\d on prompt · tier-selection$/ })).toBeDefined()
  expect(await ui.find({ text: /final: not a slice · hand-back: the deck asked nothing/ })).toBeDefined()
  expect(await ui.find({ text: /sent: |advisory: a prompt/ })).toBeUndefined()
  await ui.press({ key: 'pick-agent-a1' })
  expect(await ui.find({ text: /final: complex → senior-implementer → Opus 5\.5 · suggest$/ })).toBeDefined()
  expect(await ui.find({ text: /^ +mode; jevMode=apply would set it$/ })).toBeDefined()
  await ui.unmount()
})

test('a fork whose script exits non-zero reads failed with the exit code and the first stderr line', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const ran = await forkSession($, on, clock, { exitCode: 2, stderr: 'TYPESAFE_KEY unset\nTraceback (most recent call last):', stdout: '' })

  await $.turn.start({ text: 'fix the typo in README', turnId: 't2' })
  await clock.advance(2_000)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-decisions' })
  expect(await ui.find({ text: /failed: exit 2: TYPESAFE_KEY unset · 0\.5s/ })).toBeDefined()
  expect(await ui.find({ text: /this session: 3 asked · 0 sharp · 0 split · failed 3/ })).toBeDefined()
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
