export type DeckTab =
  | 'board'
  | 'agents'
  | 'cost'
  | 'session'
  | 'changes'
  | 'timeline'
  | 'workflow'
  | 'recall'
  | 'settings'

export type DeckStep = {
  key: string
  turnId: string
  index: number
  agentId?: string
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number | null
  startedAt: number
  ms: number
  isFailed: boolean
}

export type DeckToolStatus = 'running' | 'ok' | 'error'

export type DeckTool = {
  id: string
  tool: string
  agentId?: string
  turnId?: string
  detail: string
  startedAt: number
  ms?: number
  status: DeckToolStatus
}

export type DeckEdit = {
  path: string
  added: number
  removed: number
  count: number
  lastAt: number
  isNew: boolean
}

export type DeckTurn = {
  turnId: string
  text: string
  startedAt: number
  durationMs?: number
  answer?: string
  reason?: string
}

export type DeckAgent = {
  agentId: string
  toolUseId: string
  type: string
  description: string
  nickname: string
  model: string
  status: string
  startedAt: number
  endedAt?: number
  answer?: string
  // What hire and reload need to give the same job to a new agent.
  prompt?: string
  // The loop that spawned it; absent when the coordinator did.
  parentId?: string
  // 1 for the first agent in a seat; reload hands the seat to the next generation.
  generation?: number
  // The agent whose job this one was hired or reloaded to do.
  hiredFrom?: string
  // Set when the agent left the org chart: fired by the person or replaced by a reload.
  leftAt?: number
  leftHow?: 'fired' | 'reloaded'
}

export type DeckMonitorKind = 'monitor' | 'shell' | 'agent' | 'workflow' | 'wakeup' | 'cron' | 'run-monitor' | 'other'

// running: executing now. active: armed, waiting for its next fire. stopped: ended by Stop.
// canceled: removed by Cancel before it fired. killed: ended by the engine or a signal, not by
// Stop. dead: vanished with no end report, or exited with an error. done: finished on its own.
export type DeckMonitorStatus = 'running' | 'active' | 'stopped' | 'canceled' | 'killed' | 'dead' | 'done'

export type DeckMonitorSource = 'tool' | 'stop-snapshot' | 'state-file' | 'agent-list'

// report: the engine said it ended. absence: a complete snapshot stopped listing it. clock: its
// fire time or deadline passed. deck: the deck's own Stop or Cancel.
export type DeckMonitorEnd = 'report' | 'absence' | 'clock' | 'deck'

// How to start the same work again, recorded when it started.
export type MonitorRelaunch =
  | {
      via: 'tool'
      tool: 'Monitor'
      input: { description: string; timeout_ms: number; command?: string; ws?: { url: string; protocols?: string[] } }
    }
  | { via: 'tool'; tool: 'Bash'; input: { command: string; description?: string; run_in_background: true } }
  | { via: 'tool'; tool: 'CronCreate'; input: { cron: string; prompt: string; recurring: boolean } }
  | { via: 'rehire'; agentId: string }
  | { via: 'loop'; args: string }

// One row per id: the task id TaskStop takes, the cron id CronDelete takes, or a key of our own
// where the engine gives none (`wakeup:<fire time>`, `run:<root>/<slug>`).
export type DeckMonitor = {
  id: string
  kind: DeckMonitorKind
  label: string
  detail: string
  status: DeckMonitorStatus
  // The source's own word for the status (`killed`, `pending`, a run file's value).
  rawStatus?: string
  startedAt: number
  endedAt?: number
  endedBy?: DeckMonitorEnd
  // When a complete snapshot first left this open row out; it ends once the grace has passed.
  absentSince?: number
  nextAt?: number
  deadlineAt?: number
  source: DeckMonitorSource
  canStop: boolean
  canCancel: boolean
  schedule?: string
  isRecurring?: boolean
  // A /loop wakeup, which ScheduleWakeup { stop: true } ends.
  isLoop?: boolean
  relaunch?: MonitorRelaunch
  // The synchronous subagent whose final response ends this work; absent when the work outlives
  // the loop that started it.
  ownerAgentId?: string
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

// A background task's end, from a task notification.
export type MonitorEndNote = { taskId: string; status: string }

export type MonitorChange =
  | { change: 'start'; monitor: DeckMonitor }
  | { change: 'end'; id: string; at: number; status: 'stopped' | 'canceled'; endedBy: DeckMonitorEnd }
  | { change: 'end-wakeups'; at: number; endedBy: DeckMonitorEnd }

export type StopCall = { tool: 'TaskStop'; task_id: string } | { tool: 'CronDelete'; id: string } | { tool: 'ScheduleWakeup'; stop: true }

export type StopPlan = { isAllowed: true; verb: 'stop' | 'cancel'; call: StopCall } | { isAllowed: false; reason: string }

export type MonitorSummary = Record<DeckMonitorStatus, number> & { longRunning: number; longest?: DeckMonitor }

export type KeepAwake = 'off' | 'while-working' | 'always'

export type DeckAwake = { isHeld: boolean; how?: string; reason?: string }

export type DeckPick = {
  id: string
  scope: 'main' | 'agent'
  subject: string
  tier: string
  recommended: string
  actual?: string
  backend: string
  confidence: number
  decisionId?: string
  agentId?: string
  turnId?: string
  isApplied: boolean
  result?: string
  usd?: number | null
  at: number
}

export type DeckSkill = { skill: string; at: number; agentId?: string }

export type DeckTodo = { id: string; content: string; status: string }

export type DeckPr = {
  // owner/name of the repository the PR is in.
  repo: string
  number: number
  title: string
  url: string
  branch: string
  isDraft: boolean
  review: string
  checks: string
  failing: string[]
}

export type DeckPrs = {
  state: 'off' | 'out-of-realm' | 'ok' | 'error' | 'loading'
  reason?: string
  items: DeckPr[]
  checkedAt: number
}

export type DeckSlice = {
  id: string
  agent?: string
  model?: string
  phase?: string
  branch?: string
  pr?: string
  worktree?: string
  blockers: number
}

export type DeckRun = {
  slug: string
  root: string
  playbook?: string
  mode?: string
  objective?: string
  monitor?: string
  slices: DeckSlice[]
  lastLedger?: string
}

export type DeckWorktree = { name: string; path: string; branch?: string }

export type DeckWorkflow = {
  checkedAt: number
  runs: DeckRun[]
  worktrees: DeckWorktree[]
  cwd: string
  repoRoot?: string
  remote?: string
  branch?: string
  isInRealm: boolean
}

export type DeckLimit = { kind: string; percent: number; resetsAt?: string }

export type DeckUsage = {
  contextPercent?: number
  contextTokens?: number
  window: number
  limits: DeckLimit[]
  usd?: number
  startedAt: number
  at: number
}

export type DeckLazygit = { isOpen: boolean; how?: string; handle?: string; error?: string }

// right: the pane, docked beside a fullscreen transcript. bottom: the band above the prompt.
export type DeckPlacement = 'right' | 'bottom' | 'hidden'

export type DeckIcons = 'emoji' | 'unicode' | 'ascii'

export type DeckSettings = {
  placement: DeckPlacement
  theme: string
  icons: DeckIcons
  isAnimated: boolean
  // The Git realm set in the deck (host/owner); '' falls back to the userConfig `realm` option.
  realm: string
}

// What one model loop is doing right now: the coordinator under 'main', a subagent under its id.
export type DeckActivity = {
  kind: 'thinking' | 'writing' | 'tool'
  detail: string
  since: number
}

// A party in the org: 'user', 'coordinator', 'advisor', 'deck', or an agent id.
export type DeckComm = {
  id: string
  at: number
  from: string
  to: string
  kind: 'prompt' | 'answer' | 'dispatch' | 'report' | 'message' | 'question' | 'advice' | 'action'
  text: string
}

export type DeckConsult = {
  id: string
  at: number
  turnId?: string
  ms?: number
  endedAt?: number
  advice?: string
  adviceHead?: string
  isRedacted?: boolean
  error?: string
  model?: string
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  usd?: number | null
  source?: 'api' | 'transcript' | 'stream' | 'agent'
}

export type DeckAdvisor = {
  consults: DeckConsult[]
  isAdvising: boolean
  since?: number
}

// One entry of the review watch's state file (skills/review-watch/references/data.md):
// a mention that needs the operator, a clean review awaiting approval, or a post. `text` is
// the mention excerpt, the PR title, or the post summary, cut to 120 characters.
export type DeckWatchItem = {
  key: string
  pr: string
  url: string
  at: number
  text: string
  author?: string
  reason?: string
}

export type DeckWatchPost = DeckWatchItem & { kind: 'review' | 'reply' }

// The watch's state file as the deck read it, plus what this session's deck has asked for.
// Times are epoch ms.
export type DeckReviewWatch = {
  enabled: boolean
  // host/owner; '' when the file names none or one that is not a realm.
  realm: string
  enabledAt?: number
  lastPassStartedAt?: number
  lastPassAt?: number
  needsYou: DeckWatchItem[]
  clean: DeckWatchItem[]
  posted: DeckWatchPost[]
  error?: string
  readAt: number
  armRequestedAt?: number
  // Set when the deck runs the off script; arming waits until the file reads enabled: false.
  isOffPending?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    vistack: {
      tab: DeckTab
      steps: DeckStep[]
      tools: DeckTool[]
      edits: DeckEdit[]
      turns: DeckTurn[]
      agents: DeckAgent[]
      picks: DeckPick[]
      skills: DeckSkill[]
      todos: DeckTodo[]
      prs: DeckPrs
      workflow: DeckWorkflow | null
      usage: DeckUsage | null
      lazygit: DeckLazygit
      frame: number
      query: string
      openId: string
      settings: DeckSettings
      activity: Record<string, DeckActivity>
      comms: DeckComm[]
      advisor: DeckAdvisor
      selected: string
      confirm: string
      asking: string
      isBandOpen: boolean
      model: string
      monitors: DeckMonitor[]
      awake: DeckAwake
      keepAwake: KeepAwake
      loopPrompt: string
      loopInterval: string
      reviewWatch: DeckReviewWatch | null
    }
  }
}
