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
  ABSENT_GRACE_MS,
  MONITOR_CAP,
  NO_END_REPORT,
  applyChange,
  fromAgents,
  fromCronList,
  fromRuns,
  fromStopSnapshot,
  fromTaskNotifications,
  fromToolCall,
  isFinished,
  isLongRunning,
  isOpen,
  isSessionWorking,
  mergeMonitors,
  nextCronAt,
  noteFromTask,
  resolveAbsent,
  settle,
  sortMonitors,
  stopAllCalls,
  stopCall,
  stoppedBy,
  summary,
  taskNotesFrom,
} from '../hooks/lib/monitors'
import { iconsOf, paletteOf } from '../hooks/lib/theme'
import { monitorsSection, selectKey } from '../hooks/tabs/monitors'

import type { EngineInterface } from 'claude-code'
import type { MonitorsSectionActions, MonitorsSectionData } from '../hooks/tabs/monitors'
import type { DeckAgent, DeckMonitor, DeckMonitorStatus, MonitorChange, StopCall } from '../types'

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
      relaunch: { input: { command: 'tail -f log', description: 'watch the log', timeout_ms: 300_000 }, tool: 'Monitor', via: 'tool' },
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

    expect([wakeup.id, wakeup.status, wakeup.nextAt, wakeup.isLoop, wakeup.canCancel]).toEqual(['wakeup:601000', 'active', 601_000, true, true])
    expect(fromToolCall('ScheduleWakeup', { stop: true }, { stopped: true }, 9)).toEqual({ at: 9, change: 'end-wakeups', endedBy: 'report' })
  })

  test('a cron gets its next fire, an expiry when recurring, and TaskStop or CronDelete end a row by id', async () => {
    const from = new Date(2026, 9, 5, 10, 2, 30).getTime()
    const cron = started(fromToolCall('CronCreate', { cron: '*/5 * * * *', prompt: 'check CI' }, { humanSchedule: 'every 5 minutes', id: 'c1', recurring: true }, from))

    expect([cron.kind, cron.detail, cron.schedule, cron.canCancel, cron.canStop]).toEqual(['cron', 'every 5 minutes', '*/5 * * * *', true, false])
    expect(cron.nextAt).toBe(new Date(2026, 9, 5, 10, 5).getTime())
    expect(cron.deadlineAt).toBe(from + 7 * 24 * 60 * MINUTE)
    expect(fromToolCall('TaskStop', { task_id: 'sherlock' }, { task_id: 'a1', task_type: 'local_agent' }, 3)).toEqual({ at: 3, change: 'end', endedBy: 'report', id: 'a1', status: 'stopped' })
    expect(fromToolCall('CronDelete', { id: 'c1' }, { id: 'c1' }, 4)).toEqual({ at: 4, change: 'end', endedBy: 'report', id: 'c1', status: 'canceled' })
    expect(fromToolCall('Read', { file_path: 'a' }, {}, 0)).toBeNull()
  })
})

describe('monitor changes', () => {
  test('an end stops the matching open row only, and end-wakeups cancels wakeups and leaves tasks and crons alone', async () => {
    const list = [row('b1'), row('b2'), row('c1', { kind: 'cron', status: 'active' }), row('wakeup:9', { isLoop: true, kind: 'wakeup', status: 'active' })]
    const one = applyChange(list, { at: 50, change: 'end', endedBy: 'report', id: 'b2', status: 'stopped' })

    expect(one.map(monitor => monitor.status)).toEqual(['running', 'stopped', 'active', 'active'])
    expect([one[1]?.endedAt, one[1]?.endedBy, one[1]?.canStop]).toEqual([50, 'report', false])
    expect(applyChange(list, { at: 50, change: 'end-wakeups', endedBy: 'report' }).map(monitor => monitor.status)).toEqual([
      'running',
      'running',
      'active',
      'canceled',
    ])
  })

  test('a new loop wakeup means the last one fired', async () => {
    const first = started(fromToolCall('ScheduleWakeup', { delaySeconds: 60, prompt: '/loop x' }, { scheduledFor: 61_000 }, 1000))
    const second = started(fromToolCall('ScheduleWakeup', { delaySeconds: 60, prompt: '/loop x' }, { scheduledFor: 125_000 }, 65_000))
    const list = applyChange(applyChange([], { change: 'start', monitor: first }), { change: 'start', monitor: second })

    expect(list.map(monitor => [monitor.id, monitor.status])).toEqual([
      ['wakeup:61000', 'done'],
      ['wakeup:125000', 'active'],
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

  test('a family sent empty marks its open tasks absent and ends its crons; a family left out ends nothing', async () => {
    const list = [row('b1'), row('m1', { kind: 'monitor' }), row('c1', { kind: 'cron', status: 'active' })]
    const sent = fromStopSnapshot(list, { crons: [], tasks }, 100)

    expect(sent.map(monitor => [monitor.id, monitor.status, monitor.absentSince, monitor.endedBy])).toEqual([
      ['b1', 'running', undefined, undefined],
      ['m1', 'running', 100, undefined],
      ['c1', 'done', undefined, 'absence'],
    ])
    expect(fromStopSnapshot(sent, { tasks }, 150)[1]?.absentSince).toBe(100)
    expect(fromStopSnapshot(list, { crons: undefined, tasks: undefined }, 100).map(monitor => monitor.status)).toEqual(['running', 'running', 'active'])
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

    expect(list.map(monitor => [monitor.id, monitor.status])).toEqual([['wakeup:' + fireAt, 'active']])
    // With no recorded wakeup the snapshot's own row stands, as a cancellable loop wakeup.
    const alone = fromStopSnapshot([], { crons }, at)[0]

    expect([alone?.kind, alone?.isLoop, alone?.canCancel, stopCall(alone ?? row('x')).isAllowed]).toEqual(['wakeup', true, true, true])
  })

  test('a one-shot cron that is not a loop stays a cron, and a recorded wakeup survives an empty crons list', async () => {
    const wakeup = row('wakeup:5', { isLoop: true, kind: 'wakeup', nextAt: 5 * MINUTE, status: 'active' })
    const list = fromStopSnapshot([wakeup], { crons: [{ id: 'c9', prompt: 'remind me', recurring: false, schedule: '0 9 * * *' }] }, 0)

    expect(list.map(monitor => [monitor.id, monitor.kind, monitor.status])).toEqual([
      ['wakeup:5', 'wakeup', 'active'],
      ['c9', 'cron', 'active'],
    ])
    expect(fromStopSnapshot([wakeup], { crons: [] }, 0)[0]?.status).toBe('active')
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
    const list = [row('c1', { kind: 'cron', status: 'active' }), row('c2', { kind: 'cron', status: 'active' }), row('wakeup:1', { kind: 'wakeup', status: 'active' })]
    const next = fromCronList(list, [{ cron: '0 * * * *', humanSchedule: 'hourly', id: 'c2', prompt: 'p' }], 7)

    expect(next.map(monitor => [monitor.id, monitor.status, monitor.detail])).toEqual([
      ['c1', 'done', ''],
      ['c2', 'active', 'hourly'],
      ['wakeup:1', 'active', ''],
    ])
  })

  test('run monitors follow the state file, may restart, and end when the run is gone', async () => {
    const run = { root: '/repo/.claude/state', slices: [], slug: 's1' }
    const active = fromRuns([], [{ ...run, monitor: 'active', playbook: 'babysit' }], 10)

    expect(active.map(monitor => [monitor.id, monitor.kind, monitor.status, monitor.detail])).toEqual([
      ['run:/repo/.claude/state/s1', 'run-monitor', 'active', 'babysit · active'],
    ])

    const stopped = fromRuns(active, [{ ...run, monitor: 'stopped' }], 20)

    expect(stopped[0]?.status).toBe('stopped')
    const restarted = fromRuns(stopped, [{ ...run, monitor: 'active' }], 30)[0]

    expect([restarted?.status, restarted?.endedAt, restarted?.endedBy]).toEqual(['active', undefined, undefined])
    expect(fromRuns([], [{ ...run, monitor: 'claimed' }], 35).map(monitor => [monitor.status, monitor.rawStatus])).toEqual([['active', 'claimed']])
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

  test('time ends fired wakeups and moves recurring crons on, and leaves a watch past its deadline to its end report', async () => {
    const at = new Date(2026, 9, 5, 10, 0).getTime()
    const list = [
      row('wakeup:1', { isLoop: true, kind: 'wakeup', nextAt: at, status: 'active' }),
      row('c1', { isRecurring: true, kind: 'cron', nextAt: at, schedule: '*/5 * * * *', status: 'active' }),
      row('m1', { deadlineAt: at, kind: 'monitor' }),
      row('b1'),
    ]
    const later = settle(list, at + 3 * MINUTE)

    expect(later.map(monitor => [monitor.status, monitor.endedBy])).toEqual([
      ['done', 'clock'],
      ['active', undefined],
      ['running', undefined],
      ['running', undefined],
    ])
    expect(later[1]?.nextAt).toBe(new Date(2026, 9, 5, 10, 5).getTime())
    expect(settle(list, at + MINUTE).map(monitor => monitor.status)).toEqual(['active', 'active', 'running', 'running'])
  })
})

describe('reading monitors', () => {
  test('long-running starts exactly at the threshold and only for running rows', async () => {
    expect(isLongRunning(row('b1'), 10 * MINUTE)).toBe(true)
    expect(isLongRunning(row('b1'), 10 * MINUTE - 1)).toBe(false)
    expect(isLongRunning(row('b1'), 5 * MINUTE, 5 * MINUTE)).toBe(true)
    expect(isLongRunning(row('c1', { status: 'active' }), 60 * MINUTE)).toBe(false)
  })

  test('sorts running oldest first, then active by next fire, then ended newest first', async () => {
    const list = [
      row('done-old', { endedAt: 1, status: 'done' }),
      row('later', { nextAt: 900, status: 'active' }),
      row('young', { startedAt: 500 }),
      row('dead-mid', { endedAt: 5, status: 'dead' }),
      row('sooner', { nextAt: 300, status: 'active' }),
      row('done-new', { endedAt: 9, status: 'stopped' }),
      row('old', { startedAt: 100 }),
    ]

    expect(sortMonitors(list).map(monitor => monitor.id)).toEqual(['old', 'young', 'sooner', 'later', 'done-new', 'dead-mid', 'done-old'])
  })

  test('the summary counts each status and names the longest-running row', async () => {
    const list = [row('young', { startedAt: 30 * MINUTE }), row('old', { startedAt: 0 }), row('c1', { status: 'active' }), row('x', { status: 'dead' })]
    const counts = summary(list, 35 * MINUTE)

    expect([counts.running, counts.active, counts.dead, counts.done, counts.longRunning, counts.longest?.id]).toEqual([2, 1, 1, 0, 1, 'old'])
    expect(summary([], 0).longest).toBeUndefined()
  })

  test('the session works while a turn, a live agent, a running row or work due within 30 minutes is there', async () => {
    const idle = { agents: [], isTurnRunning: false, monitors: [], now: 0 }

    expect(isSessionWorking(idle)).toBe(false)
    expect(isSessionWorking({ ...idle, isTurnRunning: true })).toBe(true)
    expect(isSessionWorking({ ...idle, agents: [agent('a1', 'running')] })).toBe(true)
    expect(isSessionWorking({ ...idle, agents: [agent('a1', 'completed')] })).toBe(false)
    expect(isSessionWorking({ ...idle, monitors: [row('b1')] })).toBe(true)
    expect(isSessionWorking({ ...idle, monitors: [row('c1', { nextAt: 30 * MINUTE, status: 'active' })] })).toBe(true)
    expect(isSessionWorking({ ...idle, monitors: [row('c1', { nextAt: 30 * MINUTE + 1, status: 'active' })] })).toBe(false)
    expect(isSessionWorking({ ...idle, monitors: [row('run:x', { kind: 'run-monitor' })] })).toBe(false)
  })
})

describe('stopping monitors', () => {
  test('each kind goes to the tool that ends it, or says why it cannot', async () => {
    for (const kind of ['monitor', 'shell', 'agent', 'workflow', 'other'] as const) {
      expect(stopCall(row('t1', { kind }))).toEqual({ call: { task_id: 't1', tool: 'TaskStop' }, isAllowed: true, verb: 'stop' })
    }
    expect(stopCall(row('c1', { kind: 'cron', status: 'active' }))).toEqual({ call: { id: 'c1', tool: 'CronDelete' }, isAllowed: true, verb: 'cancel' })
    expect(stopCall(row('w1', { isLoop: true, kind: 'wakeup', status: 'active' }))).toEqual({
      call: { stop: true, tool: 'ScheduleWakeup' },
      isAllowed: true,
      verb: 'cancel',
    })
    expect(stopCall(row('w2', { kind: 'wakeup', status: 'active' })).isAllowed).toBe(false)
    expect(stopCall(row('b1', { status: 'done' }))).toEqual({ isAllowed: false, reason: 'already done' })
  })

  test('stop all sends one ScheduleWakeup stop for every loop wakeup and skips what cannot stop', async () => {
    const list = [
      row('b1'),
      row('w1', { isLoop: true, kind: 'wakeup', status: 'active' }),
      row('w2', { isLoop: true, kind: 'wakeup', status: 'active' }),
      row('b2', { status: 'done' }),
      row('run:x', { kind: 'run-monitor' }),
    ]

    expect(stopAllCalls(list)).toEqual([
      { task_id: 'b1', tool: 'TaskStop' },
      { stop: true, tool: 'ScheduleWakeup' },
    ])
  })

  test('the deck\'s stop ends a task as stopped, and its cancel ends a cron or a loop wakeup as canceled', async () => {
    expect(stoppedBy({ task_id: 'b1', tool: 'TaskStop' }, 70)).toEqual({ at: 70, change: 'end', endedBy: 'deck', id: 'b1', status: 'stopped' })
    expect(stoppedBy({ id: 'c1', tool: 'CronDelete' }, 70)).toEqual({ at: 70, change: 'end', endedBy: 'deck', id: 'c1', status: 'canceled' })
    expect(stoppedBy({ stop: true, tool: 'ScheduleWakeup' }, 70)).toEqual({ at: 70, change: 'end-wakeups', endedBy: 'deck' })

    const list = [row('b1'), row('c1', { kind: 'cron', status: 'active' }), row('w1', { isLoop: true, kind: 'wakeup', status: 'active' })]
    const after = stopAllCalls(list).reduce((next, call) => applyChange(next, stoppedBy(call, 70)), list)

    expect(after.map(monitor => [monitor.status, monitor.endedAt, monitor.endedBy])).toEqual([
      ['stopped', 70, 'deck'],
      ['canceled', 70, 'deck'],
      ['canceled', 70, 'deck'],
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

describe('the seven states', () => {
  test('running and active are open; stopped, canceled, killed, dead and done are ended', async () => {
    const statuses: DeckMonitorStatus[] = ['running', 'active', 'stopped', 'canceled', 'killed', 'dead', 'done']

    expect(statuses.map(status => [status, isOpen(row('x', { status })), isFinished(row('x', { status }))])).toEqual([
      ['running', true, false],
      ['active', true, false],
      ['stopped', false, true],
      ['canceled', false, true],
      ['killed', false, true],
      ['dead', false, true],
      ['done', false, true],
    ])
    expect(Object.keys(summary([], 0)).filter(key => statuses.includes(key as DeckMonitorStatus))).toHaveLength(statuses.length)
  })

  test('a snapshot task keeps the engine word: killed stays killed, error is dead', async () => {
    const list = fromStopSnapshot(
      [],
      {
        tasks: [
          { description: 'job', id: 'b1', status: 'killed', type: 'shell' },
          { description: 'job', id: 'b2', status: 'error', type: 'shell' },
          { description: 'job', id: 'b3', status: 'pending', type: 'shell' },
        ],
      },
      40,
      false,
    )

    expect(list.map(monitor => [monitor.id, monitor.status, monitor.rawStatus, monitor.endedBy, monitor.canStop])).toEqual([
      ['b1', 'killed', 'killed', 'report', false],
      ['b2', 'dead', 'error', 'report', false],
      ['b3', 'running', 'pending', undefined, true],
    ])
  })

  test('a background agent the list calls killed or failed ends killed or dead', async () => {
    const list = fromAgents([row('a1', { kind: 'agent' }), row('a2', { kind: 'agent' })], [agent('a1', 'killed'), agent('a2', 'failed')], 9)

    expect(list.map(monitor => [monitor.status, monitor.rawStatus, monitor.endedBy])).toEqual([
      ['killed', 'killed', 'report'],
      ['dead', 'failed', 'report'],
    ])
  })
})

describe('end reports', () => {
  // Shaped like the engine's notification: tag names only, ids and text made up.
  const notification = (taskId: string, status: string): string =>
    `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>toolu_test</tool-use-id>\n<output-file>/tmp/test.output</output-file>\n<status>${status}</status>\n<summary>Background command finished</summary>\n</task-notification>`

  test('taskNotesFrom reads task id and status from user messages and ignores the rest', async () => {
    const notes = taskNotesFrom([
      { role: 'user', text: `first ${notification('b1', 'completed')} then ${notification('b2', 'killed')}` },
      { role: 'user', text: '<task-notification>\n<task-id>m1</task-id>\n<event>a line</event>\n</task-notification>' },
      { role: 'assistant', text: notification('b3', 'failed') },
      { role: 'user', text: 'a prompt that says <status>completed</status> and <task-id>b4</task-id>' },
    ])

    expect(notes).toEqual([
      { status: 'completed', taskId: 'b1' },
      { status: 'killed', taskId: 'b2' },
    ])
    expect([noteFromTask({ durationMs: 5, id: 'b5', status: 'failed' }), noteFromTask({ id: 'b6' }), noteFromTask({ status: 'completed' })]).toEqual([
      { status: 'failed', taskId: 'b5' },
      null,
      null,
    ])
  })

  test('a task absent from a complete snapshot waits out the grace, then ends dead once end reports are known to arrive', async () => {
    const absent = fromStopSnapshot([row('b1', { detail: 'npm run dev' })], { tasks: [] }, 100)

    expect(resolveAbsent(absent, 100 + ABSENT_GRACE_MS - 1, true)[0]?.status).toBe('running')

    const dead = resolveAbsent(absent, 100 + ABSENT_GRACE_MS, true)

    expect(dead.map(monitor => [monitor.status, monitor.endedBy, monitor.endedAt, monitor.absentSince, monitor.detail])).toEqual([
      ['dead', 'absence', 100, undefined, 'npm run dev'],
    ])

    const refined = fromTaskNotifications(dead, [{ status: 'completed', taskId: 'b1' }], 9_999_999)

    expect(refined.map(monitor => [monitor.status, monitor.endedBy, monitor.endedAt, monitor.rawStatus])).toEqual([['done', 'report', 100, 'completed']])
    expect(fromTaskNotifications(refined, [{ status: 'failed', taskId: 'b1' }], 0)).toEqual(refined)
  })

  test('with no end report seen yet this session, an absent task ends done and says so; a later report still refines it', async () => {
    const absent = fromStopSnapshot([row('b1', { detail: 'npm run dev' })], { tasks: [] }, 100)
    const done = resolveAbsent(absent, 100 + ABSENT_GRACE_MS, false)

    expect(done.map(monitor => [monitor.status, monitor.endedBy, monitor.detail])).toEqual([['done', 'absence', `npm run dev · ${NO_END_REPORT}`]])
    expect(resolveAbsent([{ ...(absent[0] ?? row('x')), detail: '' }], 100 + ABSENT_GRACE_MS, false)[0]?.detail).toBe(NO_END_REPORT)
    expect(
      fromTaskNotifications(done, [{ status: 'failed', taskId: 'b1' }], 500).map(monitor => [monitor.status, monitor.endedBy, monitor.detail]),
    ).toEqual([['dead', 'report', 'npm run dev']])
  })

  test('with no snapshot ever, a shell runs until its report, a watch past its deadline waits out the grace, and a cron ends by clock', async () => {
    const at = new Date(2026, 9, 5, 10, 0).getTime()
    const deadline = at + 300_000
    const list = [
      started(fromToolCall('Bash', { command: 'npm run dev', run_in_background: true }, { backgroundTaskId: 'b1' }, at)),
      started(fromToolCall('Bash', { command: 'npm test', run_in_background: true }, { backgroundTaskId: 'b2' }, at)),
      started(fromToolCall('Monitor', { command: 'tail -f log', description: 'watch', timeout_ms: 300_000 }, { taskId: 'm1', timeoutMs: 300_000 }, at)),
      started(fromToolCall('CronCreate', { cron: '*/5 * * * *', prompt: 'check CI', recurring: false }, { id: 'c1' }, at)),
    ]
    const tick = (now: number, isFeedLive: boolean) => resolveAbsent(settle(list, now), now, isFeedLive)
    const read = (rows: DeckMonitor[]) => rows.map(monitor => [monitor.id, monitor.status, monitor.endedBy, monitor.endedAt])

    expect(read(tick(deadline + ABSENT_GRACE_MS - 1, true))).toEqual([
      ['b1', 'running', undefined, undefined],
      ['b2', 'running', undefined, undefined],
      ['m1', 'running', undefined, undefined],
      ['c1', 'done', 'clock', at],
    ])
    expect(read(tick(deadline + ABSENT_GRACE_MS, true))).toEqual([
      ['b1', 'running', undefined, undefined],
      ['b2', 'running', undefined, undefined],
      ['m1', 'dead', 'absence', deadline],
      ['c1', 'done', 'clock', at],
    ])

    const unproven = tick(deadline + ABSENT_GRACE_MS, false)

    expect([unproven[2]?.status, unproven[2]?.endedBy, unproven[2]?.detail]).toEqual(['done', 'absence', `tail -f log · ${NO_END_REPORT}`])
    expect(
      fromTaskNotifications(unproven, [{ status: 'killed', taskId: 'm1' }], 0).map(monitor => [monitor.status, monitor.detail])[2],
    ).toEqual(['killed', 'tail -f log'])

    const dayLater = at + 24 * 60 * MINUTE
    const reported = fromTaskNotifications(
      tick(dayLater, true),
      [
        { status: 'completed', taskId: 'b1' },
        { status: 'failed', taskId: 'b2' },
        { status: 'killed', taskId: 'm1' },
      ],
      dayLater,
    )

    expect(read(reported)).toEqual([
      ['b1', 'done', 'report', dayLater],
      ['b2', 'dead', 'report', dayLater],
      ['m1', 'killed', 'report', deadline],
      ['c1', 'done', 'clock', at],
    ])
  })

  test('a task seen again is no longer absent', async () => {
    const tasks = [{ description: 'dev', id: 'b1', status: 'running', type: 'shell' }]
    const absent = fromStopSnapshot([row('b1')], { tasks: [] }, 100)
    const back = fromStopSnapshot(absent, { tasks }, 130, false)

    expect(back[0]?.absentSince).toBeUndefined()
    expect(resolveAbsent(back, 100 + 10 * ABSENT_GRACE_MS, true)[0]?.status).toBe('running')
  })

  test('a report ends an open row, never one the deck or the session already ended, and ignores unknown words and ids', async () => {
    const list = [
      row('b1'),
      row('b2', { endedAt: 5, endedBy: 'deck', status: 'stopped' }),
      row('b3'),
      row('c1', { kind: 'cron', status: 'active' }),
    ]
    const next = fromTaskNotifications(
      list,
      [
        { status: 'killed', taskId: 'b1' },
        { status: 'killed', taskId: 'b2' },
        { status: 'paused', taskId: 'b3' },
        { status: 'completed', taskId: 'nobody' },
      ],
      60,
    )

    expect(next.map(monitor => [monitor.id, monitor.status, monitor.endedBy, monitor.endedAt])).toEqual([
      ['b1', 'killed', 'report', 60],
      ['b2', 'stopped', 'deck', 5],
      ['b3', 'running', undefined, undefined],
      ['c1', 'active', undefined, undefined],
    ])
  })
})

describe('work a subagent owns', () => {
  const owned = (id: string) => ({ backgroundEndsWithFinalResponse: true, backgroundTaskId: id })

  test('a background shell a synchronous subagent started ends done when that agent ends', async () => {
    const shell = started(fromToolCall('Bash', { command: 'npm test', run_in_background: true }, owned('b1'), 10, 'a1'))

    expect(shell.ownerAgentId).toBe('a1')
    expect(fromAgents([shell], [], 20)[0]?.status).toBe('running')
    expect(fromAgents([shell], [agent('a1', 'running')], 20)[0]?.status).toBe('running')
    expect(fromAgents([shell], [agent('a1', 'waiting')], 20)[0]?.status).toBe('running')

    const [ended] = fromAgents([shell], [{ ...agent('a1', 'completed'), endedAt: 30 }], 40)

    expect([ended?.status, ended?.endedBy, ended?.endedAt, ended?.detail, ended?.rawStatus, ended?.canStop]).toEqual([
      'done',
      'report',
      30,
      'npm test · ended with its agent',
      undefined,
      false,
    ])
    expect(fromAgents([row('b2', { ownerAgentId: 'a1' })], [agent('a1', 'killed')], 50)[0]?.detail).toBe('ended with its agent')
  })

  test("a main-session shell and an async subagent's shell outlive any agent's end", async () => {
    const shells = [
      started(fromToolCall('Bash', { command: 'npm run dev' }, { backgroundTaskId: 'b1' }, 0)),
      started(fromToolCall('Bash', { command: 'npm run watch' }, { backgroundTaskId: 'b2' }, 0, 'a1')),
      started(fromToolCall('Bash', { command: 'make' }, owned('b3'), 0)),
    ]

    expect(shells.map(monitor => monitor.ownerAgentId)).toEqual([undefined, undefined, undefined])
    expect(fromAgents(shells, [agent('a1', 'completed')], 9).map(monitor => monitor.status)).toEqual(['running', 'running', 'running'])
  })

  test('the owner recorded at start survives a snapshot of the same task', async () => {
    const shell = started(fromToolCall('Bash', { command: 'npm test' }, owned('b1'), 0, 'a1'))
    const seen = fromStopSnapshot([shell], { tasks: [{ command: 'npm test', description: 'npm test', id: 'b1', status: 'running', type: 'shell' }] }, 5, false)

    expect(seen[0]?.ownerAgentId).toBe('a1')
    expect(fromAgents(seen, [agent('a1', 'failed')], 6)[0]?.status).toBe('done')
  })
})

describe('relaunch recipes', () => {
  test('each kind records how to start it again, or nothing when it cannot be', async () => {
    const recipe = (tool: string, input: unknown, result: unknown) => started(fromToolCall(tool, input, result, 0)).relaunch

    expect(recipe('Monitor', { description: 'ws', timeout_ms: 0, ws: { protocols: ['v1', 2], url: 'wss://x' } }, { persistent: true, taskId: 'm2' })).toEqual({
      input: { description: 'ws', timeout_ms: 0, ws: { protocols: ['v1'], url: 'wss://x' } },
      tool: 'Monitor',
      via: 'tool',
    })
    expect(recipe('Bash', { command: 'npm run dev', description: 'dev' }, { backgroundTaskId: 'b1' })).toEqual({
      input: { command: 'npm run dev', description: 'dev', run_in_background: true },
      tool: 'Bash',
      via: 'tool',
    })
    expect(recipe('CronCreate', { cron: '*/5 * * * *', prompt: 'check CI', recurring: false }, { id: 'c1' })).toEqual({
      input: { cron: '*/5 * * * *', prompt: 'check CI', recurring: false },
      tool: 'CronCreate',
      via: 'tool',
    })
    expect(recipe('Agent', { description: 'map' }, { agentId: 'a1', status: 'async_launched' })).toEqual({ agentId: 'a1', via: 'rehire' })
    expect(recipe('Agent', { description: 'map' }, { status: 'remote_launched', taskId: 'r1' })).toBeUndefined()
    expect(recipe('ScheduleWakeup', { delaySeconds: 60, prompt: '/babysit s1' }, { scheduledFor: 60_000 })).toEqual({ args: '/babysit s1', via: 'loop' })
    expect(recipe('ScheduleWakeup', { delaySeconds: 60, prompt: '<<autonomous-loop-dynamic>>' }, { scheduledFor: 60_000 })).toBeUndefined()
    expect(recipe('ScheduleWakeup', { delaySeconds: 60 }, { scheduledFor: 60_000 })).toBeUndefined()
    expect(recipe('Workflow', { name: 'qa' }, { status: 'async_launched', taskId: 'w1' })).toBeUndefined()
  })

  test('a snapshot shell has a recipe only when its whole command is there, and the recipe from the tool call wins', async () => {
    const shell = (id: string, command?: string) => ({ description: 'dev', id, status: 'running', type: 'shell', ...(command === undefined ? {} : { command }) })
    const list = fromStopSnapshot([], { tasks: [shell('b1', 'npm run dev'), shell('b2', 'npm run x... [+1200 chars]'), shell('b3')] }, 0, false)

    expect(list.map(monitor => monitor.relaunch)).toEqual([
      { input: { command: 'npm run dev', description: 'dev', run_in_background: true }, tool: 'Bash', via: 'tool' },
      undefined,
      undefined,
    ])

    const fromTool = started(fromToolCall('Bash', { command: 'npm run dev -- --port 3' }, { backgroundTaskId: 'b1' }, 0))
    const merged = fromStopSnapshot([fromTool], { tasks: [shell('b1', 'npm run dev')] }, 10, false)

    expect(merged[0]?.relaunch).toEqual(fromTool.relaunch)
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

type Node = { name: string; props: Record<string, unknown> }

const stub = (name: string) => (props: Record<string, unknown>): Node => ({ name, props })

const nodes = (tree: unknown): Node[] => {
  if (Array.isArray(tree)) {
    return tree.flatMap(nodes)
  }
  if (typeof tree !== 'object' || tree === null) {
    return []
  }

  const node = tree as Node

  return [node, ...nodes(node.props.children)]
}

const textOf = (tree: unknown): string => {
  if (Array.isArray(tree)) {
    return tree.map(textOf).join('')
  }
  if (typeof tree === 'string') {
    return tree
  }

  if (typeof tree !== 'object' || tree === null) {
    return ''
  }

  const { children, label } = (tree as Node).props

  return `${typeof label === 'string' ? label : ''}${textOf(children)}`
}

const drawn = (
  monitors: DeckMonitor[],
  data: Partial<MonitorsSectionData> = {},
  actions: Partial<MonitorsSectionActions> = {},
  kitElements: Record<string, unknown> = {},
) => {
  const kit = {
    Box: stub('Box'),
    Button: stub('Button'),
    Input: stub('Input'),
    Select: stub('Select'),
    Text: stub('Text'),
    frame: 0,
    icon: iconsOf('ascii'),
    iconSet: 'ascii' as const,
    isAnimated: false,
    theme: paletteOf('aurora'),
    ...kitElements,
  }
  const tree = monitorsSection(
    kit as never,
    { confirm: '', monitors, now: 10 * MINUTE, selected: '', ...data },
    { refresh: () => undefined, select: () => undefined, act: () => undefined, ...actions },
    100,
  )
  const all = nodes(tree)

  return {
    all,
    button: (key: string) => all.find(node => node.name === 'Button' && node.props.key === key),
    has: (key: string) => all.some(node => node.props.key === key),
    text: textOf(tree),
  }
}

const press = (node: Node | undefined): void => {
  const onPress = node?.props.onPress

  if (typeof onPress !== 'function') {
    throw new Error('no button to press')
  }
  onPress()
}

const selecting = (id: string) => ({ selected: selectKey(id) })

describe('the Monitors section', () => {
  const cron = row('c1', { canCancel: true, canStop: false, kind: 'cron', status: 'active' })
  const ended = (id: string, fields: Partial<DeckMonitor> = {}) =>
    row(id, { canStop: false, endedAt: 9 * MINUTE, endedBy: 'report', status: 'done', ...fields })

  test('a selected running row offers Stop, an active cron Cancel, an ended shell Relaunch', async () => {
    const shell = ended('b1', { relaunch: { input: { command: 'npm run dev', run_in_background: true }, tool: 'Bash', via: 'tool' } })
    const relaunched: string[] = []
    const acted: string[] = []
    const actions = { act: (action: string, id: string) => acted.push(`${action}:${id}`), relaunch: (id: string) => relaunched.push(id) }

    press(drawn([row('r1')], selecting('r1'), actions).button('mon-stop-r1'))
    press(drawn([cron], selecting('c1'), actions).button('mon-cancel-c1'))
    press(drawn([shell], selecting('b1'), actions).button('mon-relaunch-b1'))
    expect([acted, relaunched]).toEqual([['stop:r1', 'cancel:c1'], ['b1']])
    expect(drawn([row('r1')]).has('mon-stop-r1')).toBe(false)
  })

  test('Relaunch is drawn only when the actions carry it, and an unplannable row says why', async () => {
    const shell = ended('b1', { relaunch: { input: { command: 'x', run_in_background: true }, tool: 'Bash', via: 'tool' } })
    const sentinel = ended('c2', {
      kind: 'cron',
      relaunch: { input: { cron: '* * * * *', prompt: '<<autonomous-loop>>', recurring: true }, tool: 'CronCreate', via: 'tool' },
    })

    expect(drawn([shell], selecting('b1')).has('mon-relaunch-b1')).toBe(false)
    expect(drawn([sentinel], selecting('c2'), { relaunch: () => undefined }).text).toContain(
      'Relaunch: an autonomous loop belongs to the session that started it',
    )
    expect(drawn([ended('w1', { kind: 'workflow' })], selecting('w1')).text).toContain('workflows cannot be relaunched from the deck')
  })

  test('a second press is asked for with the key the shared confirm atom carries', async () => {
    const shell = ended('b1', { relaunch: { input: { command: 'x', run_in_background: true }, tool: 'Bash', via: 'tool' } })

    expect(drawn([shell], { ...selecting('b1'), confirm: 'relaunch:b1' }, { relaunch: () => undefined }).text).toContain('press l again to relaunch b1')
    expect(drawn([row('r1')], { ...selecting('r1'), confirm: 'stop:r1' }).text).toContain('press s again to stop r1')
  })

  test('New loop shows only with createLoop and an Input and Select, and Run with an empty prompt calls nothing', async () => {
    const created: string[] = []
    const createLoop = (args: string) => created.push(args)

    expect(drawn([]).has('mon-loop-prompt')).toBe(false)
    expect(drawn([], {}, { createLoop }, { Input: undefined }).has('mon-loop-prompt')).toBe(false)
    expect(drawn([], {}, { createLoop }, { Select: undefined }).has('mon-loop-prompt')).toBe(false)

    const empty = drawn([], { loop: { interval: '5m', prompt: '  ' } }, { createLoop })

    expect(empty.has('mon-loop-prompt')).toBe(true)
    press(empty.button('mon-loop-run'))
    expect(created).toEqual([])

    const filled = drawn([], { loop: { interval: '5m', prompt: 'check CI' } }, { createLoop })

    press(filled.button('mon-loop-run'))
    ;(filled.all.find(node => node.name === 'Input')?.props.onSubmit as (value: string) => void)('check CI')
    expect(created).toEqual(['5m check CI', '5m check CI'])
  })

  test('the form hands the person edits back through setLoop', async () => {
    const drafts: unknown[] = []
    const form = drawn([], { loop: { interval: '', prompt: 'a' } }, { createLoop: () => undefined, setLoop: draft => drafts.push(draft) })

    ;(form.all.find(node => node.name === 'Input')?.props.onInput as (value: string) => void)('ab')
    ;(form.all.find(node => node.name === 'Select' && node.props.key === 'mon-loop-interval')?.props.onSelect as (value: string) => void)('1h')
    expect(drafts).toEqual([
      { interval: '', prompt: 'ab' },
      { interval: '1h', prompt: 'a' },
    ])
  })

  test('the keep-awake chip and selector need the data and setKeepAwake', async () => {
    const awake = { how: 'caffeinate', isHeld: true }

    expect(drawn([]).has('mon-keep-awake')).toBe(false)
    expect(drawn([], { awake, keepAwake: 'always' }).has('mon-awake')).toBe(true)
    expect(drawn([], { awake, keepAwake: 'always' }).has('mon-keep-awake')).toBe(false)
    expect(drawn([], { awake, keepAwake: 'always' }, { setKeepAwake: () => undefined }).has('mon-keep-awake')).toBe(true)
    expect(drawn([], { awake, keepAwake: 'always' }, { setKeepAwake: () => undefined }, { Select: undefined }).has('mon-keep-awake')).toBe(false)
  })

  test('rows group as Running, Active and Ended, the last 10 ended, each ended status in its color', async () => {
    const theme = paletteOf('aurora')
    const statuses: DeckMonitorStatus[] = ['done', 'stopped', 'canceled', 'killed', 'dead']
    const list = [row('r1'), cron, ...statuses.map(status => ended(`e-${status}`, { rawStatus: status === 'killed' ? 'killed (sigterm)' : undefined, status }))]
    const view = drawn(list)
    const colorOf = (word: string) => view.all.find(node => node.name === 'Text' && node.props.color !== undefined && textOf(node).trim() === word)?.props.color

    expect(view.text).toMatch(/Running[\s\S]*r1[\s\S]*Active[\s\S]*c1[\s\S]*Ended/)
    expect(view.text).not.toContain('Ended (last 10)')
    expect([colorOf('done'), colorOf('stopped'), colorOf('canceled'), colorOf('killed (sigterm)'), colorOf('dead')]).toEqual([
      theme.good,
      theme.warn,
      theme.warn,
      theme.bad,
      theme.bad,
    ])

    const many = drawn(Array.from({ length: 12 }, (_, index) => ended(`d${index}`, { endedAt: index })))

    expect(many.text).toContain('Ended (last 10)')
    expect(many.all.filter(node => node.name === 'Button' && String(node.props.key).startsWith('sel-mon-'))).toHaveLength(10)
  })

  test('"no end report seen" renders dimmed, apart from the rest of the detail', async () => {
    const view = drawn([ended('m1', { detail: `tail -f log · ${NO_END_REPORT}` })])
    const dim = view.all.filter(node => node.name === 'Text' && node.props.dimColor === true && textOf(node) === NO_END_REPORT)

    expect(dim).toHaveLength(1)
    expect(view.text).toContain('tail -f log')
  })
})
