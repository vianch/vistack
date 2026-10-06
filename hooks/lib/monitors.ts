// Long-running work in flight: background shells, Monitor watches, background agents and
// workflows, /loop wakeups, session crons, and viStack run monitors. Pure: every source is
// turned into rows here and merged by id; register.tsx feeds the sources in.
import { isWorking } from './org'

import type {
  CronJob,
  CronSummary,
  DeckAgent,
  DeckMonitor,
  DeckMonitorEnd,
  DeckMonitorKind,
  DeckMonitorStatus,
  DeckRun,
  MonitorChange,
  MonitorEndNote,
  MonitorRelaunch,
  MonitorSummary,
  StopCall,
  StopPlan,
  TaskSummary,
} from '../../types'

export const MONITOR_CAP = 80
export const LONG_RUNNING_MS = 10 * 60_000
// Work scheduled this soon still counts as work, so a /loop between wakeups keeps the machine up.
export const SOON_MS = 30 * 60_000
// A wakeup or a one-shot cron is taken as fired this long after its time.
const FIRE_GRACE_MS = 2 * 60_000
// A task that should have ended waits this long for its end report, which reaches the session on
// its next turn.
export const ABSENT_GRACE_MS = 2 * 60_000
export const NO_END_REPORT = 'no end report seen'
const NO_END_SUFFIX = ` · ${NO_END_REPORT}`
const ENDED_WITH_AGENT = 'ended with its agent'
// The engine caps a snapshot's strings at 1000 characters and marks the cut this way.
const CLIPPED = /\.\.\. \[\+\d+ chars\]$/
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

const isOpenStatus = (status: DeckMonitorStatus): boolean => status === 'running' || status === 'active'

export const isOpen = (monitor: DeckMonitor): boolean => isOpenStatus(monitor.status)

export const isFinished = (monitor: DeckMonitor): boolean => !isOpen(monitor)

// The end words of task notifications, the Stop snapshot and the agent list.
const END_STATUS: Readonly<Record<string, DeckMonitorStatus>> = {
  completed: 'done',
  error: 'dead',
  failed: 'dead',
  killed: 'killed',
  stopped: 'stopped',
}

type Fields = Omit<DeckMonitor, 'canStop' | 'canCancel'>

// A notification row's `task`, the engine's UserMessageTask by shape.
type NotifiedTask = {
  id?: string | undefined
  status?: string | undefined
  type?: string | undefined
  toolUseId?: string | undefined
  durationMs?: number | undefined
}

const make = (fields: Fields): DeckMonitor => ({
  ...fields,
  canCancel: fields.status === 'active' && (fields.kind === 'cron' || (fields.kind === 'wakeup' && fields.isLoop === true)),
  canStop: fields.status === 'running' && TASK_KINDS.includes(fields.kind),
})

const start = (fields: Fields): MonitorChange => ({ change: 'start', monitor: make(fields) })

const ended = (monitor: DeckMonitor, status: DeckMonitorStatus, at: number, endedBy: DeckMonitorEnd): DeckMonitor => {
  const { absentSince: _unused, ...rest } = monitor

  return make({ ...rest, endedAt: at, endedBy, status })
}

const endedFields = (status: DeckMonitorStatus, at: number): Pick<Fields, 'endedAt' | 'endedBy'> =>
  isOpenStatus(status) ? {} : { endedAt: at, endedBy: 'report' }

const withNote = (detail: string, note: string): string => (detail === '' ? note : `${detail} · ${note}`)

const isSentinel = (prompt: string): boolean => prompt === LOOP_DYNAMIC || prompt === LOOP_CRON

const shellRecipe = (command: string, description: string | undefined): MonitorRelaunch => ({
  input: { command, run_in_background: true, ...(description === undefined ? {} : { description }) },
  tool: 'Bash',
  via: 'tool',
})

const monitorRecipe = (args: Record<string, unknown>, timeoutMs: number): MonitorRelaunch | undefined => {
  const command = str(args.command)
  const ws = record(args.ws)
  const url = str(ws.url)
  const protocols = Array.isArray(ws.protocols) ? { protocols: ws.protocols.filter((one): one is string => typeof one === 'string') } : {}
  const target = command !== undefined ? { command } : url !== undefined ? { ws: { url, ...protocols } } : undefined

  if (target === undefined) {
    return undefined
  }

  return { input: { description: str(args.description) ?? 'monitor', timeout_ms: num(args.timeout_ms) ?? timeoutMs, ...target }, tool: 'Monitor', via: 'tool' }
}

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
// `result` is the call's structured result (`ran.result`), not the hook's whole answer, and
// `agentId` the loop the call ran in, absent on the main loop.
export const fromToolCall = (tool: string, input: unknown, result: unknown, at: number, agentId?: string): MonitorChange | null => {
  const args = record(input)
  const out = record(result)

  switch (tool) {
    case 'Monitor': {
      const id = str(out.taskId)
      const timeoutMs = num(out.timeoutMs) ?? 0

      if (id === undefined) {
        return null
      }

      const relaunch = monitorRecipe(args, timeoutMs)

      return start({
        detail: str(args.command) ?? str(record(args.ws).url) ?? '',
        id,
        kind: 'monitor',
        label: str(args.description) ?? 'monitor',
        source: 'tool',
        startedAt: at,
        status: 'running',
        ...(timeoutMs > 0 && out.persistent !== true ? { deadlineAt: at + timeoutMs } : {}),
        ...(relaunch === undefined ? {} : { relaunch }),
      })
    }
    case 'Bash': {
      // Set for run_in_background, and also for a command the person or a timeout backgrounded.
      const id = str(out.backgroundTaskId)
      const command = str(args.command)

      if (id === undefined) {
        return null
      }

      return start({
        detail: command ?? '',
        id,
        kind: 'shell',
        label: str(args.description) ?? command ?? '',
        source: 'tool',
        startedAt: at,
        status: 'running',
        ...(command === undefined ? {} : { relaunch: shellRecipe(command, str(args.description)) }),
        ...(agentId !== undefined && out.backgroundEndsWithFinalResponse === true ? { ownerAgentId: agentId } : {}),
      })
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
        // A remote agent's task id is not an agent the deck can hire again.
        ...(out.status === 'async_launched' ? { relaunch: { agentId: id, via: 'rehire' as const } } : {}),
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
        return { at, change: 'end-wakeups', endedBy: 'report' }
      }

      const delay = num(args.delaySeconds)
      const nextAt = num(out.scheduledFor) ?? (delay === undefined ? undefined : at + delay * 1000)
      const prompt = str(args.prompt) ?? LOOP_DYNAMIC

      if (nextAt === undefined) {
        return null
      }

      // The result names no id; the fire time is unique per pending wakeup.
      return start({
        detail: str(args.reason) ?? str(args.prompt) ?? '',
        id: `wakeup:${nextAt}`,
        isLoop: true,
        kind: 'wakeup',
        label: promptLabel(prompt),
        nextAt,
        source: 'tool',
        startedAt: at,
        status: 'active',
        // The prompt is the /loop input; a sentinel means the loop had none.
        ...(isSentinel(prompt) ? {} : { relaunch: { args: prompt, via: 'loop' as const } }),
      })
    }
    case 'CronCreate': {
      const id = str(out.id)
      const schedule = str(args.cron)
      const prompt = str(args.prompt)
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
        label: promptLabel(prompt ?? 'cron'),
        source: 'tool',
        startedAt: at,
        status: 'active',
        ...(schedule === undefined ? {} : { schedule }),
        ...(nextAt === undefined ? {} : { nextAt }),
        ...(isRecurring ? { deadlineAt: at + CRON_EXPIRY_MS } : {}),
        ...(schedule === undefined || prompt === undefined
          ? {}
          : { relaunch: { input: { cron: schedule, prompt, recurring: isRecurring }, tool: 'CronCreate' as const, via: 'tool' as const } }),
      })
    }
    case 'CronDelete':
    case 'TaskStop': {
      const id = str(out.task_id) ?? str(out.id) ?? str(args.task_id) ?? str(args.shell_id) ?? str(args.id)

      return id === undefined ? null : { at, change: 'end', endedBy: 'report', id, status: tool === 'CronDelete' ? 'canceled' : 'stopped' }
    }
    default:
      return null
  }
}

const fromTask = (task: TaskSummary, at: number): DeckMonitor => {
  const kinds: Readonly<Record<string, DeckMonitorKind>> = { monitor: 'monitor', shell: 'shell', subagent: 'agent', workflow: 'workflow' }
  const tool = task.server === undefined ? task.tool : `${task.server}/${task.tool ?? ''}`
  const status = END_STATUS[task.status] ?? 'running'
  // A clipped command would run something else.
  const command = task.type === 'shell' && !CLIPPED.test(task.command ?? '') ? str(task.command) : undefined

  return make({
    detail: task.command ?? task.agent_type ?? tool ?? task.name ?? task.type,
    id: task.id,
    kind: kinds[task.type] ?? 'other',
    label: task.description || task.name || task.type,
    rawStatus: task.status,
    source: 'stop-snapshot',
    startedAt: at,
    status,
    ...endedFields(status, at),
    ...(command === undefined ? {} : { relaunch: shellRecipe(command, str(task.description)) }),
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
      status: 'active',
      ...(kind === 'wakeup' ? { isLoop: true } : {}),
      ...(nextAt === undefined ? {} : { nextAt }),
    }),
  ]
}

// Rows `covers` names that are still open but missing from `incoming` go to `gone`.
const reconcile = (
  list: readonly DeckMonitor[],
  incoming: readonly DeckMonitor[],
  covers: (monitor: DeckMonitor) => boolean,
  gone: (monitor: DeckMonitor) => DeckMonitor,
  cap: number,
): DeckMonitor[] => {
  const seen = new Set(incoming.map(monitor => monitor.id))
  const retired = list.map(monitor => (covers(monitor) && isOpen(monitor) && !seen.has(monitor.id) ? gone(monitor) : monitor))

  return mergeMonitors(retired, incoming, cap)
}

const isTaskRow = (monitor: DeckMonitor): boolean => TASK_KINDS.includes(monitor.kind)

// A tool-recorded wakeup has no engine id to look for, so it ends by time, by stop, or when superseded.
const isCronRow = (monitor: DeckMonitor): boolean => monitor.kind === 'cron' || (monitor.kind === 'wakeup' && monitor.source !== 'tool')

// No notification reports a cron, so a missing one has fired, expired or been deleted: done.
const goneDone =
  (at: number) =>
  (monitor: DeckMonitor): DeckMonitor =>
    ended(monitor, 'done', at, 'absence')

// The Stop hook's view of what is in flight. A family the hook left out (undefined) says nothing;
// a family it sent, even empty, is the whole truth. An open task missing from it is marked absent
// and waits for its end report (resolveAbsent); a missing cron is done.
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
    const absent = (monitor: DeckMonitor): DeckMonitor => ({ ...monitor, absentSince: monitor.absentSince ?? at })

    next = isComplete ? reconcile(next, incoming, isTaskRow, absent, cap) : mergeMonitors(next, incoming, cap)
  }
  if (snapshot.crons !== undefined) {
    const before = next
    const incoming = snapshot.crons.flatMap(cron => fromCron(cron, before, at))

    next = isComplete ? reconcile(next, incoming, isCronRow, goneDone(at), cap) : mergeMonitors(next, incoming, cap)
  }

  return next
}

// A CronList answer: the whole set of CronCreate jobs. Wakeups are left alone; whether CronList
// lists them is not documented.
export const fromCronList = (list: readonly DeckMonitor[], jobs: readonly CronJob[], at: number, cap = MONITOR_CAP): DeckMonitor[] => {
  const incoming = jobs.flatMap(job =>
    fromCron({ id: job.id, prompt: job.prompt, recurring: job.recurring !== false, schedule: job.cron }, list, at, job.humanSchedule),
  )

  return reconcile(list, incoming, monitor => monitor.kind === 'cron', goneDone(at), cap)
}

const RUN_STATUS: Readonly<Record<string, DeckMonitorStatus>> = {
  active: 'active',
  complete: 'done',
  completed: 'done',
  done: 'done',
  error: 'dead',
  failed: 'dead',
  finished: 'done',
  paused: 'stopped',
  running: 'running',
  stopped: 'stopped',
}

// viStack run monitors from the state files (`monitor.status`). The file is only a claim: the
// live mechanism is the run's /loop wakeup or cron, listed on its own row.
export const fromRuns = (list: readonly DeckMonitor[], runs: readonly DeckRun[], at: number, cap = MONITOR_CAP): DeckMonitor[] => {
  const incoming = runs.flatMap(run => {
    if (run.monitor === undefined) {
      return []
    }

    const status = RUN_STATUS[run.monitor.toLowerCase()] ?? 'active'

    return [
      make({
        detail: [run.playbook, run.monitor, run.objective].filter(part => part !== undefined && part !== '').join(' · '),
        id: `run:${run.root}/${run.slug}`,
        kind: 'run-monitor',
        label: `${run.slug} monitor`,
        rawStatus: run.monitor,
        source: 'state-file',
        startedAt: at,
        status,
        ...endedFields(status, at),
      }),
    ]
  })

  return reconcile(list, incoming, monitor => monitor.kind === 'run-monitor', goneDone(at), cap)
}

// Background agents end when the agent list says they did, and so does work a synchronous subagent
// owned, which the engine ends with that agent's final response.
export const fromAgents = (list: readonly DeckMonitor[], agents: readonly DeckAgent[], at: number): DeckMonitor[] =>
  list.map(monitor => {
    const watched = monitor.kind === 'agent' ? monitor.id : monitor.ownerAgentId
    const agent = watched === undefined || !isOpen(monitor) ? undefined : agents.find(one => one.agentId === watched)

    if (agent === undefined || isWorking(agent)) {
      return monitor
    }
    if (monitor.kind === 'agent') {
      return { ...ended(monitor, END_STATUS[agent.status] ?? 'done', agent.endedAt ?? at, 'report'), rawStatus: agent.status }
    }

    // The agent's end says nothing of how the command itself went.
    return { ...ended(monitor, 'done', agent.endedAt ?? at, 'report'), detail: withNote(monitor.detail, ENDED_WITH_AGENT) }
  })

// ─── End reports ────────────────────────────────────────────────────────────

const NOTE_BLOCK = /<task-notification>([\s\S]*?)<\/task-notification>/g
const NOTE_TASK_ID = /<task-id>([^<]*)<\/task-id>/
const NOTE_STATUS = /<status>([^<]*)<\/status>/

// The end reports in a user message's `<task-notification>` blocks. A block with no `<status>` is a
// Monitor's stream event, not an end; an assistant message only quotes one.
export const taskNotesFrom = (messages: readonly { role: string; text: string }[]): MonitorEndNote[] =>
  messages.flatMap(message =>
    message.role !== 'user'
      ? []
      : [...message.text.matchAll(NOTE_BLOCK)].flatMap(match => {
          const block = match[1] ?? ''
          const taskId = str(NOTE_TASK_ID.exec(block)?.[1]?.trim())
          const status = str(NOTE_STATUS.exec(block)?.[1]?.trim())

          return taskId === undefined || status === undefined ? [] : [{ status, taskId }]
        }),
  )

// The same end report from a notification row's structured `task` (a UserMessage's `props.task`).
export const noteFromTask = (task: NotifiedTask): MonitorEndNote | null => {
  const taskId = str(task.id)
  const status = str(task.status)

  return taskId === undefined || status === undefined ? null : { status, taskId }
}

const withoutNoEndReport = (detail: string): string => {
  if (detail === NO_END_REPORT) {
    return ''
  }

  return detail.endsWith(NO_END_SUFFIX) ? detail.slice(0, -NO_END_SUFFIX.length) : detail
}

// End reports settle an open row or one that ended by absence; a row something else ended keeps
// its end. A word the deck does not know is left for absence to settle. The last report wins.
export const fromTaskNotifications = (list: readonly DeckMonitor[], notes: readonly MonitorEndNote[], at: number): DeckMonitor[] => {
  const byId = new Map(notes.flatMap(note => (END_STATUS[note.status] === undefined ? [] : [[note.taskId, note] as const])))

  return list.map(monitor => {
    const note = byId.get(monitor.id)
    const status = note === undefined ? undefined : END_STATUS[note.status]

    if (note === undefined || status === undefined || !(isOpen(monitor) || monitor.endedBy === 'absence')) {
      return monitor
    }

    return {
      ...ended(monitor, status, monitor.endedAt ?? monitor.absentSince ?? at, 'report'),
      detail: withoutNoEndReport(monitor.detail),
      rawStatus: note.status,
    }
  })
}

// Since when a running task should have reported its end: a complete snapshot left it out, or its
// Monitor deadline passed. A task with neither runs until a report comes; no timeout is assumed.
const unreportedSince = (monitor: DeckMonitor): number | undefined =>
  monitor.absentSince ?? (monitor.status === 'running' ? monitor.deadlineAt : undefined)

// A task unreported past the grace has ended. Dead once this session's end reports are known to
// arrive, since its own never did; until then done, saying no report was seen.
export const resolveAbsent = (list: readonly DeckMonitor[], now: number, isFeedLive: boolean): DeckMonitor[] =>
  list.map(monitor => {
    const since = unreportedSince(monitor)

    if (since === undefined || !isOpen(monitor) || now - since < ABSENT_GRACE_MS) {
      return monitor
    }
    if (isFeedLive) {
      return ended(monitor, 'dead', since, 'absence')
    }

    return {
      ...ended(monitor, 'done', since, 'absence'),
      detail: withNote(monitor.detail, NO_END_REPORT),
    }
  })

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
// monitor, whose state file may restart it. The first sighting's start time and the recipe
// recorded at start are kept, and a row seen again is no longer absent.
export const mergeMonitors = (list: readonly DeckMonitor[], incoming: readonly DeckMonitor[], cap = MONITOR_CAP): DeckMonitor[] => {
  const byId = new Map(list.map(monitor => [monitor.id, monitor]))

  for (const monitor of incoming) {
    const before = byId.get(monitor.id)

    if (before === undefined) {
      byId.set(monitor.id, monitor)
    } else if (!isFinished(before) || before.kind === 'run-monitor') {
      const { absentSince: _absent, endedAt: _endedAt, endedBy: _endedBy, ...kept } = before

      byId.set(
        monitor.id,
        make({
          ...kept,
          ...monitor,
          source: before.source,
          startedAt: Math.min(before.startedAt, monitor.startedAt),
          ...(before.isLoop === true ? { isLoop: true } : {}),
          ...(before.relaunch === undefined ? {} : { relaunch: before.relaunch }),
        }),
      )
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
          ? list.map(one => (one.kind === 'wakeup' && one.source === 'tool' && isOpen(one) ? ended(one, 'done', monitor.startedAt, 'clock') : one))
          : list

      return mergeMonitors(before, [monitor], cap)
    }
    case 'end':
      return list.map(monitor => (monitor.id === change.id && isOpen(monitor) ? ended(monitor, change.status, change.at, change.endedBy) : monitor))
    case 'end-wakeups':
      return list.map(monitor => (monitor.kind === 'wakeup' && isOpen(monitor) ? ended(monitor, 'canceled', change.at, change.endedBy) : monitor))
  }
}

// Time passing: wakeups and one-shot crons past their fire time are done, and recurring crons move
// to their next fire. A watch past its deadline is resolveAbsent's.
export const settle = (list: readonly DeckMonitor[], now: number): DeckMonitor[] =>
  list.map(monitor => {
    if (monitor.status === 'active' && monitor.nextAt !== undefined && now > monitor.nextAt + FIRE_GRACE_MS) {
      if (monitor.isRecurring === true && monitor.schedule !== undefined && (monitor.deadlineAt === undefined || now < monitor.deadlineAt)) {
        const nextAt = nextCronAt(monitor.schedule, now)

        return nextAt === undefined ? ended(monitor, 'done', now, 'clock') : { ...monitor, nextAt }
      }

      return ended(monitor, 'done', monitor.isRecurring === true ? now : monitor.nextAt, 'clock')
    }

    return monitor
  })

// ─── Reading the list ───────────────────────────────────────────────────────

export const isLongRunning = (monitor: DeckMonitor, now: number, thresholdMs = LONG_RUNNING_MS): boolean =>
  monitor.status === 'running' && now - monitor.startedAt >= thresholdMs

const RANK: Readonly<Record<DeckMonitorStatus, number>> = { active: 1, canceled: 2, dead: 2, done: 2, killed: 2, running: 0, stopped: 2 }

// Running work first, the longest-running on top; then active by next fire; then ended, newest first.
export const sortMonitors = (list: readonly DeckMonitor[]): DeckMonitor[] =>
  [...list].sort((left, right) => {
    const byRank = RANK[left.status] - RANK[right.status]

    if (byRank !== 0) {
      return byRank
    }
    if (left.status === 'running') {
      return left.startedAt - right.startedAt
    }
    if (left.status === 'active') {
      return (left.nextAt ?? Number.MAX_SAFE_INTEGER) - (right.nextAt ?? Number.MAX_SAFE_INTEGER)
    }

    return (right.endedAt ?? right.startedAt) - (left.endedAt ?? left.startedAt)
  })

export const summary = (list: readonly DeckMonitor[], now: number): MonitorSummary => {
  const counts: Record<DeckMonitorStatus, number> = { active: 0, canceled: 0, dead: 0, done: 0, killed: 0, running: 0, stopped: 0 }
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
      (monitor.status === 'running' || (monitor.status === 'active' && monitor.nextAt !== undefined && monitor.nextAt - input.now <= SOON_MS)),
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
      return { at, change: 'end', endedBy: 'deck', id: call.task_id, status: 'stopped' }
    case 'CronDelete':
      return { at, change: 'end', endedBy: 'deck', id: call.id, status: 'canceled' }
    case 'ScheduleWakeup':
      return { at, change: 'end-wakeups', endedBy: 'deck' }
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
