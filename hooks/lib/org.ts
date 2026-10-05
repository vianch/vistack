// The deck's org chart: who works under the coordinator, what the coordinator is doing, who
// said what to whom, and the small charts the Board draws. Plain data in, plain data out.
import { isLive, roleOf } from './crew'

import type { Role } from './crew'
import type { IconName } from './theme'
import type { DeckActivity, DeckAgent, DeckComm, DeckConsult, DeckTool, DeckTurn } from '../../types'

export type Department = { id: Role; label: string; title: string; icon: IconName }

export const DEPARTMENTS: Readonly<Record<Role, Department>> = {
  advisor: { icon: 'advisor', id: 'advisor', label: 'Advisor', title: 'Board advisor' },
  builder: { icon: 'builder', id: 'builder', label: 'Engineering', title: 'Engineer' },
  captain: { icon: 'captain', id: 'captain', label: 'Program', title: 'Program manager' },
  critic: { icon: 'critic', id: 'critic', label: 'QA & Review', title: 'Reviewer' },
  helper: { icon: 'helper', id: 'helper', label: 'Operations', title: 'Generalist' },
  scholar: { icon: 'scholar', id: 'scholar', label: 'Library', title: 'Researcher' },
  scout: { icon: 'scout', id: 'scout', label: 'Research', title: 'Analyst' },
  wizard: { icon: 'wizard', id: 'wizard', label: 'Architecture', title: 'Principal engineer' },
}

// Departments under the coordinator, in drawing order. Advisor agents sit under the advisor seat.
export const DEPARTMENT_ORDER: readonly Role[] = ['scout', 'scholar', 'wizard', 'builder', 'critic', 'captain', 'helper']

export const departmentOf = (agent: DeckAgent): Department => DEPARTMENTS[roleOf(agent.type)]

export type OrgNode = { agent: DeckAgent; children: OrgNode[] }

export type OrgDepartment = Department & { members: OrgNode[]; count: number }

export type Org = { departments: OrgDepartment[]; advisors: OrgNode[] }

export const isOnStaff = (agent: DeckAgent): boolean => agent.leftAt === undefined

const headcount = (nodes: readonly OrgNode[]): number =>
  nodes.reduce((sum, node) => sum + 1 + headcount(node.children), 0)

// Staff grouped by department; an agent another staff member spawned nests under that agent.
export const orgTree = (agents: readonly DeckAgent[]): Org => {
  const staff = agents.filter(isOnStaff)
  const ids = new Set(staff.map(agent => agent.agentId))
  const placed = new Set<string>()
  const grow = (agent: DeckAgent): OrgNode => {
    placed.add(agent.agentId)

    return {
      agent,
      children: staff.filter(child => child.parentId === agent.agentId && !placed.has(child.agentId)).map(grow),
    }
  }
  const roots = staff.filter(agent => agent.parentId === undefined || !ids.has(agent.parentId)).map(grow)

  // A parent chain that loops reaches no top: those agents are drawn at the top instead of lost.
  for (const agent of staff) {
    if (!placed.has(agent.agentId)) {
      roots.push(grow(agent))
    }
  }

  const inRole = (role: Role): OrgNode[] => roots.filter(node => roleOf(node.agent.type) === role)

  return {
    advisors: inRole('advisor'),
    departments: DEPARTMENT_ORDER.map(role => {
      const members = inRole(role)

      return { ...DEPARTMENTS[role], count: headcount(members), members }
    }),
  }
}

// Agents that left the chart, newest departure first.
export const alumni = (agents: readonly DeckAgent[]): DeckAgent[] =>
  agents.filter(agent => agent.leftAt !== undefined).sort((left, right) => (right.leftAt ?? 0) - (left.leftAt ?? 0))

export const seatName = (nickname: string): string => nickname.replace(/ v\d+$/, '')

// The generation a reload hands the seat to: one past the highest that sat in it.
export const nextGeneration = (agents: readonly DeckAgent[], agent: DeckAgent): number => {
  const seat = seatName(agent.nickname)
  const generations = agents.filter(one => seatName(one.nickname) === seat).map(one => one.generation ?? 1)

  return Math.max(1, ...generations) + 1
}

export type CoordinatorState = 'idle' | 'thinking' | 'writing' | 'tool' | 'delegating' | 'waiting-you' | 'waiting-agents'

export type CoordinatorStatus = { state: CoordinatorState; label: string; since: number }

export const STATE_LABELS: Readonly<Record<CoordinatorState, string>> = {
  delegating: 'delegating',
  idle: 'idle',
  thinking: 'thinking',
  tool: 'running a tool',
  'waiting-agents': 'waiting on agents',
  'waiting-you': 'waiting on you',
  writing: 'writing',
}

const ASKING_TOOLS: readonly string[] = ['AskUserQuestion', 'ExitPlanMode']
const AGENT_TOOLS: readonly string[] = ['Agent', 'Task']

export const runningTurn = (turns: readonly DeckTurn[]): DeckTurn | undefined =>
  [...turns].reverse().find(turn => turn.durationMs === undefined && turn.reason === undefined)

export const isWorking = (agent: DeckAgent): boolean => isOnStaff(agent) && (isLive(agent.status) || agent.status === 'waiting')

export const coordinatorStatus = (input: {
  turns: readonly DeckTurn[]
  tools: readonly DeckTool[]
  agents: readonly DeckAgent[]
  activity: Readonly<Record<string, DeckActivity>>
}): CoordinatorStatus => {
  const running = input.tools.filter(tool => tool.status === 'running' && tool.agentId === undefined)
  const asking = running.find(tool => ASKING_TOOLS.includes(tool.tool))

  if (asking !== undefined) {
    const label = asking.tool === 'ExitPlanMode' ? 'waiting on you: a plan to approve' : 'waiting on you: a question'

    return { label, since: asking.startedAt, state: 'waiting-you' }
  }

  const delegating = running.find(tool => AGENT_TOOLS.includes(tool.tool))

  if (delegating !== undefined) {
    return { label: `delegating ${delegating.detail}`.trim(), since: delegating.startedAt, state: 'delegating' }
  }

  const tool = running[running.length - 1]

  if (tool !== undefined) {
    return { label: `${tool.tool} ${tool.detail}`.trim(), since: tool.startedAt, state: 'tool' }
  }

  const turn = runningTurn(input.turns)

  if (turn !== undefined) {
    const main = input.activity.main

    if (main?.kind === 'tool') {
      return { label: main.detail, since: main.since, state: 'tool' }
    }

    return main?.kind === 'writing'
      ? { label: 'writing', since: main.since, state: 'writing' }
      : { label: 'thinking', since: main?.since ?? turn.startedAt, state: 'thinking' }
  }

  const live = input.agents.filter(isWorking)

  if (live.length > 0) {
    return {
      label: `waiting on ${live.length} agent${live.length === 1 ? '' : 's'}`,
      since: Math.min(...live.map(agent => agent.startedAt)),
      state: 'waiting-agents',
    }
  }

  const last = input.turns[input.turns.length - 1]

  return { label: 'idle', since: last === undefined ? 0 : last.startedAt + (last.durationMs ?? 0), state: 'idle' }
}

// What one loop is doing now: its newest running tool, else what its stream last showed.
export const doingNow = (
  agentId: string | undefined,
  activity: Readonly<Record<string, DeckActivity>>,
  tools: readonly DeckTool[],
): DeckActivity | null => {
  const tool = [...tools].reverse().find(one => one.status === 'running' && one.agentId === agentId)

  if (tool !== undefined) {
    return { detail: `${tool.tool} ${tool.detail}`.trim(), kind: 'tool', since: tool.startedAt }
  }

  return activity[agentId ?? 'main'] ?? null
}

const CODE_TOOLS: readonly string[] = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']

// Run state, ledgers and plans under .claude/ or .codex/ are the coordinator's own records.
const RECORD_PATH = /(^|\/)\.(claude|codex)\//

// The coordinator delegates and never writes code: every main-loop edit of a code file.
export const codeWrites = (tools: readonly DeckTool[]): DeckTool[] =>
  tools.filter(tool => tool.agentId === undefined && CODE_TOOLS.includes(tool.tool) && !RECORD_PATH.test(tool.detail))

export const COMM_CAP = 80

export const recordComm = (list: readonly DeckComm[], comm: DeckComm): DeckComm[] =>
  [...list.filter(one => one.id !== comm.id), comm].slice(-COMM_CAP)

const PARTIES: Readonly<Record<string, { name: string; icon: IconName }>> = {
  advisor: { icon: 'advisor', name: 'Advisor' },
  coordinator: { icon: 'coordinator', name: 'Coordinator' },
  deck: { icon: 'org', name: 'Deck' },
  user: { icon: 'user', name: 'You' },
}

export const commLabel = (party: string, agents: readonly DeckAgent[]): { name: string; icon: IconName } => {
  const known = PARTIES[party]

  if (known !== undefined) {
    return known
  }

  const agent = agents.find(one => one.agentId === party)

  if (agent !== undefined) {
    return { icon: departmentOf(agent).icon, name: agent.nickname }
  }

  return { icon: /#\d+$/.test(party) ? 'pr' : 'message', name: party }
}

// A SendMessage address as a party: an agent's id when it names one by id or nickname.
export const partyOf = (address: string, agents: readonly DeckAgent[]): string => {
  const wanted = address.trim().toLowerCase()
  const agent = agents.find(one => one.agentId.toLowerCase() === wanted || one.nickname.toLowerCase() === wanted)

  return agent?.agentId ?? address
}

export const ADVISOR_TOOL = /^advisor$/i

export type ConsultFound = { id: string; advice?: string }

type MessageLike = { role: string; toolUses: readonly { tool_use_id: string; tool: string; text?: string }[] }

export const consultsFrom = (messages: readonly MessageLike[]): ConsultFound[] =>
  messages
    .filter(message => message.role === 'assistant')
    .flatMap(message => message.toolUses.filter(use => ADVISOR_TOOL.test(use.tool)))
    .map(use => (use.text === undefined || use.text.trim() === '' ? { id: use.tool_use_id } : { advice: use.text, id: use.tool_use_id }))

export const CONSULT_CAP = 60

// Consults read back from the transcript joined to the ones seen live; `advised` lists those
// whose advice arrived with this read.
export const mergeConsults = (
  known: readonly DeckConsult[],
  found: readonly ConsultFound[],
  at: number,
): { consults: DeckConsult[]; advised: DeckConsult[] } => {
  const advised: DeckConsult[] = []
  let consults = [...known]

  for (const one of found) {
    const seen = consults.find(consult => consult.id === one.id)
    const merged: DeckConsult = { ...(seen ?? { at, id: one.id }), ...(one.advice === undefined ? {} : { advice: one.advice }) }

    if (seen === undefined || (seen.advice === undefined && merged.advice !== undefined)) {
      consults = [...consults.filter(consult => consult.id !== one.id), merged]
      if (merged.advice !== undefined) {
        advised.push(merged)
      }
    }
  }

  return { advised, consults: consults.slice(-CONSULT_CAP) }
}

export type TeamStatus = { running: number; waiting: number; done: number; failed: number }

export const teamStatus = (agents: readonly DeckAgent[]): TeamStatus =>
  agents.filter(isOnStaff).reduce(
    (sum, agent) => {
      if (isLive(agent.status)) {
        return { ...sum, running: sum.running + 1 }
      }
      if (agent.status === 'waiting' || agent.status === 'idle') {
        return { ...sum, waiting: sum.waiting + 1 }
      }

      return agent.status === 'completed' ? { ...sum, done: sum.done + 1 } : { ...sum, failed: sum.failed + 1 }
    },
    { done: 0, failed: 0, running: 0, waiting: 0 },
  )

const SPARKS = '▁▂▃▄▅▆▇█'

// The last `width` values as one glyph each, scaled to the largest of them.
export const sparkline = (values: readonly number[], width: number): string => {
  if (width <= 0) {
    return ''
  }

  const shown = values.slice(-width)
  const top = Math.max(0, ...shown)

  return shown
    .map(value => (top <= 0 || value <= 0 ? SPARKS[0] : SPARKS[Math.min(7, Math.max(1, Math.round((value / top) * 7)))]))
    .join('')
}

// How many timestamps fall in each of the last `buckets` windows of `bucketMs`, oldest first.
export const histogram = (points: readonly number[], now: number, buckets: number, bucketMs: number): number[] => {
  const counts = Array.from({ length: Math.max(0, buckets) }, () => 0)

  if (bucketMs <= 0 || counts.length === 0) {
    return counts
  }

  const start = now - counts.length * bucketMs

  for (const at of points) {
    if (at < start || at > now) {
      continue
    }

    const index = Math.min(counts.length - 1, Math.floor((at - start) / bucketMs))

    counts[index] = (counts[index] ?? 0) + 1
  }

  return counts
}

// Bar lengths for a horizontal bar chart, the largest value filling `width`.
export const bars = <Entry extends { value: number }>(
  entries: readonly Entry[],
  width: number,
): (Entry & { full: string; empty: string })[] => {
  const size = Math.max(1, width)
  const top = Math.max(0, ...entries.map(entry => entry.value))

  return entries.map(entry => {
    const share = top <= 0 ? 0 : Math.round((entry.value / top) * size)
    const filled = Math.min(size, entry.value > 0 ? Math.max(1, share) : 0)

    return { ...entry, empty: '░'.repeat(size - filled), full: '█'.repeat(filled) }
  })
}

// Cells per part of a stacked bar `width` wide: they add up to `width` unless every part is 0.
export const stacked = (values: readonly number[], width: number): number[] => {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)

  if (total <= 0 || width <= 0) {
    return values.map(() => 0)
  }

  const exact = values.map(value => (Math.max(0, value) / total) * width)
  const sizes = exact.map(value => Math.floor(value))
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((one, two) => two.rest - one.rest)
  let remaining = width - sizes.reduce((sum, size) => sum + size, 0)

  for (const { index } of order) {
    if (remaining <= 0) {
      break
    }
    sizes[index] = (sizes[index] ?? 0) + 1
    remaining -= 1
  }

  return sizes
}

export type ReviewPost = { repo: string; number: number | null }

// The PR a command segment names: a PR URL, owner/repo#n, or --repo plus a number.
const prTarget = (segment: string, rest: string): ReviewPost => {
  const url = /https?:\/\/[^/\s]+\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(segment)

  if (url !== null) {
    return { number: Number(url[2]), repo: url[1] ?? '' }
  }

  const short = /(?:^|\s)([\w.-]+\/[\w.-]+)#(\d+)\b/.exec(segment)

  if (short !== null) {
    return { number: Number(short[2]), repo: short[1] ?? '' }
  }

  const repo = /(?:--repo|-R)[=\s]+([\w.-]+\/[\w.-]+)/.exec(segment)?.[1] ?? ''
  const positional = rest.split(/\s--?[a-zA-Z]/)[0] ?? ''
  const number = /(?:--pr|--number)[=\s]+(\d+)/.exec(segment)?.[1] ?? /(?:^|\s)(\d+)(?=\s|$)/.exec(positional)?.[1]

  return { number: number === undefined ? null : Number(number), repo }
}

// `gh api` writes when a method other than GET is named or a field or input is sent.
const isApiWrite = (segment: string): boolean =>
  !/(?:-X|--method)[=\s]*GET\b/i.test(segment) &&
  (/(?:-X|--method)[=\s]*(POST|PUT|PATCH)\b/i.test(segment) || /\s(?:-f|-F|--field|--raw-field|--input)[=\s]/.test(segment))

// The PR a shell command posts a review or review comment on, or null when it posts none.
// An empty repo means the checkout's own; a null number, the current branch's PR.
export const reviewPostOf = (command: string): ReviewPost | null => {
  for (const segment of command.split(/&&|\|\||;|\n|\|/)) {
    const api = /\bgh\s+api\b.*?\brepos\/([^/\s]+\/[^/\s]+)\/pulls\/(\d+)\/(?:reviews|comments)\b/.exec(segment)

    if (api !== null && isApiWrite(segment)) {
      const repo = api[1] ?? ''

      return { number: Number(api[2]), repo: repo.includes('{') ? '' : repo }
    }

    const verb = /\bgh\s+pr\s+(?:review|comment)\b(.*)$/.exec(segment)

    if (verb !== null && !/--delete-last\b/.test(segment)) {
      return prTarget(segment, verb[1] ?? '')
    }

    const script = /\bnode\s+\S*skills\/review-pr\/scripts\/post-review\.mjs\b(.*)$/.exec(segment)

    if (script !== null && !/--dry-run\b/.test(segment)) {
      return prTarget(segment, script[1] ?? '')
    }
  }

  return null
}
