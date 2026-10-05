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
  advice?: string
}

export type DeckAdvisor = {
  consults: DeckConsult[]
  isAdvising: boolean
  since?: number
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
    }
  }
}
