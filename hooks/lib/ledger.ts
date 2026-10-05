// Pure record keeping for the deck: every function takes the list it changes and returns
// the next one, so the hooks stay thin and these stay testable.
import { costOf } from './pricing'

import type { DeckAgent, DeckEdit, DeckStep, DeckTool, DeckTurn } from '../../types'

export const STEP_CAP = 400
export const TOOL_CAP = 300
export const EDIT_CAP = 200
export const TURN_CAP = 60

export const stepKey = (turnId: string, index: number, agentId: string | undefined): string =>
  `${agentId ?? 'main'}:${turnId}:${index}`

// A step is counted once: a second record under the same key replaces the first.
export const recordStep = (list: readonly DeckStep[], step: DeckStep): DeckStep[] => {
  const rest = list.filter(one => one.key !== step.key)

  return [...rest, step].slice(-STEP_CAP)
}

export const makeStep = (input: {
  turnId: string
  index: number
  agentId?: string
  model: string
  usage: { model: string; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | null
  startedAt: number
  endedAt: number
  hasStop: boolean
}): DeckStep => {
  const model = input.usage?.model ?? input.model
  const counts = {
    cacheRead: input.usage?.cache_read_input_tokens ?? 0,
    cacheWrite: input.usage?.cache_creation_input_tokens ?? 0,
    input: input.usage?.input_tokens ?? 0,
    output: input.usage?.output_tokens ?? 0,
  }

  return {
    ...counts,
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    index: input.index,
    isFailed: !input.hasStop,
    key: stepKey(input.turnId, input.index, input.agentId),
    model,
    ms: Math.max(0, input.endedAt - input.startedAt),
    startedAt: input.startedAt,
    turnId: input.turnId,
    usd: input.usage === null ? 0 : costOf(model, counts),
  }
}

export const startTool = (list: readonly DeckTool[], run: DeckTool): DeckTool[] =>
  [...list.filter(one => one.id !== run.id), run].slice(-TOOL_CAP)

export const finishTool = (list: readonly DeckTool[], id: string, endedAt: number, isError: boolean): DeckTool[] =>
  list.map(one =>
    one.id === id ? { ...one, ms: Math.max(0, endedAt - one.startedAt), status: isError ? 'error' : 'ok' } : one,
  )

const field = (input: unknown, name: string): unknown =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[name] : undefined

const text = (input: unknown, name: string): string => {
  const value = field(input, name)

  return typeof value === 'string' ? value : ''
}

export const toolDetail = (tool: string, input: unknown): string => {
  switch (tool) {
    case 'Bash':
      return text(input, 'command')
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return text(input, 'file_path')
    case 'NotebookEdit':
      return text(input, 'notebook_path')
    case 'Grep':
    case 'Glob':
      return text(input, 'pattern')
    case 'Agent':
    case 'Task':
      return text(input, 'description')
    case 'Skill':
      return text(input, 'skill')
    case 'WebFetch':
      return text(input, 'url')
    case 'WebSearch':
      return text(input, 'query')
    case 'AskUserQuestion': {
      const questions = field(input, 'questions')

      return Array.isArray(questions) ? text(questions[0], 'question') : ''
    }
    default:
      return ''
  }
}

const lines = (value: string): string[] => (value === '' ? [] : value.split('\n'))

// Lines added and removed between two texts, after their common head and tail.
export const lineDelta = (before: string, after: string): { added: number; removed: number } => {
  const old = lines(before)
  const next = lines(after)
  let head = 0

  while (head < old.length && head < next.length && old[head] === next[head]) {
    head += 1
  }

  let tail = 0

  while (
    tail < old.length - head &&
    tail < next.length - head &&
    old[old.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail += 1
  }

  return { added: next.length - head - tail, removed: old.length - head - tail }
}

export type EditDelta = { path: string; added: number; removed: number }

export const editDelta = (tool: string, input: unknown): EditDelta | null => {
  if (tool === 'Edit') {
    const path = text(input, 'file_path')

    return path === '' ? null : { path, ...lineDelta(text(input, 'old_string'), text(input, 'new_string')) }
  }
  if (tool === 'MultiEdit') {
    const path = text(input, 'file_path')
    const list = field(input, 'edits')

    if (path === '' || !Array.isArray(list)) {
      return null
    }

    return list.reduce<EditDelta>(
      (sum, one) => {
        const delta = lineDelta(text(one, 'old_string'), text(one, 'new_string'))

        return { added: sum.added + delta.added, path, removed: sum.removed + delta.removed }
      },
      { added: 0, path, removed: 0 },
    )
  }
  if (tool === 'Write') {
    const path = text(input, 'file_path')

    return path === '' ? null : { added: lines(text(input, 'content')).length, path, removed: 0 }
  }
  if (tool === 'NotebookEdit') {
    const path = text(input, 'notebook_path')

    return path === '' ? null : { added: lines(text(input, 'new_source')).length, path, removed: 0 }
  }

  return null
}

export const mergeEdit = (list: readonly DeckEdit[], delta: EditDelta, at: number, isNew: boolean): DeckEdit[] => {
  const known = list.find(one => one.path === delta.path)
  const next: DeckEdit = known
    ? {
        ...known,
        added: known.added + delta.added,
        count: known.count + 1,
        lastAt: at,
        removed: known.removed + delta.removed,
      }
    : { ...delta, count: 1, isNew, lastAt: at }

  return [next, ...list.filter(one => one.path !== delta.path)].slice(0, EDIT_CAP)
}

export const recordTurn = (list: readonly DeckTurn[], turn: DeckTurn): DeckTurn[] =>
  [...list.filter(one => one.turnId !== turn.turnId), turn].slice(-TURN_CAP)

export const patchTurn = (list: readonly DeckTurn[], turnId: string, patch: Partial<DeckTurn>): DeckTurn[] =>
  list.map(one => (one.turnId === turnId ? { ...one, ...patch } : one))

export const patchAgent = (list: readonly DeckAgent[], agentId: string, patch: Partial<DeckAgent>): DeckAgent[] =>
  list.map(one => (one.agentId === agentId ? { ...one, ...patch } : one))

export type Totals = {
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
  isPartial: boolean
  ms: number
  failed: number
}

export const emptyTotals = (): Totals => ({
  cacheRead: 0,
  cacheWrite: 0,
  failed: 0,
  input: 0,
  isPartial: false,
  ms: 0,
  output: 0,
  requests: 0,
  usd: 0,
})

export const addUp = (list: readonly DeckStep[]): Totals =>
  list.reduce<Totals>(
    (sum, step) => ({
      cacheRead: sum.cacheRead + step.cacheRead,
      cacheWrite: sum.cacheWrite + step.cacheWrite,
      failed: sum.failed + (step.isFailed ? 1 : 0),
      input: sum.input + step.input,
      isPartial: sum.isPartial || step.usd === null,
      ms: sum.ms + step.ms,
      output: sum.output + step.output,
      requests: sum.requests + 1,
      usd: sum.usd + (step.usd ?? 0),
    }),
    emptyTotals(),
  )

// Share of input the prompt cache served.
export const cacheShare = (totals: Totals): number => {
  const all = totals.input + totals.cacheRead + totals.cacheWrite

  return all === 0 ? 0 : totals.cacheRead / all
}

export const byModel = (list: readonly DeckStep[]): { model: string; totals: Totals }[] => {
  const models = [...new Set(list.map(step => step.model))]

  return models
    .map(model => ({ model, totals: addUp(list.filter(step => step.model === model)) }))
    .sort((left, right) => right.totals.usd - left.totals.usd)
}

export type Execution = {
  id: string
  kind: 'turn' | 'agent'
  label: string
  models: string[]
  totals: Totals
  ms: number
  status: string
  startedAt: number
}

// One row per main-loop turn and one per subagent run: the "cost per execution" table.
export const executions = (
  stepList: readonly DeckStep[],
  turnList: readonly DeckTurn[],
  agentList: readonly DeckAgent[],
  now: number,
): Execution[] => {
  const main = turnList.map(turn => {
    const own = stepList.filter(step => step.agentId === undefined && step.turnId === turn.turnId)

    return {
      id: turn.turnId,
      kind: 'turn' as const,
      label: turn.text === '' ? '(continuation)' : turn.text,
      models: [...new Set(own.map(step => step.model))],
      ms: turn.durationMs ?? now - turn.startedAt,
      startedAt: turn.startedAt,
      status: turn.reason ?? 'running',
      totals: addUp(own),
    }
  })
  const subs = agentList.map(agent => {
    const own = stepList.filter(step => step.agentId === agent.agentId)

    return {
      id: agent.agentId,
      kind: 'agent' as const,
      label: `${agent.nickname} · ${agent.description}`,
      models: [...new Set(own.map(step => step.model).concat(own.length === 0 ? [agent.model] : []))],
      ms: (agent.endedAt ?? now) - agent.startedAt,
      startedAt: agent.startedAt,
      status: agent.status,
      totals: addUp(own),
    }
  })

  return [...main, ...subs].sort((left, right) => right.startedAt - left.startedAt)
}

export type Timeline = {
  totalMs: number
  modelMs: number
  toolMs: number
  idleMs: number
  byTool: { tool: string; ms: number }[]
  slowest: { kind: 'model' | 'tool'; label: string; ms: number }[]
  segments: { kind: 'model' | 'tool' | 'failed'; startedAt: number; ms: number }[]
}

// Where one main-loop turn's wall clock went: model requests, tools, and the gaps between.
export const timeline = (
  turn: DeckTurn,
  stepList: readonly DeckStep[],
  toolList: readonly DeckTool[],
  now: number,
): Timeline => {
  const own = stepList.filter(step => step.agentId === undefined && step.turnId === turn.turnId)
  const ownTools = toolList.filter(tool => tool.agentId === undefined && tool.turnId === turn.turnId)
  const totalMs = turn.durationMs ?? now - turn.startedAt
  const modelMs = own.reduce((sum, step) => sum + step.ms, 0)
  const toolMs = ownTools.reduce((sum, tool) => sum + (tool.ms ?? now - tool.startedAt), 0)
  const names = [...new Set(ownTools.map(tool => tool.tool))]
  const byTool = names
    .map(tool => ({
      ms: ownTools.filter(one => one.tool === tool).reduce((sum, one) => sum + (one.ms ?? 0), 0),
      tool,
    }))
    .sort((left, right) => right.ms - left.ms)
  const slowest = [
    ...own.map(step => ({
      kind: 'model' as const,
      label: `request ${step.index + 1} of ${own.length}`,
      ms: step.ms,
    })),
    ...ownTools.map(tool => ({ kind: 'tool' as const, label: `${tool.tool} ${tool.detail}`, ms: tool.ms ?? 0 })),
  ]
    .sort((left, right) => right.ms - left.ms)
    .slice(0, 5)
  const segments = [
    ...own.map(step => ({ kind: step.isFailed ? ('failed' as const) : ('model' as const), ms: step.ms, startedAt: step.startedAt })),
    ...ownTools.map(tool => ({
      kind: tool.status === 'error' ? ('failed' as const) : ('tool' as const),
      ms: tool.ms ?? now - tool.startedAt,
      startedAt: tool.startedAt,
    })),
  ].sort((left, right) => left.startedAt - right.startedAt)

  return {
    byTool,
    idleMs: Math.max(0, totalMs - modelMs - toolMs),
    modelMs,
    segments,
    slowest,
    toolMs,
    totalMs,
  }
}
