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

test('the lower tabs each draw their key element on every surface', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))

    await ui.press({ key: 'tab-cost' })
    expect(await ui.find({ text: /engine total/ })).toBeDefined()
    expect(await ui.find({ text: /Per model/ })).toBeDefined()
    await ui.press({ key: 'tab-session' })
    expect(await ui.find({ text: /Context/ })).toBeDefined()
    expect(await ui.find({ text: /Tool histogram/ })).toBeDefined()
    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ text: /0 files/ })).toBeDefined()
    expect(await ui.find({ text: /lazygit off/ })).toBeDefined()
    await ui.press({ key: 'tab-timeline' })
    expect(await ui.find({ text: /fills in once a turn runs/ })).toBeDefined()
    await ui.press({ key: 'tab-workflow' })
    expect(await ui.find({ key: 'wf-refresh' })).toBeDefined()
    await ui.press({ key: 'tab-recall' })
    expect(await ui.find({ key: 'recall-query' })).toBeDefined()
    await ui.press({ key: 'tab-board' })
    await ui.unmount()
  }
})

test('the lower tabs lay out in the unicode and ascii icon sets', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  const ui = await $.ui.mount(pane('terminal'))

  for (const icons of ['unicode', 'ascii'] as const) {
    await ui.press({ key: 'tab-settings' })
    await ui.select({ key: 'set-icons', value: icons })
    await ui.press({ key: 'tab-cost' })
    expect(await ui.find({ text: /engine total/ })).toBeDefined()
    await ui.press({ key: 'tab-session' })
    expect(await ui.find({ text: /Context/ })).toBeDefined()
  }
  await ui.unmount()
})
