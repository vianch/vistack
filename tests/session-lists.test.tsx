import { describe, expect, mock, test } from 'claude-code/testing'

import { SKILL_CAP, createdTask, recordSkill, withTask } from '../hooks/lib/session-lists'

const pane = {
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
  surface: 'terminal' as const,
}

describe('session lists', () => {
  test('keeps the last SKILL_CAP skills', async () => {
    const list = Array.from({ length: SKILL_CAP }, (_, index) => ({ at: index, skill: `s${index}` }))
    const next = recordSkill(list, { at: 99, skill: 'latest' })

    expect(next).toHaveLength(SKILL_CAP)
    expect(next[0]?.skill).toBe('s1')
    expect(next.at(-1)?.skill).toBe('latest')
  })

  test('reads the created task id from the result, never from the input', async () => {
    expect(createdTask({ subject: 'from input' }, { task: { id: '7', subject: 'from result' } })).toEqual({ content: 'from result', id: '7', status: 'pending' })
    expect(createdTask({ subject: 'from input' }, { task: { id: '8' } })).toEqual({ content: 'from input', id: '8', status: 'pending' })
    expect(createdTask({ subject: 'x' }, {})).toBeNull()
    expect(createdTask({ subject: 'x' }, { task: { id: '' } })).toBeNull()
  })

  test('a repeated task id replaces its row', async () => {
    const list = withTask([{ content: 'old', id: '7', status: 'pending' }], { content: 'new', id: '7', status: 'pending' })

    expect(list).toEqual([{ content: 'new', id: '7', status: 'pending' }])
  })
})

test('a Skill tool call lands in the Agents tab skills list', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('tool.call', () => ({ result: { commandName: 'commit', success: true }, text: 'loaded' }) as never)
  await $.tool.call({ skill: 'commit', tool: 'Skill' } as never)

  const ui = await $.ui.mount(pane)

  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ text: 'commit' })).toBeDefined()
  expect(await ui.find({ text: /No skill has run/ })).toBeUndefined()
  await ui.unmount()
})

test('a TaskCreate call adds an open task under the id its result carries, and TaskUpdate completes it', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('tool.call', (_engine, e) => {
    const call = e as unknown as Record<string, unknown>

    return call.tool === 'TaskCreate'
      ? ({ result: { task: { id: '7', subject: call.subject } }, text: 'created' } as never)
      : ({ result: {}, text: 'updated' } as never)
  })
  await $.tool.call({ description: 'cover it', subject: 'write the tests', tool: 'TaskCreate' } as never)

  const ui = await $.ui.mount(pane)

  expect(await ui.find({ text: /write the tests/ })).toBeDefined()
  await $.tool.call({ status: 'completed', taskId: '7', tool: 'TaskUpdate' } as never)
  expect(await ui.find({ text: /write the tests/ })).toBeUndefined()
  await ui.unmount()
})
