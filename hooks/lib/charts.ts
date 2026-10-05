// Small pure series the lower tabs chart: cost per step, calls per tool, churn cells of one file.
import type { DeckEdit, DeckStep, DeckTool } from '../../types'

// Cost of each model request of one execution (a main turn, or one agent), oldest first.
export const stepCosts = (steps: readonly DeckStep[], execution: { id: string; kind: 'turn' | 'agent' }): number[] =>
  steps
    .filter(step => (execution.kind === 'agent' ? step.agentId === execution.id : step.agentId === undefined && step.turnId === execution.id))
    .sort((left, right) => left.startedAt - right.startedAt)
    .map(step => step.usd ?? 0)

// Calls per tool name, the busiest first.
export const toolCounts = (tools: readonly DeckTool[]): { tool: string; count: number; errors: number }[] => {
  const names = [...new Set(tools.map(tool => tool.tool))]

  return names
    .map(name => {
      const own = tools.filter(tool => tool.tool === name)

      return { count: own.length, errors: own.filter(tool => tool.status === 'error').length, tool: name }
    })
    .sort((left, right) => right.count - left.count || left.tool.localeCompare(right.tool))
}

// Cells of a churn bar `width` wide: added, removed and untouched, which add up to `width`.
export const churnCells = (edit: Pick<DeckEdit, 'added' | 'removed'>, biggest: number, width: number): { add: number; del: number; rest: number } => {
  const total = edit.added + edit.removed

  if (total === 0 || biggest <= 0 || width <= 0) {
    return { add: 0, del: 0, rest: Math.max(0, width) }
  }

  const filled = Math.min(width, Math.max(1, Math.round((total / biggest) * width)))
  const add = Math.round((edit.added / total) * filled)

  return { add, del: filled - add, rest: width - filled }
}
