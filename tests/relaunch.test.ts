import { describe, expect, test } from 'claude-code/testing'

import { LOOP_INTERVALS, loopArgs, relaunchPlan, withLoopArgs } from '../hooks/lib/relaunch'

import type { DeckMonitor } from '../types'

const row = (id: string, fields: Partial<DeckMonitor> = {}): DeckMonitor => ({
  canCancel: false,
  canStop: false,
  detail: '',
  endedAt: 5,
  id,
  kind: 'shell',
  label: id,
  source: 'tool',
  startedAt: 0,
  status: 'done',
  ...fields,
})

describe('relaunchPlan', () => {
  test('maps each recorded recipe to a call', async () => {
    const bash = { input: { command: 'npm run dev', run_in_background: true as const }, tool: 'Bash' as const, via: 'tool' as const }

    expect(relaunchPlan(row('b1', { relaunch: bash }))).toEqual({ call: bash, isAllowed: true })
    expect(relaunchPlan(row('a1', { kind: 'agent', relaunch: { agentId: 'a1', via: 'rehire' } }))).toEqual({
      call: { agentId: 'a1', via: 'rehire' },
      isAllowed: true,
    })
    expect(relaunchPlan(row('w1', { kind: 'wakeup', relaunch: { args: '/babysit s1', via: 'loop' } }))).toEqual({
      call: { args: '/babysit s1', command: 'loop', via: 'command' },
      isAllowed: true,
    })
    expect(
      relaunchPlan(row('c1', { kind: 'cron', relaunch: { input: { cron: '*/5 * * * *', prompt: 'check CI', recurring: true }, tool: 'CronCreate', via: 'tool' } })),
    ).toMatchObject({ call: { tool: 'CronCreate' }, isAllowed: true })
  })

  test('refuses an open row, saying which kind of open', async () => {
    expect(relaunchPlan(row('r1', { status: 'running' }))).toEqual({ isAllowed: false, reason: 'still running' })
    expect(relaunchPlan(row('c1', { kind: 'cron', status: 'active' }))).toEqual({ isAllowed: false, reason: 'still waiting' })
  })

  test('refuses a row with no recipe, by kind', async () => {
    const reason = (monitor: DeckMonitor) => (relaunchPlan(monitor) as { reason: string }).reason

    expect(reason(row('w1', { kind: 'wakeup' }))).toBe('a /loop wakeup whose prompt was not recorded')
    expect(reason(row('f1', { kind: 'workflow' }))).toBe('workflows cannot be relaunched from the deck')
    expect(reason(row('run:x', { kind: 'run-monitor' }))).toBe('a run monitor is a claim from a state file')
    expect(reason(row('a1', { kind: 'agent' }))).toBe('a remote agent cannot be relaunched from the deck')
    expect(reason(row('b1'))).toBe('how it started was not recorded')
  })

  test('refuses an autonomous loop, which belongs to the session that started it', async () => {
    const sentinel = row('c1', {
      kind: 'cron',
      relaunch: { input: { cron: '* * * * *', prompt: '<<autonomous-loop>>', recurring: true }, tool: 'CronCreate', via: 'tool' },
    })

    expect(relaunchPlan(sentinel)).toEqual({ isAllowed: false, reason: 'an autonomous loop belongs to the session that started it' })
  })
})

describe('loops made from the deck', () => {
  test('offers self-paced, 5m, 10m, 30m and 1h', async () => {
    expect(LOOP_INTERVALS.map(({ label, value }) => [label, value])).toEqual([
      ['self-paced', ''],
      ['5m', '5m'],
      ['10m', '10m'],
      ['30m', '30m'],
      ['1h', '1h'],
    ])
  })

  test('loopArgs joins interval and prompt, and refuses an empty prompt', async () => {
    expect(loopArgs('5m', ' check CI ')).toEqual({ args: '5m check CI' })
    expect(loopArgs('', 'check CI')).toEqual({ args: 'check CI' })
    expect(loopArgs('1h', '   ')).toEqual({ reason: 'empty prompt' })
  })

  test('withLoopArgs ties the args to the newest open wakeup or cron without a recipe, from `at` on', async () => {
    const open = (id: string, fields: Partial<DeckMonitor>) => row(id, { endedAt: undefined, status: 'active', ...fields })
    const list = [
      open('old', { kind: 'wakeup', startedAt: 5 }),
      open('older-cron', { kind: 'cron', startedAt: 20 }),
      open('new-wakeup', { kind: 'wakeup', startedAt: 30 }),
      open('shell', { kind: 'shell', startedAt: 40, status: 'running' }),
      open('recorded', { kind: 'wakeup', relaunch: { args: 'x', via: 'loop' }, startedAt: 50 }),
      row('ended', { kind: 'wakeup', startedAt: 60 }),
    ]
    const tied = withLoopArgs(list, '5m check CI', 10)

    expect(tied.map(monitor => monitor.relaunch)).toEqual([
      undefined,
      undefined,
      { args: '5m check CI', via: 'loop' },
      undefined,
      { args: 'x', via: 'loop' },
      undefined,
    ])
    expect(withLoopArgs(list, 'x', 100)).toEqual(list)
  })
})
