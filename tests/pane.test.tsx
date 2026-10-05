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
