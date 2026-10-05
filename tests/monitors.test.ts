import { describe, expect, test } from 'claude-code/testing'

import {
  AWAKE_LIMITS,
  DEFAULT_KEEP_AWAKE,
  awakePlan,
  awakeText,
  readKeepAwake,
  shouldHoldAwake,
} from '../hooks/lib/awake'
import {
  MONITOR_CAP,
  applyChange,
  fromAgents,
  fromCronList,
  fromRuns,
  fromStopSnapshot,
  fromToolCall,
  isLongRunning,
  isSessionWorking,
  mergeMonitors,
  nextCronAt,
  settle,
  sortMonitors,
  stopAllCalls,
  stopCall,
  stoppedBy,
  summary,
} from '../hooks/lib/monitors'
import { monitorsBrief, monitorsHeadline, monitorsTab } from '../hooks/tabs/monitors'

import type { EngineInterface } from 'claude-code'
import type { DeckMonitor, MonitorChange, StopCall } from '../hooks/lib/monitors'
import type { DeckAgent } from '../types'

const MINUTE = 60_000

const row = (id: string, fields: Partial<DeckMonitor> = {}): DeckMonitor => ({
  canCancel: false,
  canStop: true,
  detail: '',
  id,
  kind: 'shell',
  label: id,
  source: 'tool',
  startedAt: 0,
  status: 'running',
  ...fields,
})

const started = (change: MonitorChange | null): DeckMonitor => {
  if (change?.change !== 'start') {
    throw new Error(`expected a start, got ${JSON.stringify(change)}`)
  }

  return change.monitor
}

const agent = (agentId: string, status: string): DeckAgent => ({
  agentId,
  description: '',
  model: '',
  nickname: agentId,
  startedAt: 0,
  status,
  toolUseId: `tu-${agentId}`,
  type: 'Explore',
})

// The wiring hands stopCall's call to $.tool.call as it is.
const callStop = (dollar: EngineInterface, call: StopCall) => dollar.tool.call(call)

describe('monitors from tool calls', () => {
  test('a Monitor watch runs until its deadline; a persistent one has none', async () => {
    const watch = started(
      fromToolCall('Monitor', { command: 'tail -f log', description: 'watch the log', timeout_ms: 300_000 }, { taskId: 'm1', timeoutMs: 300_000 }, 1000),
    )

    expect(watch).toEqual({
      canCancel: false,
      canStop: true,
      deadlineAt: 301_000,
      detail: 'tail -f log',
      id: 'm1',
      kind: 'monitor',
      label: 'watch the log',
      source: 'tool',
      startedAt: 1000,
      status: 'running',
    })
    expect(started(fromToolCall('Monitor', { description: 'ws', timeout_ms: 0 }, { persistent: true, taskId: 'm2', timeoutMs: 0 }, 0)).deadlineAt).toBeUndefined()
    expect(fromToolCall('Monitor', { description: 'x' }, {}, 0)).toBeNull()
  })

  test('a shell counts only when the result names a background task, however it was backgrounded', async () => {
    expect(fromToolCall('Bash', { command: 'npm test' }, { stdout: 'ok' }, 0)).toBeNull()

    const shell = started(fromToolCall('Bash', { command: 'npm run dev' }, { backgroundTaskId: 'b1', backgroundedByUser: true }, 5))

    expect([shell.id, shell.kind, shell.label, shell.canStop]).toEqual(['b1', 'shell', 'npm run dev', true])
  })

  test('only a launched agent or workflow is long-running work', async () => {
    expect(fromToolCall('Agent', { description: 'map', prompt: 'p' }, { agentId: 'a1', status: 'completed' }, 0)).toBeNull()
    expect(started(fromToolCall('Agent', { description: 'map', prompt: 'p' }, { agentId: 'a1', status: 'async_launched' }, 0)).id).toBe('a1')
    expect(started(fromToolCall('Workflow', { name: 'qa' }, { status: 'async_launched', taskId: 'w1', workflowName: 'qa-run' }, 0)).label).toBe(
      'qa-run',
    )
    expect(fromToolCall('Workflow', {}, { error: 'syntax', status: 'async_launched', taskId: 'w2' }, 0)).toBeNull()
  })

  test('a wakeup is keyed by its fire time and stop: true ends every wakeup', async () => {
    const wakeup = started(
      fromToolCall('ScheduleWakeup', { delaySeconds: 600, prompt: '/loop /vistack babysit s1', reason: 'CI takes ten minutes' }, { scheduledFor: 601_000 }, 1000),
    )

    expect([wakeup.id, wakeup.status, wakeup.nextAt, wakeup.isLoop, wakeup.canCancel]).toEqual(['wakeup:601000', 'scheduled', 601_000, true, true])
    expect(fromToolCall('ScheduleWakeup', { stop: true }, { stopped: true }, 9)).toEqual({ at: 9, change: 'end-wakeups' })
  })

  test('a cron gets its next fire, an expiry when recurring, and TaskStop or CronDelete end a row by id', async () => {
    const from = new Date(2026, 9, 5, 10, 2, 30).getTime()
    const cron = started(fromToolCall('CronCreate', { cron: '*/5 * * * *', prompt: 'check CI' }, { humanSchedule: 'every 5 minutes', id: 'c1', recurring: true }, from))

    expect([cron.kind, cron.detail, cron.schedule, cron.canCancel, cron.canStop]).toEqual(['cron', 'every 5 minutes', '*/5 * * * *', true, false])
    expect(cron.nextAt).toBe(new Date(2026, 9, 5, 10, 5).getTime())
    expect(cron.deadlineAt).toBe(from + 7 * 24 * 60 * MINUTE)
    expect(fromToolCall('TaskStop', { task_id: 'sherlock' }, { task_id: 'a1', task_type: 'local_agent' }, 3)).toEqual({ at: 3, change: 'end', id: 'a1' })
    expect(fromToolCall('CronDelete', { id: 'c1' }, { id: 'c1' }, 4)).toEqual({ at: 4, change: 'end', id: 'c1' })
    expect(fromToolCall('Read', { file_path: 'a' }, {}, 0)).toBeNull()
  })
})

describe('monitor changes', () => {
  test('an end stops the matching open row only, and end-wakeups leaves tasks and crons running', async () => {
    const list = [row('b1'), row('b2'), row('c1', { kind: 'cron', status: 'scheduled' }), row('wakeup:9', { isLoop: true, kind: 'wakeup', status: 'scheduled' })]
    const one = applyChange(list, { at: 50, change: 'end', id: 'b2' })

    expect(one.map(monitor => monitor.status)).toEqual(['running', 'stopped', 'scheduled', 'scheduled'])
    expect(one[1]?.endedAt).toBe(50)
    expect(applyChange(list, { at: 50, change: 'end-wakeups' }).map(monitor => monitor.status)).toEqual(['running', 'running', 'scheduled', 'stopped'])
  })

  test('a new loop wakeup means the last one fired', async () => {
    const first = started(fromToolCall('ScheduleWakeup', { delaySeconds: 60, prompt: '/loop x' }, { scheduledFor: 61_000 }, 1000))
    const second = started(fromToolCall('ScheduleWakeup', { delaySeconds: 60, prompt: '/loop x' }, { scheduledFor: 125_000 }, 65_000))
    const list = applyChange(applyChange([], { change: 'start', monitor: first }), { change: 'start', monitor: second })

    expect(list.map(monitor => [monitor.id, monitor.status])).toEqual([
      ['wakeup:61000', 'done'],
      ['wakeup:125000', 'scheduled'],
    ])
  })

  test('a row that ended stays ended and keeps the time it was first seen', async () => {
    const list = mergeMonitors([row('b1', { endedAt: 9, startedAt: 5, status: 'stopped' }), row('b2', { startedAt: 5 })], [
      row('b1', { startedAt: 20 }),
      row('b2', { label: 'renamed', source: 'stop-snapshot', startedAt: 20 }),
    ])

    expect(list.map(monitor => [monitor.status, monitor.startedAt, monitor.label, monitor.source])).toEqual([
      ['stopped', 5, 'b1', 'tool'],
      ['running', 5, 'renamed', 'tool'],
    ])
  })

  test('the cap drops the oldest finished rows and never an open one', async () => {
    const finished = Array.from({ length: 5 }, (_, index) => row(`done-${index}`, { endedAt: index, status: 'done' }))
    const open = Array.from({ length: 3 }, (_, index) => row(`open-${index}`))
    const list = mergeMonitors([], [...finished, ...open], 5)

    expect(list.map(monitor => monitor.id)).toEqual(['done-3', 'done-4', 'open-0', 'open-1', 'open-2'])
    expect(mergeMonitors([], open, 1)).toHaveLength(3)
    expect(MONITOR_CAP).toBeGreaterThan(10)
  })
})

describe('the Stop snapshot', () => {
  const tasks = [{ command: 'npm run dev', description: 'dev server', id: 'b1', status: 'running', type: 'shell' }]

  test('a family sent empty ends its open rows; a family left out ends nothing', async () => {
    const list = [row('b1'), row('m1', { kind: 'monitor' }), row('c1', { kind: 'cron', status: 'scheduled' })]
    const sent = fromStopSnapshot(list, { crons: [], tasks }, 100)

    expect(sent.map(monitor => [monitor.id, monitor.status])).toEqual([
      ['b1', 'running'],
      ['m1', 'done'],
      ['c1', 'done'],
    ])
    expect(sent[1]?.endedAt).toBe(100)
    expect(fromStopSnapshot(list, { crons: undefined, tasks: undefined }, 100).map(monitor => monitor.status)).toEqual(['running', 'running', 'scheduled'])
  })

  test('a snapshot from a subagent adds what it sees and ends nothing', async () => {
    const list = fromStopSnapshot([row('m1', { kind: 'monitor' })], { tasks }, 100, false)

    expect(list.map(monitor => [monitor.id, monitor.status, monitor.source])).toEqual([
      ['m1', 'running', 'tool'],
      ['b1', 'running', 'stop-snapshot'],
    ])
  })

  test('the pending loop wakeup folds into the one the tool call recorded instead of doubling', async () => {
    const at = new Date(2026, 9, 5, 10, 0, 0).getTime()
    const fireAt = new Date(2026, 9, 5, 10, 10, 20).getTime()
    const wakeup = started(fromToolCall('ScheduleWakeup', { delaySeconds: 620, prompt: '/loop x' }, { scheduledFor: fireAt }, at))
    const crons = [{ id: 'cron-77', prompt: '/loop x', recurring: false, schedule: '10 10 5 10 *' }]
    const list = fromStopSnapshot([wakeup], { crons, tasks: [] }, at)

    expect(list.map(monitor => [monitor.id, monitor.status])).toEqual([['wakeup:' + fireAt, 'scheduled']])
    // With no recorded wakeup the snapshot's own row stands, as a cancellable loop wakeup.
    const alone = fromStopSnapshot([], { crons }, at)[0]

    expect([alone?.kind, alone?.isLoop, alone?.canCancel, stopCall(alone ?? row('x')).isAllowed]).toEqual(['wakeup', true, true, true])
  })

  test('a one-shot cron that is not a loop stays a cron, and a recorded wakeup survives an empty crons list', async () => {
    const wakeup = row('wakeup:5', { isLoop: true, kind: 'wakeup', nextAt: 5 * MINUTE, status: 'scheduled' })
    const list = fromStopSnapshot([wakeup], { crons: [{ id: 'c9', prompt: 'remind me', recurring: false, schedule: '0 9 * * *' }] }, 0)

    expect(list.map(monitor => [monitor.id, monitor.kind, monitor.status])).toEqual([
      ['wakeup:5', 'wakeup', 'scheduled'],
      ['c9', 'cron', 'scheduled'],
    ])
    expect(fromStopSnapshot([wakeup], { crons: [] }, 0)[0]?.status).toBe('scheduled')
  })

  test('takes the engine Stop hook input as it is', async ($, on) => {
    let seen: DeckMonitor[] = []

    on('classic.Stop', (_engine, e) => {
      seen = fromStopSnapshot([], { crons: e.session_crons, tasks: e.background_tasks }, 0)

      return {}
    })
    await $.classic.Stop({
      background_tasks: [{ agent_type: 'Explore', description: 'map the code', id: 'a7', status: 'running', type: 'subagent' }],
      session_crons: [{ id: 'c1', prompt: '<<autonomous-loop>>', recurring: true, schedule: '*/10 * * * *' }],
      stop_hook_active: false,
    })
    expect(seen.map(monitor => [monitor.id, monitor.kind, monitor.label, monitor.detail])).toEqual([
      ['a7', 'agent', 'map the code', 'Explore'],
      ['c1', 'cron', 'autonomous loop', '*/10 * * * *'],
    ])
  })
})

describe('other monitor sources', () => {
  test('CronList retires deleted crons and leaves wakeups alone', async () => {
    const list = [row('c1', { kind: 'cron', status: 'scheduled' }), row('c2', { kind: 'cron', status: 'scheduled' }), row('wakeup:1', { kind: 'wakeup', status: 'scheduled' })]
    const next = fromCronList(list, [{ cron: '0 * * * *', humanSchedule: 'hourly', id: 'c2', prompt: 'p' }], 7)

    expect(next.map(monitor => [monitor.id, monitor.status, monitor.detail])).toEqual([
      ['c1', 'done', ''],
      ['c2', 'scheduled', 'hourly'],
      ['wakeup:1', 'scheduled', ''],
    ])
  })

  test('run monitors follow the state file, may restart, and end when the run is gone', async () => {
    const run = { root: '/repo/.claude/state', slices: [], slug: 's1' }
    const active = fromRuns([], [{ ...run, monitor: 'active', playbook: 'babysit' }], 10)

    expect(active.map(monitor => [monitor.id, monitor.kind, monitor.status, monitor.detail])).toEqual([
      ['run:/repo/.claude/state/s1', 'run-monitor', 'running', 'babysit · active'],
    ])

    const stopped = fromRuns(active, [{ ...run, monitor: 'stopped' }], 20)

    expect(stopped[0]?.status).toBe('stopped')
    expect(fromRuns(stopped, [{ ...run, monitor: 'active' }], 30)[0]?.status).toBe('running')
    expect(fromRuns(active, [], 40)[0]?.status).toBe('done')
    expect(stopCall(active[0] ?? row('x'))).toEqual({ isAllowed: false, reason: "the run's monitor is its /loop: cancel that wakeup or cron" })
  })

  test('a background agent ends when the agent list says so', async () => {
    const list = [row('a1', { kind: 'agent' }), row('a2', { kind: 'agent' })]
    const next = fromAgents(list, [agent('a1', 'completed'), agent('a2', 'running')], 50)

    expect(next.map(monitor => [monitor.status, monitor.endedAt])).toEqual([
      ['done', 50],
      ['running', undefined],
    ])
  })

  test('time ends fired wakeups and expired watches and moves recurring crons on', async () => {
    const at = new Date(2026, 9, 5, 10, 0).getTime()
    const list = [
      row('wakeup:1', { isLoop: true, kind: 'wakeup', nextAt: at, status: 'scheduled' }),
      row('c1', { isRecurring: true, kind: 'cron', nextAt: at, schedule: '*/5 * * * *', status: 'scheduled' }),
      row('m1', { deadlineAt: at, kind: 'monitor' }),
      row('b1'),
    ]
    const later = settle(list, at + 3 * MINUTE)

    expect(later.map(monitor => monitor.status)).toEqual(['done', 'scheduled', 'done', 'running'])
    expect(later[1]?.nextAt).toBe(new Date(2026, 9, 5, 10, 5).getTime())
    expect(settle(list, at + MINUTE).map(monitor => monitor.status)).toEqual(['scheduled', 'scheduled', 'running', 'running'])
  })
})

describe('reading monitors', () => {
  test('long-running starts exactly at the threshold and only for running rows', async () => {
    expect(isLongRunning(row('b1'), 10 * MINUTE)).toBe(true)
    expect(isLongRunning(row('b1'), 10 * MINUTE - 1)).toBe(false)
    expect(isLongRunning(row('b1'), 5 * MINUTE, 5 * MINUTE)).toBe(true)
    expect(isLongRunning(row('c1', { status: 'scheduled' }), 60 * MINUTE)).toBe(false)
  })

  test('sorts running oldest first, then scheduled by next fire, then unknown, then finished newest first', async () => {
    const list = [
      row('done-old', { endedAt: 1, status: 'done' }),
      row('later', { nextAt: 900, status: 'scheduled' }),
      row('young', { startedAt: 500 }),
      row('mystery', { status: 'unknown' }),
      row('sooner', { nextAt: 300, status: 'scheduled' }),
      row('done-new', { endedAt: 9, status: 'stopped' }),
      row('old', { startedAt: 100 }),
    ]

    expect(sortMonitors(list).map(monitor => monitor.id)).toEqual(['old', 'young', 'sooner', 'later', 'mystery', 'done-new', 'done-old'])
  })

  test('the summary counts each status and names the longest-running row', async () => {
    const list = [row('young', { startedAt: 30 * MINUTE }), row('old', { startedAt: 0 }), row('c1', { status: 'scheduled' }), row('x', { status: 'failed' })]
    const counts = summary(list, 35 * MINUTE)

    expect([counts.running, counts.scheduled, counts.failed, counts.done, counts.longRunning, counts.longest?.id]).toEqual([2, 1, 1, 0, 1, 'old'])
    expect(summary([], 0).longest).toBeUndefined()
  })

  test('the session works while a turn, a live agent, a running row or work due within 30 minutes is there', async () => {
    const idle = { agents: [], isTurnRunning: false, monitors: [], now: 0 }

    expect(isSessionWorking(idle)).toBe(false)
    expect(isSessionWorking({ ...idle, isTurnRunning: true })).toBe(true)
    expect(isSessionWorking({ ...idle, agents: [agent('a1', 'running')] })).toBe(true)
    expect(isSessionWorking({ ...idle, agents: [agent('a1', 'completed')] })).toBe(false)
    expect(isSessionWorking({ ...idle, monitors: [row('b1')] })).toBe(true)
    expect(isSessionWorking({ ...idle, monitors: [row('c1', { nextAt: 30 * MINUTE, status: 'scheduled' })] })).toBe(true)
    expect(isSessionWorking({ ...idle, monitors: [row('c1', { nextAt: 30 * MINUTE + 1, status: 'scheduled' })] })).toBe(false)
    expect(isSessionWorking({ ...idle, monitors: [row('run:x', { kind: 'run-monitor' })] })).toBe(false)
  })
})

describe('stopping monitors', () => {
  test('each kind goes to the tool that ends it, or says why it cannot', async () => {
    for (const kind of ['monitor', 'shell', 'agent', 'workflow', 'other'] as const) {
      expect(stopCall(row('t1', { kind }))).toEqual({ call: { task_id: 't1', tool: 'TaskStop' }, isAllowed: true, verb: 'stop' })
    }
    expect(stopCall(row('c1', { kind: 'cron', status: 'scheduled' }))).toEqual({ call: { id: 'c1', tool: 'CronDelete' }, isAllowed: true, verb: 'cancel' })
    expect(stopCall(row('w1', { isLoop: true, kind: 'wakeup', status: 'scheduled' }))).toEqual({
      call: { stop: true, tool: 'ScheduleWakeup' },
      isAllowed: true,
      verb: 'cancel',
    })
    expect(stopCall(row('w2', { kind: 'wakeup', status: 'scheduled' })).isAllowed).toBe(false)
    expect(stopCall(row('b1', { status: 'done' }))).toEqual({ isAllowed: false, reason: 'already done' })
  })

  test('stop all sends one ScheduleWakeup stop for every loop wakeup and skips what cannot stop', async () => {
    const list = [
      row('b1'),
      row('w1', { isLoop: true, kind: 'wakeup', status: 'scheduled' }),
      row('w2', { isLoop: true, kind: 'wakeup', status: 'scheduled' }),
      row('b2', { status: 'done' }),
      row('run:x', { kind: 'run-monitor' }),
    ]

    expect(stopAllCalls(list)).toEqual([
      { task_id: 'b1', tool: 'TaskStop' },
      { stop: true, tool: 'ScheduleWakeup' },
    ])
  })

  test('a stop that went through ends the row it named, and a wakeup stop ends every wakeup', async () => {
    const list = [row('b1'), row('c1', { kind: 'cron', status: 'scheduled' }), row('w1', { isLoop: true, kind: 'wakeup', status: 'scheduled' })]
    const after = stopAllCalls(list).reduce((next, call) => applyChange(next, stoppedBy(call, 70)), list)

    expect(after.map(monitor => [monitor.status, monitor.endedAt])).toEqual([
      ['stopped', 70],
      ['stopped', 70],
      ['stopped', 70],
    ])
  })

  test('the stop call runs through $.tool.call as it is', async ($, on) => {
    const calls: unknown[] = []

    on('tool.call', (_engine, e) => {
      if (e.tool === 'TaskStop') {
        calls.push({ task_id: e.task_id, tool: e.tool })
      }

      return { result: { message: 'stopped', task_id: 'b1', task_type: 'local_bash' }, text: 'stopped' } as never
    })

    const plan = stopCall(row('b1'))

    if (plan.isAllowed) {
      await $.tool.call(plan.call)
    }
    expect(calls).toEqual([{ task_id: 'b1', tool: 'TaskStop' }])
    expect(typeof callStop).toBe('function')
  })
})

describe('cron times', () => {
  test('finds the next matching minute in local time', async () => {
    const from = new Date(2026, 9, 5, 10, 2, 30).getTime()

    expect(nextCronAt('*/5 * * * *', from)).toBe(new Date(2026, 9, 5, 10, 5).getTime())
    expect(nextCronAt('30 14 28 2 *', from)).toBe(new Date(2027, 1, 28, 14, 30).getTime())
    expect(nextCronAt('0 9 * * 1-5', from)).toBe(new Date(2026, 9, 6, 9, 0).getTime())
    // Both day fields restricted: either matching is enough (Oct 5 2026 is a Monday).
    expect(nextCronAt('0 12 1 * 1', from)).toBe(new Date(2026, 9, 5, 12, 0).getTime())
    expect(nextCronAt('0 0 * * 7', from)).toBe(new Date(2026, 9, 11, 0, 0).getTime())
    expect(nextCronAt('2 10 * * *', new Date(2026, 9, 5, 10, 2, 0).getTime())).toBe(new Date(2026, 9, 5, 10, 2).getTime())
  })

  test('refuses what it cannot read', async () => {
    for (const expression of ['', '* * * *', '61 * * * *', '*/0 * * * *', 'a b c d e', '1,,2 * * * *', '0 0 31 2 *']) {
      expect(nextCronAt(expression, 0)).toBeUndefined()
    }
  })
})

describe('keep-awake', () => {
  test('holds a lock with caffeinate on macOS, systemd-inhibit on Linux, and says why elsewhere', async () => {
    expect(awakePlan('Darwin')).toEqual({ argv: ['caffeinate', '-dims'], how: 'caffeinate' })
    expect(awakePlan('darwin\n')).toEqual({ argv: ['caffeinate', '-dims'], how: 'caffeinate' })

    const linux = awakePlan('Linux')

    expect(linux.argv?.[0]).toBe('systemd-inhibit')
    expect(linux.argv).toContain('--what=idle:sleep:handle-lid-switch')
    expect(linux.argv?.slice(-2)).toEqual(['sleep', 'infinity'])
    expect(awakePlan('MINGW64_NT-10.0')).toEqual({ argv: null, reason: 'keep-awake is not supported on MINGW64_NT-10.0' })
    expect(awakePlan('')).toEqual({ argv: null, reason: 'keep-awake is not supported on this system' })
  })

  test('follows the setting', async () => {
    expect([shouldHoldAwake('off', true), shouldHoldAwake('off', false)]).toEqual([false, false])
    expect([shouldHoldAwake('while-working', true), shouldHoldAwake('while-working', false)]).toEqual([true, false])
    expect([shouldHoldAwake('always', true), shouldHoldAwake('always', false)]).toEqual([true, true])
    expect([readKeepAwake('always'), readKeepAwake('sometimes'), readKeepAwake(undefined)]).toEqual(['always', DEFAULT_KEEP_AWAKE, 'while-working'])
  })

  test('says what the lock does and does not do', async () => {
    expect(awakeText({ how: 'caffeinate', isHeld: true }, 'while-working')).toBe('awake (caffeinate)')
    expect(awakeText({ isHeld: false }, 'while-working')).toBe('normal sleep')
    expect(awakeText({ isHeld: false, reason: 'keep-awake is not supported on Windows' }, 'always')).toBe('keep-awake is not supported on Windows')
    expect(awakeText({ isHeld: false, reason: 'x' }, 'off')).toBe('normal sleep (keep-awake off)')
    expect(AWAKE_LIMITS).toContain('cannot stop a shutdown')
  })
})

test('the monitors views load', async () => {
  expect([typeof monitorsTab, typeof monitorsBrief, typeof monitorsHeadline]).toEqual(['function', 'function', 'function'])
})
