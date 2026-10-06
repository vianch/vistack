import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

const pane = (surface: (typeof SURFACES)[number]) => ({
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

test('the tab bar switches tabs on every surface that docks a pane', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))

    expect(await ui.find({ text: /Needs reply/ })).toBeDefined()
    await ui.press({ key: 'tab-cost' })
    expect(await ui.find({ text: /engine total/ })).toBeDefined()
    await ui.press({ key: 'tab-timeline' })
    expect(await ui.find({ text: /fills in once a turn runs/ })).toBeDefined()
    await ui.press({ key: 'tab-board' })
    await ui.unmount()
  }
})

test('an edit lands once in the Changes tab', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('tool.call', () => ({ result: {}, text: 'edited' }) as never)
  await $.tool.call({ file_path: '/repo/src/app.ts', new_string: 'a\nb\nc', old_string: 'a', tool: 'Edit' } as never)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-changes' })
  expect(await ui.find({ text: /1 files/ })).toBeDefined()
  expect(await ui.find({ text: 'app.ts' })).toBeDefined()
  expect(await ui.find({ text: /lazygit off/ })).toBeDefined()
  await ui.unmount()
})

const band = (surface: (typeof SURFACES)[number]) => ({
  component: 'AbovePrompt' as const,
  plugin: 'vistack',
  props: {
    bodyColumns: 60,
    hasSurvey: false,
    isWorking: false,
    maxRows: 30,
    scroll: { bodyRows: 30, offset: 0 },
    view: {},
  },
  surface,
})

test('the org chart seats You, the coordinator and the advisor under a header naming the project', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))

    expect(await ui.find({ text: /📦/ })).toBeDefined()
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ text: /You · Owner/ })).toBeDefined()
    expect(await ui.find({ key: 'sel-coordinator' })).toBeDefined()
    expect(await ui.find({ key: 'sel-advisor' })).toBeDefined()
    expect(await ui.find({ text: /delegates only/ })).toBeDefined()
    expect(await ui.find({ text: /No one hired yet/ })).toBeDefined()
    await ui.press({ key: 'tab-board' })
    await ui.unmount()
  }
})

test('a spawned agent joins its department and its actions take a second press', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('agent.spawn', () => ({ agentId: 'a1', model: 'x' }))
  await $.agent.spawn({ description: 'map the call sites', prompt: 'Map every call site.', subagentType: 'Explore' } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))

    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ text: /Research/ })).toBeDefined()
    expect(await ui.find({ text: /dispatch: map the call sites/ })).toBeDefined()
    expect(await ui.find({ key: 'kill-a1' })).toBeUndefined()
    await ui.press({ key: 'sel-a1' })
    expect(await ui.find({ key: 'reload-a1' })).toBeDefined()
    expect(await ui.find({ key: 'hire-a1' })).toBeDefined()
    await ui.press({ key: 'kill-a1' })
    expect(await ui.find({ text: /press k again to stop/ })).toBeDefined()
    await ui.press({ key: 'ask-a1' })
    expect(await ui.find({ text: /press k again/ })).toBeUndefined()
    expect(await ui.find({ key: 'ask-input-a1' })).toBeDefined()
    await ui.press({ key: 'sel-a1' })
    await ui.press({ key: 'tab-board' })
    await ui.unmount()
  }
})

test('the settings tab switches the theme and saves it', async ($, on) => {
  const saved: unknown[] = []

  mock.clock(on, { now: 1_000 })
  on('store.set', (_engine, e) => {
    saved.push(e.value)

    return { value: undefined }
  })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))

    await ui.press({ key: 'tab-settings' })
    expect(await ui.find({ text: /Top and left placement are not available/ })).toBeDefined()
    await ui.select({ key: 'set-theme', value: 'nord' })
    expect(await ui.find({ text: /Theme preview · Nord/ })).toBeDefined()
    expect(saved[saved.length - 1]).toEqual({ icons: 'emoji', isAnimated: true, placement: 'right', theme: 'nord' })
    await ui.press({ key: 'set-reset' })
    expect(await ui.find({ text: /Theme preview · Aurora/ })).toBeDefined()
    await ui.press({ key: 'tab-board' })
    await ui.unmount()
  }
})

test('placing the deck at the bottom draws it in the band above the prompt', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.render', { component: 'AbovePrompt' }, (engine, e) => {
    const { Text } = engine.ui.resolve(e)

    return <Text>engine band</Text>
  })
  for (const surface of SURFACES) {
    const before = await $.ui.mount(band(surface))

    expect(await before.find({ text: 'engine band' })).toBeDefined()
    expect(await before.find({ key: 'tab-board' })).toBeUndefined()
    await before.unmount()

    const ui = await $.ui.mount(pane(surface))

    await ui.press({ key: 'tab-settings' })
    await ui.select({ key: 'set-placement', value: 'bottom' })
    await ui.unmount()

    const shown = await $.ui.mount(band(surface))

    expect(await shown.find({ text: /📦/ })).toBeDefined()
    expect(await shown.find({ key: 'tab-settings' })).toBeDefined()
    await shown.press({ key: 'tab-settings' })
    await shown.select({ key: 'set-placement', value: 'right' })
    expect(await shown.find({ text: 'engine band' })).toBeDefined()
    await shown.unmount()
  }
})

const SEARCH = JSON.stringify({
  data: {
    search: {
      nodes: [
        { headRefName: 'feat/x', isDraft: true, number: 12, repository: { nameWithOwner: 'acme/app' }, title: 'Add x', url: 'u1' },
        { headRefName: 'fix/y', isDraft: false, number: 7, repository: { nameWithOwner: 'acme/api' }, title: 'Fix y', url: 'u2' },
      ],
    },
  },
})

test('with the realm saved in the deck, the board lists open PRs across the realm and refreshes after gh pr create', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const runs: string[][] = []

  mock.store(on, { deckRealm: 'github.com/acme' })
  mock.env(on, { HOME: '/home/me' })
  on('process.run', (_engine, e) => {
    runs.push([...e.argv])

    return { value: { exitCode: 0, isStderrTruncated: false, isStdoutTruncated: false, stderr: '', stdout: SEARCH } }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }) as never)
  on('session.start', (_engine, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'deck' } }))
  await $.session.start({ cwd: '/work', isInteractive: false, surface: null })
  await clock.advance(300)

  const searches = () => runs.filter(argv => argv.slice(0, 3).join(' ') === 'gh api graphql')

  expect(searches()).toHaveLength(1)
  expect(searches()[0]?.at(-1)).toBe('q=is:pr is:open author:@me user:acme archived:false')

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /acme\/app \(1\)/ })).toBeDefined()
  expect(await ui.find({ key: 'pr-acme/app-12-open' })).toBeDefined()
  expect(await ui.find({ key: 'pr-acme/api-7-open' })).toBeDefined()
  await $.tool.call({ command: 'gh pr create --draft --title y', tool: 'Bash' } as never)
  await clock.advance(300)
  expect(searches()).toHaveLength(2)
  await $.tool.call({ command: 'gh pr review 12 --repo acme/app --comment -b "looks good"', tool: 'Bash' } as never)
  await clock.advance(300)
  expect(searches()).toHaveLength(3)
  expect(await ui.find({ text: /review posted/ })).toBeDefined()
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ text: /github\.com\/acme \(deck\)/ })).toBeDefined()
  await ui.unmount()
})

test('without a realm the board says where to set it, and saving one there persists it', async ($, on) => {
  const saved: Record<string, unknown> = {}

  mock.clock(on, { now: 1_000 })
  on('store.set', (_engine, e) => {
    saved[e.key] = e.value

    return { value: undefined }
  })

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /Set your Git realm in Settings \(9\) to list PRs/ })).toBeDefined()
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ text: /unset \(unset\)/ })).toBeDefined()
  await ui.input({ key: 'set-realm', text: ' github.com/acme ' })
  expect(saved.deckRealm).toBe('github.com/acme')
  expect(saved.deckSettings).toEqual({ icons: 'emoji', isAnimated: true, placement: 'right', theme: 'aurora' })
  expect(await ui.find({ text: /github\.com\/acme \(deck\)/ })).toBeDefined()
  await ui.press({ key: 'set-reset' })
  expect(await ui.find({ text: /github\.com\/acme \(deck\)/ })).toBeDefined()
  await ui.input({ key: 'set-realm', text: '' })
  expect(saved.deckRealm).toBe('')
  await ui.unmount()
})

test('a second press of kill stops the agent through TaskStop', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const stopped: string[] = []

  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  on('agent.spawn', () => ({ agentId: 'a1', model: 'x' }))
  on('tool.call', (_engine, e) => {
    stopped.push(String((e as { task_id?: string }).task_id))

    return { result: {}, text: 'stopped' } as never
  })
  on('session.start', (_engine, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'deck' } }))
  await $.session.start({ cwd: '/work', isInteractive: false, surface: null })
  await $.agent.spawn({ description: 'map the call sites', prompt: 'Map every call site.', subagentType: 'Explore' } as never)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'sel-a1' })
  await ui.press({ key: 'kill-a1' })
  await clock.advance(300)
  expect(stopped).toEqual([])
  await ui.press({ key: 'kill-a1' })
  await clock.advance(300)
  expect(stopped).toEqual(['a1'])
  expect(await ui.find({ text: /action: stop/ })).toBeDefined()
  expect(await ui.find({ text: /· 0 tools/ })).toBeDefined()
  await ui.unmount()
})

const WATCH = { command: 'tail -f deploy.log', description: 'watch the deploy', timeout_ms: 600_000, tool: 'Monitor' }
const SHELL = { command: 'npm run dev', description: 'dev server', run_in_background: true, tool: 'Bash' }
const CRON = { cron: '*/5 * * * *', prompt: 'check CI', recurring: true, tool: 'CronCreate' }

// The engine's side of every tool call these tests make; `seen` records the stops and cancels.
const tools = (on: On, seen: Record<string, unknown>[]) =>
  on('tool.call', (_engine, e) => {
    const call = e as unknown as Record<string, unknown>

    switch (call.tool) {
      case 'Monitor':
        return { result: { taskId: 'm1', timeoutMs: call.timeout_ms }, text: 'watching' } as never
      case 'Bash':
        return { result: { backgroundTaskId: 'b1', interrupted: false, stderr: '', stdout: '' }, text: 'started' } as never
      case 'CronCreate':
        return { result: { humanSchedule: 'every 5 minutes', id: 'c1', recurring: true }, text: 'scheduled' } as never
      case 'CronList':
        return { result: { jobs: [] }, text: 'No scheduled jobs.' } as never
      default:
        seen.push({ id: call.id, task_id: call.task_id, tool: call.tool })

        return { result: {}, text: 'done' } as never
    }
  })

type Child = { argv: string[]; isEnded: boolean }

type Host = { children?: Child[]; exitCode?: number; stored?: Record<string, unknown> }

// The host beneath the deck: `uname -s` reads Darwin, and a spawned child lives until the deck lets it
// go, or exits at once with `exitCode`.
const host = (on: On, children: Child[], exitCode: number | undefined) => {
  on('process.run', (_engine, e) => ({
    value: { exitCode: 0, isStderrTruncated: false, isStdoutTruncated: false, stderr: '', stdout: e.argv.join(' ') === 'uname -s' ? 'Darwin\n' : '' },
  }))
  on('process.spawn', async function* (_engine, e, next) {
    const child = { argv: [...e.argv], isEnded: false }

    children.push(child)
    if (exitCode === undefined) {
      await new Promise<void>(resolve => (next.signal.aborted ? resolve() : next.signal.addEventListener('abort', () => resolve())))
    }
    child.isEnded = true

    return { value: exitCode === undefined ? { code: null, signal: 'SIGTERM' } : { code: exitCode, signal: null } }
  })
}

// Starts the session so the deck's timers run; resolves to the descriptions it registered. Keep-awake
// is off unless `stored` says otherwise: a held child slows every step of the mocked clock.
const startSession = async ($: Engine, on: On, { children = [], exitCode, stored = { deckKeepAwake: 'off' } }: Host = {}): Promise<string[]> => {
  const described: string[] = []

  mock.store(on, stored)
  host(on, children, exitCode)
  mock.env(on, { HOME: '/home/me' })
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_engine, e) => ({ cwd: e.cwd }))
  on('command.register', (_engine, e) => {
    described.push(e.description)

    return { value: { command: 'deck' } }
  })
  on('prompt.submit', (_engine, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/work', isInteractive: false, surface: null })

  return described
}

const note = (taskId: string, status: string) =>
  `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n<summary>ended</summary>\n</task-notification>`

test("a Monitor call shows a running row in the Board's Monitors section, and /deck names every tab", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })

  tools(on, [])

  const [description = ''] = await startSession($, on)

  expect(description).toContain('Board, Agents, Cost, Session, Changes, Timeline, Flow, Recall, Settings')
  await $.tool.call(WATCH as never)
  await clock.advance(300)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))

    expect(await ui.find({ text: /1 running · 0 active/ })).toBeDefined()
    expect(await ui.find({ key: 'sel-mon-m1' })).toBeDefined()
    expect(await ui.find({ text: /^ running $/ })).toBeDefined()
    await ui.unmount()
  }
})

test('two presses of Stop call TaskStop through the deck and the row reads stopped', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const seen: Record<string, unknown>[] = []

  tools(on, seen)
  await startSession($, on)
  await $.tool.call(WATCH as never)
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'sel-mon-m1' })
  await ui.press({ key: 'mon-stop-m1' })
  await clock.advance(300)
  expect(seen).toEqual([])
  expect(await ui.find({ text: /press s again to stop watch the deploy/ })).toBeDefined()
  await ui.press({ key: 'mon-stop-m1' })
  await clock.advance(300)
  expect(seen).toEqual([{ id: undefined, task_id: 'm1', tool: 'TaskStop' }])
  expect(await ui.find({ text: /^ stopped $/ })).toBeDefined()
  expect(await ui.find({ text: /0 running · 0 active/ })).toBeDefined()
  await ui.unmount()
})

test('two presses of Cancel on a cron row call CronDelete and the row reads canceled', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const seen: Record<string, unknown>[] = []

  tools(on, seen)
  await startSession($, on)
  await $.tool.call(CRON as never)
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /0 running · 1 active/ })).toBeDefined()
  await ui.press({ key: 'sel-mon-c1' })
  await ui.press({ key: 'mon-cancel-c1' })
  await clock.advance(300)
  expect(seen).toEqual([])
  await ui.press({ key: 'mon-cancel-c1' })
  await clock.advance(300)
  expect(seen).toEqual([{ id: 'c1', task_id: undefined, tool: 'CronDelete' }])
  expect(await ui.find({ text: /^ canceled $/ })).toBeDefined()
  await ui.unmount()
})

test('Refresh asks CronList: a refused answer changes nothing, and a cron missing from a listed one is done', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  let isListRefused = true

  on('tool.call', (_engine, e) => {
    if ((e as unknown as { tool: string }).tool === 'CronCreate') {
      return { result: { humanSchedule: 'every 5 minutes', id: 'c1', recurring: true }, text: 'scheduled' } as never
    }

    return (isListRefused ? { deny: 'not now' } : { result: { jobs: [] }, text: 'No scheduled jobs.' }) as never
  })
  await startSession($, on)
  await $.tool.call(CRON as never)
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'mon-refresh' })
  await clock.advance(300)
  expect(await ui.find({ text: /0 running · 1 active/ })).toBeDefined()
  isListRefused = false
  await ui.press({ key: 'mon-refresh' })
  await clock.advance(300)
  expect(await ui.find({ text: /0 running · 0 active/ })).toBeDefined()
  expect(await ui.find({ text: /^ done $/ })).toBeDefined()
  await ui.unmount()
})

test("the model's TaskStop ends a row only when the stop succeeded", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  let isRefused = true

  on('tool.call', (_engine, e) => {
    if ((e as unknown as { tool: string }).tool === 'Monitor') {
      return { result: { taskId: 'm1', timeoutMs: 600_000 }, text: 'watching' } as never
    }

    return (isRefused ? { isError: true, result: {}, text: 'No task found' } : { result: { task_id: 'm1' }, text: 'stopped' }) as never
  })
  await startSession($, on)
  await $.tool.call(WATCH as never)
  await $.tool.call({ task_id: 'm1', tool: 'TaskStop' } as never)
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /1 running · 0 active/ })).toBeDefined()
  isRefused = false
  await $.tool.call({ task_id: 'm1', tool: 'TaskStop' } as never)
  await clock.advance(300)
  expect(await ui.find({ text: /^ stopped $/ })).toBeDefined()
  await ui.unmount()
})

test('a task notification ends its running row with the mapped state and enters unchanged', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })

  tools(on, [])
  await startSession($, on)
  await $.tool.call(SHELL as never)

  const text = note('b1', 'failed')
  const entered = await $.prompt.submit({ origin: { kind: 'task-notification' }, text, wait: false })

  expect(entered).toEqual({ text })
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /^ dead $/ })).toBeDefined()
  expect(await ui.find({ text: /0 running · 0 active/ })).toBeDefined()
  await ui.unmount()
})

test("a notification row's task ends its running row, and the row draws as the engine drew it", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })

  tools(on, [])
  on('ui.render', { component: 'UserMessage' }, (engine, e) => {
    const { Text } = engine.ui.resolve(e)

    return <Text>engine row</Text>
  })
  await startSession($, on)
  await $.tool.call(SHELL as never)
  await clock.advance(300)

  const row = await $.ui.mount({
    component: 'UserMessage',
    plugin: 'vistack',
    props: { isExpanded: false, origin: { kind: 'task-notification' }, task: { id: 'b1', status: 'completed' }, text: 'dev server ended' },
    surface: 'terminal',
  })

  expect(await row.find({ text: 'engine row' })).toBeDefined()
  await row.unmount()
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /^ done $/ })).toBeDefined()
  expect(await ui.find({ text: /0 running · 0 active/ })).toBeDefined()
  await ui.unmount()
})

test('a task with no end report and no deadline stays running, while a watch past its deadline ends', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })

  tools(on, [])
  await startSession($, on)
  await $.tool.call(SHELL as never)
  await $.tool.call({ ...WATCH, timeout_ms: 30_000 } as never)
  await clock.advance(160_000)

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /1 running · 0 active/ })).toBeDefined()
  expect(await ui.find({ key: 'sel-mon-b1' })).toBeDefined()
  expect(await ui.find({ text: /no end report seen/ })).toBeDefined()
  await clock.advance(60_000)
  expect(await ui.find({ text: /1 running · 0 active/ })).toBeDefined()
  await ui.unmount()
})

test("a shell a synchronous subagent started ends with that agent, and the main session's keeps running", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })

  on('agent.spawn', () => ({ agentId: 'a1', model: 'x' }))
  on('tool.call', (_engine, e) => {
    const isOwned = (e as unknown as { agentId?: string }).agentId === 'a1'
    const result = isOwned ? { backgroundEndsWithFinalResponse: true, backgroundTaskId: 'b2' } : { backgroundTaskId: 'b1' }

    return { result: { ...result, interrupted: false, stderr: '', stdout: '' }, text: 'started' } as never
  })
  on('turn.complete', () => ({ text: '' }))
  await startSession($, on)
  await $.agent.spawn({ description: 'run the tests', prompt: 'Run the tests.', subagentType: 'general-purpose' } as never)
  await $.tool.call(SHELL as never)
  await $.tool.call({ agentId: 'a1', command: 'npm test', description: 'tests', run_in_background: true, tool: 'Bash' } as never)
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /2 running · 0 active/ })).toBeDefined()
  await $.turn.complete({ agentId: 'a1', answer: 'all green', durationMs: 5, isAborted: false, reason: 'answer', turnId: 't1' })
  await clock.advance(2_000)
  expect(await ui.find({ text: /1 running · 0 active/ })).toBeDefined()
  expect(await ui.find({ text: /npm test · ended with its agent/ })).toBeDefined()
  await ui.unmount()
})

test('a Stop snapshot that no longer lists a shell ends it once the grace has passed', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })

  tools(on, [])
  on('classic.Stop', () => ({}))
  await startSession($, on)
  await $.tool.call(SHELL as never)
  await clock.advance(300)
  await $.classic.Stop({ background_tasks: [], session_crons: [], stop_hook_active: false })
  await clock.advance(60_000)

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /1 running · 0 active/ })).toBeDefined()
  await clock.advance(90_000)
  expect(await ui.find({ text: /0 running · 0 active/ })).toBeDefined()
  expect(await ui.find({ text: /no end report seen/ })).toBeDefined()
  await ui.unmount()
})

test('New loop Run starts /loop with the interval and the prompt, then clears the prompt', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const loops: unknown[] = []

  tools(on, [])
  on('command.run', { command: 'loop' }, (_engine, e) => {
    loops.push({ args: e.args, origin: e.origin })

    return { text: '' }
  })
  await startSession($, on)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.select({ key: 'mon-loop-interval', value: '10m' })
  await ui.input({ key: 'mon-loop-prompt', kind: 'change', text: '/babysit x' })
  await ui.press({ key: 'mon-loop-run' })
  await clock.advance(300)
  expect(loops).toEqual([{ args: '10m /babysit x', origin: { kind: 'plugin', name: 'vistack' } }])
  expect((await ui.find({ key: 'mon-loop-prompt' }))?.props.value).toBe('')
  expect((await ui.find({ key: 'mon-loop-interval' }))?.props.value).toBe('10m')
  await ui.unmount()
})

test('two presses of Relaunch on an ended shell start it again in the background as a new running row', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const shells: unknown[] = []

  on('tool.call', (_engine, e) => {
    const call = e as unknown as Record<string, unknown>

    shells.push({ command: call.command, description: call.description, run_in_background: call.run_in_background })

    return { result: { backgroundTaskId: `b${shells.length}`, interrupted: false, stderr: '', stdout: '' }, text: 'started' } as never
  })
  await startSession($, on)
  await $.tool.call(SHELL as never)
  await $.prompt.submit({ origin: { kind: 'task-notification' }, text: note('b1', 'completed'), wait: false })
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'sel-mon-b1' })
  await ui.press({ key: 'mon-relaunch-b1' })
  await clock.advance(300)
  expect(shells).toHaveLength(1)
  expect(await ui.find({ text: /press l again to relaunch dev server/ })).toBeDefined()
  await ui.press({ key: 'mon-relaunch-b1' })
  // One drain runs the relaunch, the next applies the row it queued.
  await clock.advance(600)
  expect(shells[1]).toEqual({ command: 'npm run dev', description: 'dev server', run_in_background: true })
  expect(await ui.find({ key: 'sel-mon-b2' })).toBeDefined()
  expect(await ui.find({ text: /1 running · 0 active/ })).toBeDefined()
  await ui.unmount()
})

test('an ended wakeup with no recorded prompt shows why it cannot relaunch and offers no button', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const seen: Record<string, unknown>[] = []

  tools(on, seen)
  await startSession($, on)
  await $.tool.call({ delaySeconds: 600, prompt: '<<autonomous-loop-dynamic>>', reason: 'check later', tool: 'ScheduleWakeup' } as never)
  await $.tool.call({ stop: true, tool: 'ScheduleWakeup' } as never)
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'sel-mon-wakeup:601000' })
  expect(await ui.find({ text: /Relaunch: a \/loop wakeup whose prompt/ })).toBeDefined()
  expect(await ui.find({ key: 'mon-relaunch-wakeup:601000' })).toBeUndefined()
  expect(seen).toHaveLength(2)
  await ui.unmount()
})

test('a typed /loop ties its recipe to the cron its turn made, and Relaunch runs the same /loop', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const loops: string[] = []
  let listed: unknown[] = []

  on('tool.call', (_engine, e) =>
    ((e as unknown as { tool: string }).tool === 'CronList' ? { result: { jobs: listed }, text: '' } : { result: {}, text: 'done' }) as never,
  )
  on('command.run', { command: 'loop' }, (_engine, e) => {
    loops.push(e.args)

    return { text: '' }
  })
  on('turn.start', (_engine, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await startSession($, on)
  await $.command.run({ args: '10m /babysit x', command: 'loop', origin: { kind: 'composer' }, presentation: { columns: 80, isFullscreen: false } })
  await $.turn.start({ text: 'the loop skill', turnId: 't1' })
  listed = [{ cron: '*/10 * * * *', id: 'c9', prompt: '/babysit x', recurring: true }]

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'mon-refresh' })
  await clock.advance(300)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, reason: 'answer', turnId: 't1' })
  await clock.advance(300)
  listed = []
  await ui.press({ key: 'sel-mon-c9' })
  await ui.press({ key: 'mon-cancel-c9' })
  await ui.press({ key: 'mon-cancel-c9' })
  await clock.advance(300)
  expect(await ui.find({ text: /^ canceled $/ })).toBeDefined()
  await ui.press({ key: 'mon-relaunch-c9' })
  await ui.press({ key: 'mon-relaunch-c9' })
  await clock.advance(300)
  expect(loops).toEqual(['10m /babysit x', '10m /babysit x'])
  await ui.unmount()
})

test('keep-awake Always holds caffeinate -dims on Darwin and Off lets it go', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const children: Child[] = []

  tools(on, [])
  await startSession($, on, { children })
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  expect(children).toEqual([])
  expect(await ui.find({ text: /normal sleep \(keep-awake off\)/ })).toBeDefined()
  await ui.select({ key: 'mon-keep-awake', value: 'always' })
  await clock.advance(300)
  expect(children).toEqual([{ argv: ['caffeinate', '-dims'], isEnded: false }])
  expect(await ui.find({ text: /awake \(caffeinate\)/ })).toBeDefined()
  await ui.select({ key: 'mon-keep-awake', value: 'off' })
  await clock.advance(300)
  expect(children).toEqual([{ argv: ['caffeinate', '-dims'], isEnded: true }])
  expect(await ui.find({ text: /normal sleep \(keep-awake off\)/ })).toBeDefined()
  await ui.unmount()
})

test('keep-awake While working holds the lock while a monitor runs and lets it go after the linger', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const children: Child[] = []

  tools(on, [])
  await startSession($, on, { children, stored: { deckKeepAwake: 'while-working' } })
  await $.tool.call(WATCH as never)
  await clock.advance(300)
  expect(children).toEqual([{ argv: ['caffeinate', '-dims'], isEnded: false }])
  await $.prompt.submit({ origin: { kind: 'task-notification' }, text: note('m1', 'completed'), wait: false })
  await clock.advance(60_000)
  expect(children[0]?.isEnded).toBe(false)
  await clock.advance(61_000)
  expect(children).toEqual([{ argv: ['caffeinate', '-dims'], isEnded: true }])
})

test('a saved keep-awake choice holds the lock from the start, and the session end lets it go', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const children: Child[] = []

  tools(on, [])
  on('session.end', (_engine, e) => ({ sessionId: e.sessionId }))
  await startSession($, on, { children, stored: { deckKeepAwake: 'always' } })
  await clock.advance(300)
  expect(children).toEqual([{ argv: ['caffeinate', '-dims'], isEnded: false }])
  await $.session.end({ reason: 'clear', resume: { id: 's1' }, sessionId: 's1' } as never)
  expect(children).toEqual([{ argv: ['caffeinate', '-dims'], isEnded: true }])

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /awake \(caffeinate\)/ })).toBeUndefined()
  await ui.unmount()
})

test('a lock child that exits on its own shows why and starts again only after the setting changes', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const children: Child[] = []

  tools(on, [])
  await startSession($, on, { children, exitCode: 1, stored: { deckKeepAwake: 'always' } })
  await clock.advance(3000)

  const ui = await $.ui.mount(pane('terminal'))

  expect(children).toHaveLength(1)
  expect(await ui.find({ text: /caffeinate ended \(exit 1\)/ })).toBeDefined()
  await ui.select({ key: 'mon-keep-awake', value: 'off' })
  await ui.select({ key: 'mon-keep-awake', value: 'always' })
  await clock.advance(300)
  expect(children).toHaveLength(2)
  await ui.unmount()
})

const FABLE = 'claude-fable-5-1'

const usageOf = (model: string, input: number, output: number) => ({
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  input_tokens: input,
  model,
  output_tokens: output,
})

test('an advisor call in the stream stays open past a change of chunk kind and ends with its step', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })

  on('turn.step', async function* (_engine, e) {
    yield { id: 'v1', index: 0, kind: 'tool' as const, name: 'advisor' }
    yield { index: 1, kind: 'text' as const, text: 'Done.' }

    return {
      answer: 'Done.',
      index: e.index,
      stopReason: 'end_turn' as const,
      toolUses: [],
      turnId: e.turnId,
      usage: usageOf('claude-opus-5-5', 1200, 0),
    }
  })

  const ui = await $.ui.mount(pane('terminal'))
  const kinds: string[] = []
  const gaps = [2_000, 3_000]
  const stream = $.turn.step({ index: 0, messageCount: 1, model: 'claude-opus-5-5', turnId: 't1' })

  await ui.press({ key: 'tab-agents' })

  let item = await stream.next()

  while (item.done !== true) {
    kinds.push(item.value.kind)
    if (item.value.kind === 'text') {
      expect(await ui.find({ text: /advising/ })).toBeDefined()
    }
    await clock.advance(gaps[kinds.length - 1] ?? 0)
    item = await stream.next()
  }
  expect(kinds).toEqual(['tool', 'text'])
  expect(item.value.answer).toBe('Done.')
  expect(await ui.find({ text: /consults 1/ })).toBeDefined()
  expect(await ui.find({ text: /took 5\.0s/ })).toBeDefined()
  expect(await ui.find({ text: /on call/ })).toBeDefined()
  await ui.press({ key: 'tab-board' })
  expect(await ui.find({ text: '1.2k' })).toBeDefined()
  await ui.unmount()
})

// Synthesized in a transcript's shape, every value invented. Each row of a response repeats its
// usage, which holds the advisor's tokens in an `advisor_message` iteration.
const advisorRows = (id: string, startedAt: number, endedAt: number): string => {
  const iteration = (type: string, input: number, output: number, model?: string) => ({
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    input_tokens: input,
    output_tokens: output,
    type,
    ...(model === undefined ? {} : { model }),
  })
  const usage = {
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    input_tokens: 4,
    iterations: [iteration('message', 2, 100), iteration('advisor_message', 100_000, 4_000, FABLE), iteration('message', 2, 200)],
    output_tokens: 300,
  }
  const row = (at: number, block: object) =>
    JSON.stringify({
      message: { content: [block], id: 'msg_1', model: 'claude-opus-5-5', role: 'assistant', type: 'message', usage },
      timestamp: new Date(at).toISOString(),
      type: 'assistant',
    })

  return [
    row(startedAt, { id, input: {}, name: 'advisor', type: 'server_tool_use' }),
    row(endedAt, { content: { encrypted_content: 'FIXTURE', type: 'advisor_redacted_result' }, tool_use_id: id, type: 'advisor_tool_result' }),
  ].join('\n')
}

const API_CONSULT = [
  {
    content: [
      { id: 'srvtoolu_1', input: {}, name: 'advisor', type: 'server_tool_use' },
      { content: { encrypted_content: 'FIXTURE', type: 'advisor_redacted_result' }, tool_use_id: 'srvtoolu_1', type: 'advisor_tool_result' },
      { text: 'Plan set.', type: 'text' },
    ],
    role: 'assistant',
  },
]

// A started session whose first main request runs from 1 s to 9 s and consults the advisor from 2 s
// to 7 s. The transcript grep prints `transcript`; resolves to every argv the deck ran.
const consultTurn = async ($: Engine, on: On, clock: MockClock, transcript: string): Promise<string[][]> => {
  const ran: string[][] = []

  mock.store(on, { deckKeepAwake: 'off' })
  mock.env(on, { HOME: '/home/me' })
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_engine, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'deck' } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.messages', (_engine, e) => ({ value: (e.as === 'api' ? API_CONSULT : []) as never }))
  on('process.run', (_engine, e) => {
    ran.push([...e.argv])

    return {
      value: { exitCode: 0, isStderrTruncated: false, isStdoutTruncated: false, stderr: '', stdout: e.argv[0] === 'sh' ? transcript : '' },
    }
  })
  on('turn.start', (_engine, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_engine, e) {
    yield { index: 0, kind: 'thinking' as const, text: '' }
    yield { index: 1, kind: 'text' as const, text: 'Plan set.' }

    return {
      answer: 'Plan set.',
      index: e.index,
      serverToolUses: [{ endedAt: 7_000, id: 'srvtoolu_1', input: {}, name: 'advisor', startedAt: 2_000 }],
      stopReason: 'end_turn' as const,
      toolUses: [],
      turnId: e.turnId,
      usage: usageOf('claude-opus-5-5', 1200, 50),
    }
  })
  await $.session.start({ cwd: '/work', isInteractive: false, surface: null })
  await $.turn.start({ text: 'plan the change', turnId: 't1' })

  const stream = $.turn.step({ index: 0, messageCount: 1, model: 'claude-opus-5-5', turnId: 't1' })
  let item = await stream.next()

  while (item.done !== true) {
    await clock.set(9_000)
    item = await stream.next()
  }

  return ran
}

const endTurn = async ($: Engine, clock: MockClock): Promise<void> => {
  await clock.set(11_000)
  await $.turn.complete({ answer: 'Plan set.', durationMs: 10_000, isAborted: false, reason: 'answer', turnId: 't1' })
  await clock.advance(600)
}

test('a server consult shows on the seat when its step ends, prices Fable on Cost, and leaves Timeline model time alone', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const ran = await consultTurn($, on, clock, advisorRows('srvtoolu_1', 2_000, 7_000))
  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ text: /consults 1/ })).toBeDefined()
  expect(await ui.find({ text: /^took 5\.0s$/ })).toBeDefined()
  await endTurn($, clock)
  expect(await ui.find({ text: /Fable 5\.1 · 100k\/4\.0k tok · \$1\.20 · took 5\.0s/ })).toBeDefined()
  expect(await ui.find({ text: /advice redacted/ })).toBeDefined()
  expect(await ui.find({ text: /on call/ })).toBeDefined()
  expect(ran.find(argv => argv[0] === 'sh')?.slice(3)).toEqual(['sh', 'sess-1'])
  await ui.press({ key: 'tab-cost' })
  expect(await ui.find({ text: /^Fable 5\.1/ })).toBeDefined()
  expect(await ui.find({ text: /\$1\.20/ })).toBeDefined()
  await ui.press({ key: 'tab-timeline' })
  expect(await ui.find({ text: /8\.0s 80%/ })).toBeDefined()
  await ui.press({ key: 'tab-board' })
  await ui.unmount()
})

test('with no transcript to read, a server consult still shows its result and time, unpriced', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })

  await consultTurn($, on, clock, '')
  await endTurn($, clock)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ text: /^took 5\.0s$/ })).toBeDefined()
  expect(await ui.find({ text: /advice redacted/ })).toBeDefined()
  await ui.press({ key: 'tab-cost' })
  expect(await ui.find({ text: /Fable/ })).toBeUndefined()
  await ui.press({ key: 'tab-board' })
  await ui.unmount()
})

test('a fallback advisor agent seats a consult while it runs and ends it with its model, tokens and cost, counted once', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })

  on('agent.spawn', () => ({ agentId: 'adv1', model: FABLE }))
  on('session.messages', (_engine, e) => ({ value: (e.as === 'api' ? API_CONSULT : []) as never }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_engine, e) {
    yield { index: 0, kind: 'text' as const, text: 'Ship it.' }

    return { answer: 'Ship it.', index: e.index, stopReason: 'end_turn' as const, toolUses: [], turnId: e.turnId, usage: usageOf(FABLE, 3_000, 400) }
  })
  await startSession($, on)
  await $.agent.spawn({ description: 'review the plan', prompt: 'Review the plan.', subagentType: 'vistack:advisor' } as never)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ text: /advising/ })).toBeDefined()

  const stream = $.turn.step({ agentId: 'adv1', index: 0, messageCount: 1, model: FABLE, turnId: 'a-t1' })
  let item = await stream.next()

  while (item.done !== true) {
    item = await stream.next()
  }
  await clock.set(5_000)
  await $.turn.complete({ agentId: 'adv1', answer: '\nShip it after the parser test.\nThen merge.', durationMs: 4_000, isAborted: false, reason: 'answer', turnId: 'a-t1' })
  expect(await ui.find({ text: /on call/ })).toBeDefined()
  expect(await ui.find({ text: /Fable 5\.1 · 3\.0k\/400 tok · \$0\.05 · took 4\.0s/ })).toBeDefined()
  expect(await ui.find({ text: /Ship it after the parser test\./ })).toBeDefined()
  // The main turn's end reads a server consult back and prices the consults again; the agent's must
  // not count twice.
  await $.turn.complete({ answer: '', durationMs: 4_000, isAborted: false, reason: 'answer', turnId: 't1' })
  await clock.advance(600)
  expect(await ui.find({ text: /consults 2/ })).toBeDefined()
  await ui.press({ key: 'tab-cost' })
  expect(await ui.find({ text: /\$0\.05/ })).toBeDefined()
  expect(await ui.find({ text: /\$0\.10/ })).toBeUndefined()
  await ui.press({ key: 'tab-board' })
  await ui.unmount()
})

const WATCH_NOW = Date.parse('2026-10-06T12:00:00Z')
const WATCH_DIR = '/home/me/.vistack/review-watch'
const LOOP_ARGS = '30m /vistack:review-watch pass --realm github.com/acme'
const WATCH_CRON = { cron: '*/30 * * * *', prompt: '/vistack:review-watch pass --realm github.com/acme', recurring: true, tool: 'CronCreate' }

const minutesAgo = (minutes: number): string => new Date(WATCH_NOW - minutes * 60_000).toISOString()

const watchFile = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  clean: [],
  enabled: true,
  enabledAt: minutesAgo(120),
  lastPassStartedAt: minutesAgo(50),
  needsYou: [],
  posted: [],
  realm: 'github.com/acme',
  version: 1,
  ...fields,
})

// The watch's state file (null: none) and each `watch-state.mjs off` exit code in turn. An off that
// exits 0 turns the file off, or with `isOnAgain` leaves it on as a fresh `on` would.
type WatchWorld = {
  file: Record<string, unknown> | null
  isInteractive?: boolean
  remote?: string
  offExits?: number[]
  isOnAgain?: boolean
  isOffCommandRefused?: boolean
}

type WatchSeen = { commands: string[]; deletes: string[]; offs: string[]; toasts: string[] }

const watchSession = async ($: Engine, on: On, world: WatchWorld): Promise<WatchSeen> => {
  const seen: WatchSeen = { commands: [], deletes: [], offs: [], toasts: [] }
  const crons = new Map<string, string>()
  const ran = (exitCode = 0, stderr = '') => ({ value: { exitCode, isStderrTruncated: false, isStdoutTruncated: false, stderr, stdout: '' } })
  let created = 0

  mock.store(on, { deckKeepAwake: 'off' })
  mock.env(on, { HOME: '/home/me' })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', (_engine, e) => {
    seen.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_engine, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'deck' } }))
  on('session.repo', () => ({ value: { internal: false, name: null, remote: world.remote ?? 'git@github.com:acme/app.git', root: '/work' } }))
  on('command.list', () => ({ value: [{ description: 'Review watch', name: 'vistack:review-watch', plugin: 'vistack', source: 'plugin' as const }] }))
  on('command.run', (_engine, e) => {
    seen.commands.push(`${e.command} ${e.args}`)
    if (world.isOffCommandRefused === true) {
      throw new Error('refused')
    }

    return { text: '' }
  })
  on('fs.read', (_engine, e) => (e.path === `${WATCH_DIR}/state.json` && world.file !== null ? { value: JSON.stringify(world.file) } : { deny: 'ENOENT' }))
  on('fs.stat', (_engine, e) =>
    e.path.endsWith('/skills/review-watch/scripts/watch-state.mjs') ? { value: { isLink: false, kind: 'file' as const, mtimeMs: 0, size: 1 } } : { deny: 'ENOENT' },
  )
  on('process.run', (_engine, e) => {
    const [, script = '', verb] = e.argv

    if (verb !== 'off') {
      return ran()
    }

    const exitCode = world.offExits?.shift() ?? 0

    seen.offs.push(`${script.split('/').slice(-4).join('/')} off ${e.init?.env?.VISTACK_REVIEW_WATCH_DIR}`)
    if (exitCode === 0 && world.file !== null) {
      world.file = world.isOnAgain === true ? { ...world.file, enabledAt: minutesAgo(0) } : { ...world.file, enabled: false }
    }

    return ran(exitCode, exitCode === 0 ? '' : 'watch-state: another writer holds state.json.lock; try again')
  })
  on('tool.call', (_engine, e) => {
    const call = e as unknown as Record<string, unknown>

    switch (call.tool) {
      case 'CronCreate': {
        created += 1
        crons.set(`c${created}`, String(call.prompt))

        return { result: { humanSchedule: 'every 30 minutes', id: `c${created}`, recurring: true }, text: 'scheduled' } as never
      }
      case 'CronList':
        return { result: { jobs: [...crons].map(([id, prompt]) => ({ cron: '*/30 * * * *', humanSchedule: 'every 30 minutes', id, prompt, recurring: true })) }, text: '' } as never
      case 'CronDelete':
        seen.deletes.push(String(call.id))
        crons.delete(String(call.id))

        return { result: { id: call.id }, text: 'deleted' } as never
      default:
        return { result: {}, text: 'done' } as never
    }
  })
  await $.session.start({ cwd: '/work', isInteractive: world.isInteractive ?? true, surface: null })

  return seen
}

const cancelWatchLoop = async ($: Engine, clock: MockClock) => {
  await $.tool.call(WATCH_CRON as never)
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'sel-mon-c1' })
  await ui.press({ key: 'mon-cancel-c1' })
  await ui.press({ key: 'mon-cancel-c1' })
  await clock.advance(300)

  return ui
}

test('an interactive session arms the watch loop once when no pass ran for 50 minutes, and the 5-minute sync arms nothing more', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: WATCH_NOW })
  const seen = await watchSession($, on, { file: watchFile() })

  await clock.advance(300)
  expect(seen.commands).toEqual([`loop ${LOOP_ARGS}`])

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /on · github\.com\/acme/ })).toBeDefined()
  expect(await ui.find({ text: /arming… · last pass 50m ago/ })).toBeDefined()
  expect(await ui.find({ text: /action: review watch arm/ })).toBeDefined()
  await ui.unmount()
  await clock.advance(5 * 60_000)
  expect(seen.commands).toEqual([`loop ${LOOP_ARGS}`])
})

const NO_ARM: readonly (readonly [string, Partial<WatchWorld>, RegExp?])[] = [
  ['a headless session', { isInteractive: false }],
  ['an off watch', { file: watchFile({ enabled: false }) }],
  ['a realm that is not host/owner', { file: watchFile({ realm: 'github.com/acme --force' }) }, /names no valid realm/],
  ['a pass 10 minutes ago', { file: watchFile({ lastPassStartedAt: minutesAgo(10) }) }],
  ['an origin outside the realm', { remote: 'git@github.com:other/app.git' }],
]

for (const [name, world, shown] of NO_ARM) {
  test(`${name} arms no watch loop`, async ($, on) => {
    const clock = mock.clock(on, { now: WATCH_NOW })
    const seen = await watchSession($, on, { file: watchFile(), ...world })

    await clock.advance(300)
    expect(seen.commands).toEqual([])
    if (shown !== undefined) {
      const ui = await $.ui.mount(pane('terminal'))

      expect(await ui.find({ text: shown })).toBeDefined()
      await ui.unmount()
    }
  })
}

test('with two watch loops open, the sync cancels the older through CronDelete and arms none', async ($, on) => {
  const clock = mock.clock(on, { now: WATCH_NOW })
  const seen = await watchSession($, on, { file: watchFile() })

  await $.tool.call(WATCH_CRON as never)
  await clock.advance(1000)
  await $.tool.call(WATCH_CRON as never)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'refresh' })
  await clock.advance(300)
  expect(seen.deletes).toEqual(['c1'])
  expect(seen.commands).toEqual([])
  expect(await ui.find({ text: /armed · rotates in 6d1\dh/ })).toBeDefined()
  await ui.unmount()
})

test('two presses of Cancel on the watch loop delete it and run watch-state.mjs off, and the deck arms nothing after', async ($, on) => {
  const clock = mock.clock(on, { now: WATCH_NOW })
  const seen = await watchSession($, on, { file: watchFile() })
  const ui = await cancelWatchLoop($, clock)

  expect(seen.deletes).toEqual(['c1'])
  expect(seen.offs).toEqual([`skills/review-watch/scripts/watch-state.mjs off ${WATCH_DIR}`])
  expect(seen.toasts).toContain('Review watch is off.')
  await ui.press({ key: 'refresh' })
  await clock.advance(300)
  expect(seen.commands).toEqual([])
  expect(await ui.find({ key: 'watch-off' })).toBeUndefined()
  await ui.unmount()
})

test('an off that keeps finding the lock held runs three times 2 s apart, then the command runs off, and nothing arms while it is pending', async ($, on) => {
  const clock = mock.clock(on, { now: WATCH_NOW })
  const seen = await watchSession($, on, { file: watchFile(), offExits: [1, 1, 1] })
  const ui = await cancelWatchLoop($, clock)

  expect(seen.offs).toHaveLength(1)
  await clock.advance(2000)
  expect(seen.offs).toHaveLength(2)
  await clock.advance(2000)
  expect(seen.offs).toHaveLength(3)
  expect(seen.commands).toEqual(['vistack:review-watch off'])
  await ui.press({ key: 'refresh' })
  await clock.advance(300)
  expect(seen.commands).toEqual(['vistack:review-watch off'])
  expect(await ui.find({ text: /turning off…/ })).toBeDefined()
  await ui.unmount()
})

test('Turn off takes two presses, and when the script and the command both fail the deck says so and stops waiting', async ($, on) => {
  const clock = mock.clock(on, { now: WATCH_NOW })
  const seen = await watchSession($, on, { file: watchFile({ lastPassStartedAt: minutesAgo(10) }), isOffCommandRefused: true, offExits: [2] })

  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'watch-off' })
  await clock.advance(300)
  expect(seen.offs).toEqual([])
  expect(await ui.find({ text: /press Turn off again/ })).toBeDefined()
  await ui.press({ key: 'watch-off' })
  await clock.advance(300)
  expect(seen.offs).toHaveLength(1)
  expect(seen.commands).toEqual(['vistack:review-watch off'])
  expect(seen.toasts.at(-1)).toMatch(/^Could not turn the review watch off: watch-state: .* Run \/vistack:review-watch off\.$/)
  expect(await ui.find({ key: 'watch-off' })).toBeDefined()
  await ui.unmount()
})

test('Stop all with a watch loop open turns the watch off, and an on right after it is not taken for a pending off', async ($, on) => {
  const clock = mock.clock(on, { now: WATCH_NOW })
  const seen = await watchSession($, on, { file: watchFile(), isOnAgain: true })

  await $.tool.call(WATCH_CRON as never)
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'mon-stop-all' })
  await ui.press({ key: 'mon-stop-all' })
  await clock.advance(600)
  expect(seen.deletes).toEqual(['c1'])
  expect(seen.offs).toHaveLength(1)
  expect(await ui.find({ text: /turning off…/ })).toBeUndefined()
  expect(await ui.find({ text: /not armed in this session/ })).toBeDefined()
  expect(seen.commands).toEqual([])
  await ui.unmount()
})

test('the Review watch block lists what needs you, the clean reviews and the last posts, and hides with no state file', async ($, on) => {
  const clock = mock.clock(on, { now: WATCH_NOW })
  const world: WatchWorld = {
    file: watchFile({
      clean: [{ at: minutesAgo(15), key: 'k2', pr: 'acme/web#43', title: 'Fix the parser', url: 'https://github.com/acme/web/pull/43' }],
      needsYou: [
        { at: minutesAgo(20), author: 'sam', excerpt: 'can you\u202e approve?\u0007', key: 'k1', pr: 'acme/web#42', reason: 'asks for an approval', url: 'https://github.com/acme/web/pull/42#c1' },
      ],
      posted: [{ at: minutesAgo(12), key: 'k3', kind: 'review', pr: 'acme/web#44', summary: '3 comments', url: 'https://github.com/acme/web/pull/44#r9' }],
    }),
    isInteractive: false,
  }

  await watchSession($, on, world)
  await clock.advance(300)

  const ui = await $.ui.mount(pane('terminal'))

  expect(await ui.find({ text: /needs you \(1\)/ })).toBeDefined()
  expect((await ui.find({ key: 'watch-need-0' }))?.text).toBe('acme/web#42 sam: can you approve?')
  expect(await ui.find({ text: /reviewed, nothing to flag, awaiting your approval \(1\)/ })).toBeDefined()
  expect((await ui.find({ key: 'watch-clean-0' }))?.text).toBe('acme/web#43 Fix the parser')
  expect((await ui.find({ key: 'watch-post-0' }))?.text).toBe('acme/web#44 review: 3 comments · 12m ago')
  await ui.press({ key: 'watch-need-0' })
  expect(await ui.find({ text: /asks for an approval · https:\/\/github\.com\/acme\/web\/pull\/42#c1/ })).toBeDefined()
  world.file = null
  await ui.press({ key: 'refresh' })
  await clock.advance(300)
  expect(await ui.find({ text: /Review watch/ })).toBeUndefined()
  await ui.unmount()
})

test('a fallback advisor agent the agent list shows ended stops advising, and a late turn.complete still adds its advice', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  let status = 'running'

  on('agent.spawn', () => ({ agentId: 'adv1', model: FABLE }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.list', () => ({ value: [{ description: 'review the plan', id: 'adv1', status, type: 'vistack:advisor' }] as never }))
  await startSession($, on)
  await $.agent.spawn({ description: 'review the plan', prompt: 'Review the plan.', subagentType: 'vistack:advisor' } as never)

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-agents' })
  await clock.advance(2_000)
  expect(await ui.find({ text: /advising/ })).toBeDefined()
  status = 'killed'
  await clock.advance(2_000)
  expect(await ui.find({ text: /advising/ })).toBeUndefined()
  expect(await ui.find({ text: /on call/ })).toBeDefined()
  await $.turn.complete({ agentId: 'adv1', answer: 'Ship it after the parser test.', durationMs: 4_000, isAborted: false, reason: 'answer', turnId: 'a-t1' })
  expect(await ui.find({ text: /Ship it after the parser test\./ })).toBeDefined()
  await ui.press({ key: 'tab-board' })
  await ui.unmount()
})
