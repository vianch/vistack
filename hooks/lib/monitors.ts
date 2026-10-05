// Long-running work in flight: background shells, Monitor watches, background agents and
// workflows, /loop wakeups, session crons, and viStack run monitors. Pure: every source is
// turned into rows here and merged by id; register.tsx feeds the sources in.
import { isWorking } from './org'

import type { DeckAgent, DeckRun } from '../../types'

export type DeckMonitorKind = 'monitor' | 'shell' | 'agent' | 'workflow' | 'wakeup' | 'cron' | 'run-monitor' | 'other'

export type DeckMonitorStatus = 'running' | 'scheduled' | 'done' | 'stopped' | 'failed' | 'unknown'

export type DeckMonitorSource = 'tool' | 'stop-snapshot' | 'state-file' | 'agent-list'

// One row per id: the task id TaskStop takes, the cron id CronDelete takes, or a key of our own
// where the engine gives none (`wakeup:<fire time>`, `run:<root>/<slug>`).
export type DeckMonitor = {
  id: string
  kind: DeckMonitorKind
  label: string
  detail: string
  status: DeckMonitorStatus
  startedAt: number
  endedAt?: number
  nextAt?: number
  deadlineAt?: number
  source: DeckMonitorSource
  canStop: boolean
  canCancel: boolean
  schedule?: string
  isRecurring?: boolean
  // A /loop wakeup, which ScheduleWakeup { stop: true } ends.
  isLoop?: boolean
}

// The Stop and SubagentStop hooks' `background_tasks` and `session_crons` entries.
export type TaskSummary = {
  id: string
  type: string
  status: string
  description: string
  command?: string
  agent_type?: string
  server?: string
  tool?: string
  name?: string
}

export type CronSummary = { id: string; schedule: string; recurring: boolean; prompt: string }

// A CronList result's `jobs` entry.
export type CronJob = { id: string; cron: string; humanSchedule?: string; prompt: string; recurring?: boolean }

export type MonitorChange =
  | { change: 'start'; monitor: DeckMonitor }
  | { change: 'end'; id: string; at: number }
  | { change: 'end-wakeups'; at: number }

export type StopCall = { tool: 'TaskStop'; task_id: string } | { tool: 'CronDelete'; id: string } | { tool: 'ScheduleWakeup'; stop: true }

export type StopPlan = { isAllowed: true; verb: 'stop' | 'cancel'; call: StopCall } | { isAllowed: false; reason: string }

export type MonitorSummary = Record<DeckMonitorStatus, number> & { longRunning: number; longest?: DeckMonitor }

export const MONITOR_CAP = 80
export const LONG_RUNNING_MS = 10 * 60_000
// Work scheduled this soon still counts as work, so a /loop between wakeups keeps the machine up.
export const SOON_MS = 30 * 60_000
// A wakeup or a one-shot cron is taken as fired this long after its time.
const FIRE_GRACE_MS = 2 * 60_000
// CronCreate's recurring jobs auto-expire after 7 days.
const CRON_EXPIRY_MS = 7 * 24 * 3_600_000
const CRON_HORIZON_MS = 366 * 24 * 3_600_000
const LOOP_DYNAMIC = '<<autonomous-loop-dynamic>>'
const LOOP_CRON = '<<autonomous-loop>>'
const TASK_KINDS: readonly DeckMonitorKind[] = ['monitor', 'shell', 'agent', 'workflow', 'other']

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

export const isOpen = (monitor: DeckMonitor): boolean => monitor.status === 'running' || monitor.status === 'scheduled'

export const isFinished = (monitor: DeckMonitor): boolean =>
  monitor.status === 'done' || monitor.status === 'stopped' || monitor.status === 'failed'

type Fields = Omit<DeckMonitor, 'canStop' | 'canCancel'>

const make = (fields: Fields): DeckMonitor => ({
  ...fields,
  canCancel: fields.kind === 'cron' || (fields.kind === 'wakeup' && fields.isLoop === true),
  canStop: TASK_KINDS.includes(fields.kind),
})

const start = (fields: Fields): MonitorChange => ({ change: 'start', monitor: make(fields) })

const ended = (monitor: DeckMonitor, status: DeckMonitorStatus, at: number): DeckMonitor => ({ ...monitor, endedAt: at, status })

const promptLabel = (prompt: string): string => {
  if (prompt === LOOP_DYNAMIC) {
    return 'loop wakeup'
  }

  return prompt === LOOP_CRON ? 'autonomous loop' : prompt
}

// ─── Cron ───────────────────────────────────────────────────────────────────

// minute, hour, day of month, month, day of week (7 is Sunday too).
const CRON_FIELDS: readonly (readonly [number, number])[] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
]

const cronField = (field: string, low: number, high: number): Set<number> | null => {
  const values = new Set<number>()

  for (const part of field.split(',')) {
    const [range = '', stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    const [first = '', last] = range.split('-')
    const from = range === '*' ? low : Number(first)
    const isOpenEnded = range === '*' || (last === undefined && stepText !== undefined)
    const to = isOpenEnded ? high : last === undefined ? from : Number(last)

    if (first === '' || !Number.isInteger(step) || step < 1 || !Number.isInteger(from) || !Number.isInteger(to) || from < low || to > high || from > to) {
      return null
    }
    for (let value = from; value <= to; value += step) {
      values.add(value)
    }
  }

  return values
}

// The first minute at or after `from` that a 5-field cron expression matches, in local time.
export const nextCronAt = (expression: string, from: number): number | undefined => {
  const fields = expression.trim().split(/\s+/)

  if (fields.length !== CRON_FIELDS.length) {
    return undefined
  }

  const sets = fields.map((field, index) => cronField(field, CRON_FIELDS[index]?.[0] ?? 0, CRON_FIELDS[index]?.[1] ?? 0))
  const [minutes = null, hours = null, days = null, months = null, weekdays = null] = sets

  if (minutes === null || hours === null || days === null || months === null || weekdays === null) {
    return undefined
  }
  if (weekdays.has(7)) {
    weekdays.add(0)
  }

  const isDayOpen = fields[2] === '*'
  const isWeekdayOpen = fields[4] === '*'
  const at = new Date(from)

  at.setSeconds(0, 0)
  if (at.getTime() < from) {
    at.setMinutes(at.getMinutes() + 1)
  }
  while (at.getTime() - from <= CRON_HORIZON_MS) {
    const dayHit = days.has(at.getDate())
    const weekdayHit = weekdays.has(at.getDay())
    // Cron's rule: with both day fields restricted, either one matching is enough.
    const isDay = isDayOpen || isWeekdayOpen ? dayHit && weekdayHit : dayHit || weekdayHit

    if (!months.has(at.getMonth() + 1)) {
      at.setMonth(at.getMonth() + 1, 1)
      at.setHours(0, 0)
    } else if (!isDay) {
      at.setDate(at.getDate() + 1)
      at.setHours(0, 0)
    } else if (!hours.has(at.getHours())) {
      at.setHours(at.getHours() + 1, 0)
    } else if (!minutes.has(at.getMinutes())) {
      at.setMinutes(at.getMinutes() + 1)
    } else {
      return at.getTime()
    }
  }

  return undefined
}

// ─── Sources ────────────────────────────────────────────────────────────────

// What one finished tool call starts or ends; null for calls that touch no long-running work.
// `result` is the call's structured result (`ran.result`), not the hook's whole answer.
export const fromToolCall = (tool: string, input: unknown, result: unknown, at: number): MonitorChange | null => {
  const args = record(input)
  const out = record(result)

  switch (tool) {
    case 'Monitor': {
      const id = str(out.taskId)
      const timeoutMs = num(out.timeoutMs) ?? 0

      if (id === undefined) {
        return null
      }

      return start({
        detail: str(args.command) ?? str(record(args.ws).url) ?? '',
        id,
        kind: 'monitor',
        label: str(args.description) ?? 'monitor',
        source: 'tool',
        startedAt: at,
        status: 'running',
        ...(timeoutMs > 0 && out.persistent !== true ? { deadlineAt: at + timeoutMs } : {}),
      })
    }
    case 'Bash': {
      // Set for run_in_background, and also for a command the person or a timeout backgrounded.
      const id = str(out.backgroundTaskId)
      const command = str(args.command) ?? ''

      if (id === undefined) {
        return null
      }

      return start({ detail: command, id, kind: 'shell', label: str(args.description) ?? command, source: 'tool', startedAt: at, status: 'running' })
    }
    case 'Agent': {
      const id = out.status === 'async_launched' ? str(out.agentId) : out.status === 'remote_launched' ? str(out.taskId) : undefined

      if (id === undefined) {
        return null
      }

      return start({
        detail: str(out.sessionUrl) ?? str(args.subagent_type) ?? 'general-purpose',
        id,
        kind: 'agent',
        label: str(args.name) ?? str(args.description) ?? 'agent',
        source: 'tool',
        startedAt: at,
        status: 'running',
      })
    }
    case 'Workflow': {
      const id = str(out.taskId)

      if (id === undefined || str(out.error) !== undefined) {
        return null
      }

      return start({
        detail: str(out.summary) ?? str(out.scriptPath) ?? '',
        id,
        kind: 'workflow',
        label: str(out.workflowName) ?? str(args.name) ?? 'workflow',
        source: 'tool',
        startedAt: at,
        status: 'running',
      })
    }
    case 'ScheduleWakeup': {
      if (args.stop === true) {
        return { at, change: 'end-wakeups' }
      }

      const delay = num(args.delaySeconds)
      const nextAt = num(out.scheduledFor) ?? (delay === undefined ? undefined : at + delay * 1000)

      if (nextAt === undefined) {
        return null
      }

      // The result names no id; the fire time is unique per pending wakeup.
      return start({
        detail: str(args.reason) ?? str(args.prompt) ?? '',
        id: `wakeup:${nextAt}`,
        isLoop: true,
        kind: 'wakeup',
        label: promptLabel(str(args.prompt) ?? LOOP_DYNAMIC),
        nextAt,
        source: 'tool',
        startedAt: at,
        status: 'scheduled',
      })
    }
    case 'CronCreate': {
      const id = str(out.id)
      const schedule = str(args.cron)
      const isRecurring = typeof out.recurring === 'boolean' ? out.recurring : args.recurring !== false
      const nextAt = schedule === undefined ? undefined : nextCronAt(schedule, at)

      if (id === undefined) {
        return null
      }

      return start({
        detail: str(out.humanSchedule) ?? schedule ?? '',
        id,
        isRecurring,
        kind: 'cron',
        label: promptLabel(str(args.prompt) ?? 'cron'),
        source: 'tool',
        startedAt: at,
        status: 'scheduled',
        ...(schedule === undefined ? {} : { schedule }),
        ...(nextAt === undefined ? {} : { nextAt }),
        ...(isRecurring ? { deadlineAt: at + CRON_EXPIRY_MS } : {}),
      })
    }
    case 'CronDelete':
    case 'TaskStop': {
      const id = str(out.task_id) ?? str(out.id) ?? str(args.task_id) ?? str(args.shell_id) ?? str(args.id)

      return id === undefined ? null : { at, change: 'end', id }
    }
    default:
      return null
  }
}

const fromTask = (task: TaskSummary, at: number): DeckMonitor => {
  const kinds: Readonly<Record<string, DeckMonitorKind>> = { monitor: 'monitor', shell: 'shell', subagent: 'agent', workflow: 'workflow' }
  const statuses: Readonly<Record<string, DeckMonitorStatus>> = {
    completed: 'done',
    error: 'failed',
    failed: 'failed',
    killed: 'stopped',
    stopped: 'stopped',
  }
  const tool = task.server === undefined ? task.tool : `${task.server}/${task.tool ?? ''}`

  return make({
    detail: task.command ?? task.agent_type ?? tool ?? task.name ?? task.type,
    id: task.id,
    kind: kinds[task.type] ?? 'other',
    label: task.description || task.name || task.type,
    source: 'stop-snapshot',
    startedAt: at,
    status: statuses[task.status] ?? 'running',
  })
}

const isLoopPrompt = (prompt: string): boolean => prompt === LOOP_DYNAMIC || /^\/loop\b/.test(prompt)

const fromCron = (cron: CronSummary, list: readonly DeckMonitor[], at: number, humanSchedule?: string): DeckMonitor[] => {
  const nextAt = nextCronAt(cron.schedule, at)
  const known = list.find(monitor => monitor.id === cron.id)

  if (known === undefined && !cron.recurring) {
    // A ScheduleWakeup result names no id, so its pending wakeup shows up here under a cron id
    // of its own: fold it into the wakeup the tool call already recorded.
    const twin = list.find(
      monitor =>
        monitor.kind === 'wakeup' &&
        monitor.source === 'tool' &&
        isOpen(monitor) &&
        (nextAt === undefined || monitor.nextAt === undefined || Math.abs(monitor.nextAt - nextAt) <= FIRE_GRACE_MS),
    )

    if (twin !== undefined) {
      return []
    }
  }

  const kind = known?.kind ?? (!cron.recurring && isLoopPrompt(cron.prompt) ? 'wakeup' : 'cron')

  return [
    make({
      detail: humanSchedule ?? cron.schedule,
      id: cron.id,
      isRecurring: cron.recurring,
      kind,
      label: promptLabel(cron.prompt || 'cron'),
      schedule: cron.schedule,
      source: 'stop-snapshot',
      startedAt: at,
      status: 'scheduled',
      ...(kind === 'wakeup' ? { isLoop: true } : {}),
      ...(nextAt === undefined ? {} : { nextAt }),
    }),
  ]
}

// Rows `covers` names that are still open but missing from `incoming` have ended.
const reconcile = (
  list: readonly DeckMonitor[],
  incoming: readonly DeckMonitor[],
  covers: (monitor: DeckMonitor) => boolean,
  at: number,
  cap: number,
): DeckMonitor[] => {
  const seen = new Set(incoming.map(monitor => monitor.id))
  const retired = list.map(monitor => (covers(monitor) && isOpen(monitor) && !seen.has(monitor.id) ? ended(monitor, 'done', at) : monitor))

  return mergeMonitors(retired, incoming, cap)
}

const isTaskRow = (monitor: DeckMonitor): boolean => TASK_KINDS.includes(monitor.kind)

// A tool-recorded wakeup has no engine id to look for, so it ends by time, by stop, or when superseded.
const isCronRow = (monitor: DeckMonitor): boolean => monitor.kind === 'cron' || (monitor.kind === 'wakeup' && monitor.source !== 'tool')

// The Stop hook's view of what is in flight. A family the hook left out (undefined) says nothing;
// a family it sent, even empty, is the whole truth, so open rows missing from it are done.
// `isComplete: false` merges without retiring anything (SubagentStop, whose scope is unverified).
export const fromStopSnapshot = (
  list: readonly DeckMonitor[],
  snapshot: { tasks?: readonly TaskSummary[] | undefined; crons?: readonly CronSummary[] | undefined },
  at: number,
  isComplete = true,
  cap = MONITOR_CAP,
): DeckMonitor[] => {
  let next = [...list]

  if (snapshot.tasks !== undefined) {
    const incoming = snapshot.tasks.map(task => fromTask(task, at))

    next = isComplete ? reconcile(next, incoming, isTaskRow, at, cap) : mergeMonitors(next, incoming, cap)
  }
  if (snapshot.crons !== undefined) {
    const before = next
    const incoming = snapshot.crons.flatMap(cron => fromCron(cron, before, at))

    next = isComplete ? reconcile(next, incoming, isCronRow, at, cap) : mergeMonitors(next, incoming, cap)
  }

  return next
}

// A CronList answer: the whole set of CronCreate jobs. Wakeups are left alone; whether CronList
// lists them is not documented.
export const fromCronList = (list: readonly DeckMonitor[], jobs: readonly CronJob[], at: number, cap = MONITOR_CAP): DeckMonitor[] => {
  const incoming = jobs.flatMap(job =>
    fromCron({ id: job.id, prompt: job.prompt, recurring: job.recurring !== false, schedule: job.cron }, list, at, job.humanSchedule),
  )

  return reconcile(list, incoming, monitor => monitor.kind === 'cron', at, cap)
}

const RUN_STATUS: Readonly<Record<string, DeckMonitorStatus>> = {
  active: 'running',
  complete: 'done',
  completed: 'done',
  done: 'done',
  error: 'failed',
  failed: 'failed',
  finished: 'done',
  paused: 'stopped',
  running: 'running',
  stopped: 'stopped',
}

// viStack run monitors from the state files (`monitor.status`). The file is only a claim: the
// live mechanism is the run's /loop wakeup or cron, listed on its own row.
export const fromRuns = (list: readonly DeckMonitor[], runs: readonly DeckRun[], at: number, cap = MONITOR_CAP): DeckMonitor[] => {
  const incoming = runs.flatMap(run =>
    run.monitor === undefined
      ? []
      : [
          make({
            detail: [run.playbook, run.monitor, run.objective].filter(part => part !== undefined && part !== '').join(' · '),
            id: `run:${run.root}/${run.slug}`,
            kind: 'run-monitor',
            label: `${run.slug} monitor`,
            source: 'state-file',
            startedAt: at,
            status: RUN_STATUS[run.monitor.toLowerCase()] ?? 'unknown',
          }),
        ],
  )

  return reconcile(list, incoming, monitor => monitor.kind === 'run-monitor', at, cap)
}

// Background agents end when the agent list says they did.
export const fromAgents = (list: readonly DeckMonitor[], agents: readonly DeckAgent[], at: number): DeckMonitor[] => {
  const statuses: Readonly<Record<string, DeckMonitorStatus>> = { completed: 'done', failed: 'failed', killed: 'stopped' }

  return list.map(monitor => {
    const agent = monitor.kind === 'agent' && isOpen(monitor) ? agents.find(one => one.agentId === monitor.id) : undefined

    return agent === undefined || isWorking(agent) ? monitor : ended(monitor, statuses[agent.status] ?? 'done', agent.endedAt ?? at)
  })
}

// ─── List upkeep ────────────────────────────────────────────────────────────

// Finished rows go oldest first once the list passes the cap; open rows always stay.
const capped = (list: readonly DeckMonitor[], cap: number): DeckMonitor[] => {
  const finished = list.filter(isFinished)

  if (list.length <= cap || finished.length === 0) {
    return [...list]
  }

  const room = Math.max(0, cap - (list.length - finished.length))
  const kept = new Set(
    [...finished]
      .sort((left, right) => (right.endedAt ?? right.startedAt) - (left.endedAt ?? left.startedAt))
      .slice(0, room)
      .map(monitor => monitor.id),
  )

  return list.filter(monitor => !isFinished(monitor) || kept.has(monitor.id))
}

// Upsert by id. A row that ended stays ended (a late report never revives it), except a run
// monitor, whose state file may restart it. The first sighting's start time is kept.
export const mergeMonitors = (list: readonly DeckMonitor[], incoming: readonly DeckMonitor[], cap = MONITOR_CAP): DeckMonitor[] => {
  const byId = new Map(list.map(monitor => [monitor.id, monitor]))

  for (const monitor of incoming) {
    const before = byId.get(monitor.id)

    if (before === undefined) {
      byId.set(monitor.id, monitor)
    } else if (!isFinished(before) || before.kind === 'run-monitor') {
      byId.set(monitor.id, {
        ...before,
        ...monitor,
        source: before.source,
        startedAt: Math.min(before.startedAt, monitor.startedAt),
        ...(before.isLoop === true ? { isLoop: true, canCancel: before.canCancel } : {}),
      })
    }
  }

  return capped([...byId.values()], cap)
}

export const applyChange = (list: readonly DeckMonitor[], change: MonitorChange, cap = MONITOR_CAP): DeckMonitor[] => {
  switch (change.change) {
    case 'start': {
      const { monitor } = change
      // A dynamic /loop holds one pending wakeup: scheduling the next means the last one fired.
      const before =
        monitor.kind === 'wakeup'
          ? list.map(one => (one.kind === 'wakeup' && one.source === 'tool' && isOpen(one) ? ended(one, 'done', monitor.startedAt) : one))
          : list

      return mergeMonitors(before, [monitor], cap)
    }
    case 'end':
      return list.map(monitor => (monitor.id === change.id && isOpen(monitor) ? ended(monitor, 'stopped', change.at) : monitor))
    case 'end-wakeups':
      return list.map(monitor => (monitor.kind === 'wakeup' && isOpen(monitor) ? ended(monitor, 'stopped', change.at) : monitor))
  }
}

// Time passing: wakeups and one-shot crons past their fire time are done, recurring crons move to
// their next fire, Monitor watches past their deadline are done.
export const settle = (list: readonly DeckMonitor[], now: number): DeckMonitor[] =>
  list.map(monitor => {
    if (monitor.status === 'scheduled' && monitor.nextAt !== undefined && now > monitor.nextAt + FIRE_GRACE_MS) {
      if (monitor.isRecurring === true && monitor.schedule !== undefined && (monitor.deadlineAt === undefined || now < monitor.deadlineAt)) {
        const nextAt = nextCronAt(monitor.schedule, now)

        return nextAt === undefined ? ended(monitor, 'done', now) : { ...monitor, nextAt }
      }

      return ended(monitor, 'done', monitor.isRecurring === true ? now : monitor.nextAt)
    }
    if (monitor.status === 'running' && monitor.deadlineAt !== undefined && now > monitor.deadlineAt + FIRE_GRACE_MS) {
      return ended(monitor, 'done', monitor.deadlineAt)
    }

    return monitor
  })

// ─── Reading the list ───────────────────────────────────────────────────────

export const isLongRunning = (monitor: DeckMonitor, now: number, thresholdMs = LONG_RUNNING_MS): boolean =>
  monitor.status === 'running' && now - monitor.startedAt >= thresholdMs

const RANK: Readonly<Record<DeckMonitorStatus, number>> = { done: 3, failed: 3, running: 0, scheduled: 1, stopped: 3, unknown: 2 }

// Running work first, the longest-running on top; then scheduled by next fire; then unknown; then
// finished, newest first.
export const sortMonitors = (list: readonly DeckMonitor[]): DeckMonitor[] =>
  [...list].sort((left, right) => {
    const byRank = RANK[left.status] - RANK[right.status]

    if (byRank !== 0) {
      return byRank
    }
    if (left.status === 'running') {
      return left.startedAt - right.startedAt
    }
    if (left.status === 'scheduled') {
      return (left.nextAt ?? Number.MAX_SAFE_INTEGER) - (right.nextAt ?? Number.MAX_SAFE_INTEGER)
    }

    return (right.endedAt ?? right.startedAt) - (left.endedAt ?? left.startedAt)
  })

export const summary = (list: readonly DeckMonitor[], now: number): MonitorSummary => {
  const counts: Record<DeckMonitorStatus, number> = { done: 0, failed: 0, running: 0, scheduled: 0, stopped: 0, unknown: 0 }
  let longest: DeckMonitor | undefined

  for (const monitor of list) {
    counts[monitor.status] += 1
    if (monitor.status === 'running' && (longest === undefined || monitor.startedAt < longest.startedAt)) {
      longest = monitor
    }
  }

  return {
    ...counts,
    longRunning: list.filter(monitor => isLongRunning(monitor, now)).length,
    ...(longest === undefined ? {} : { longest }),
  }
}

// Whether the session has work in flight: a turn, a live agent, a running monitor, or something
// scheduled within SOON_MS. Run-monitor rows are claims from a file, so they never count.
export const isSessionWorking = (input: {
  monitors: readonly DeckMonitor[]
  agents: readonly DeckAgent[]
  isTurnRunning: boolean
  now: number
}): boolean =>
  input.isTurnRunning ||
  input.agents.some(isWorking) ||
  input.monitors.some(
    monitor =>
      monitor.kind !== 'run-monitor' &&
      (monitor.status === 'running' || (monitor.status === 'scheduled' && monitor.nextAt !== undefined && monitor.nextAt - input.now <= SOON_MS)),
  )

// The tool call that stops or cancels a row, or why there is none.
export const stopCall = (monitor: DeckMonitor): StopPlan => {
  if (isFinished(monitor)) {
    return { isAllowed: false, reason: `already ${monitor.status}` }
  }
  if (monitor.kind === 'run-monitor') {
    return { isAllowed: false, reason: "the run's monitor is its /loop: cancel that wakeup or cron" }
  }
  if (monitor.kind === 'cron') {
    return { call: { id: monitor.id, tool: 'CronDelete' }, isAllowed: true, verb: 'cancel' }
  }
  if (monitor.kind === 'wakeup') {
    return monitor.isLoop === true
      ? { call: { stop: true, tool: 'ScheduleWakeup' }, isAllowed: true, verb: 'cancel' }
      : { isAllowed: false, reason: 'not a /loop wakeup, so ScheduleWakeup cannot cancel it' }
  }

  return { call: { task_id: monitor.id, tool: 'TaskStop' }, isAllowed: true, verb: 'stop' }
}

// The change a successful stop call makes. The deck's own tool calls skip its tool.call hook, so
// the stop job applies this itself.
export const stoppedBy = (call: StopCall, at: number): MonitorChange => {
  switch (call.tool) {
    case 'TaskStop':
      return { at, change: 'end', id: call.task_id }
    case 'CronDelete':
      return { at, change: 'end', id: call.id }
    case 'ScheduleWakeup':
      return { at, change: 'end-wakeups' }
  }
}

// One call per distinct target for "stop all": every loop wakeup shares one ScheduleWakeup stop.
export const stopAllCalls = (list: readonly DeckMonitor[]): StopCall[] => {
  const calls = new Map<string, StopCall>()

  for (const monitor of list) {
    const plan = stopCall(monitor)

    if (plan.isAllowed) {
      calls.set(JSON.stringify(plan.call), plan.call)
    }
  }

  return [...calls.values()]
}
