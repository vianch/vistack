import { expect, mock, test } from 'claude-code/testing'

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

test('an advisor tool call in the stream seats a consult and the step passes through unchanged', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('turn.step', async function* (_engine, e) {
    yield { id: 'v1', index: 0, kind: 'tool' as const, name: 'advisor' }
    yield { index: 1, kind: 'text' as const, text: 'Done.' }

    return {
      answer: 'Done.',
      index: e.index,
      stopReason: 'end_turn' as const,
      toolUses: [],
      turnId: e.turnId,
      usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 0, input_tokens: 1200, model: 'claude-opus-5-5', output_tokens: 0 },
    }
  })

  const kinds: string[] = []
  const stream = $.turn.step({ index: 0, messageCount: 1, model: 'claude-opus-5-5', turnId: 't1' })
  let item = await stream.next()

  while (item.done !== true) {
    kinds.push(item.value.kind)
    item = await stream.next()
  }
  expect(kinds).toEqual(['tool', 'text'])
  expect(item.value.answer).toBe('Done.')

  const ui = await $.ui.mount(pane('terminal'))

  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ text: /consults 1/ })).toBeDefined()
  expect(await ui.find({ text: /on call/ })).toBeDefined()
  await ui.press({ key: 'tab-board' })
  expect(await ui.find({ text: '1.2k' })).toBeDefined()
  await ui.unmount()
})
