// The session board: what waits on the person, and what is still open, grouped.
import type { DeckAgent, DeckPrs, DeckTodo, DeckTool, DeckTurn, DeckWorkflow } from '../../types'

export type Reply = {
  id: string
  kind: 'question' | 'plan' | 'asked' | 'agent'
  text: string
  turnId?: string
  since: number
}

const lastQuestion = (answer: string): string | null => {
  const tail = answer.trim().split('\n').filter(row => row.trim() !== '').slice(-6).join(' ')
  const sentences = tail.match(/[^.!?]*\?/g)
  const question = sentences?.[sentences.length - 1]?.trim()

  return question === undefined || question.length < 6 ? null : question
}

export const needsReply = (
  toolList: readonly DeckTool[],
  turnList: readonly DeckTurn[],
  agentList: readonly DeckAgent[],
): Reply[] => {
  const asking: Reply[] = toolList
    .filter(tool => tool.status === 'running' && tool.agentId === undefined)
    .filter(tool => tool.tool === 'AskUserQuestion' || tool.tool === 'ExitPlanMode')
    .map(tool => ({
      id: tool.id,
      kind: tool.tool === 'ExitPlanMode' ? ('plan' as const) : ('question' as const),
      since: tool.startedAt,
      text: tool.tool === 'ExitPlanMode' ? 'A plan waits for your approval' : tool.detail || 'Claude asks a question',
      ...(tool.turnId === undefined ? {} : { turnId: tool.turnId }),
    }))
  const lastTurn = [...turnList].reverse().find(turn => turn.durationMs !== undefined)
  const question = lastTurn?.answer === undefined ? null : lastQuestion(lastTurn.answer)
  const asked: Reply[] =
    lastTurn === undefined || question === null || asking.length > 0
      ? []
      : [{ id: `asked-${lastTurn.turnId}`, kind: 'asked', since: lastTurn.startedAt, text: question, turnId: lastTurn.turnId }]
  const waiting: Reply[] = agentList
    .filter(agent => agent.status === 'waiting')
    .map(agent => ({ id: agent.agentId, kind: 'agent', since: agent.startedAt, text: `${agent.nickname} waits: ${agent.description}` }))

  return [...asking, ...asked, ...waiting]
}

export type Pending = { title: string; rows: { id: string; text: string; tone: 'run' | 'todo' | 'fail' | 'wait' }[] }

export const pending = (input: {
  agents: readonly DeckAgent[]
  tools: readonly DeckTool[]
  todos: readonly DeckTodo[]
  workflow: DeckWorkflow | null
  prs: DeckPrs
}): Pending[] => {
  const sections: Pending[] = [
    {
      rows: input.agents
        .filter(agent => agent.status === 'running' || agent.status === 'pending')
        .map(agent => ({ id: agent.agentId, text: `${agent.nickname} · ${agent.description}`, tone: 'run' as const })),
      title: 'Agents running',
    },
    {
      rows: input.tools
        .filter(tool => tool.status === 'running')
        .map(tool => ({ id: tool.id, text: `${tool.tool} ${tool.detail}`, tone: 'run' as const })),
      title: 'Tools running',
    },
    {
      rows: input.todos
        .filter(todo => todo.status !== 'completed')
        .map(todo => ({
          id: todo.id,
          text: todo.content,
          tone: todo.status === 'in_progress' ? ('run' as const) : ('todo' as const),
        })),
      title: 'Tasks open',
    },
    {
      rows: (input.workflow?.runs ?? []).flatMap(run =>
        run.slices
          .filter(slice => slice.phase !== 'merge-ready')
          .map(slice => ({
            id: `${run.slug}/${slice.id}`,
            text: `${run.slug}/${slice.id} · ${slice.phase ?? '?'}${slice.blockers > 0 ? ` · ${slice.blockers} blocker` : ''}`,
            tone: slice.phase === 'blocked' ? ('fail' as const) : ('wait' as const),
          })),
      ),
      title: 'Slices open',
    },
    {
      rows: input.prs.items
        .filter(pr => pr.checks === 'failing' || pr.review === 'CHANGES_REQUESTED')
        .map(pr => ({
          id: `pr-${pr.repo}-${pr.number}`,
          text: `${pr.repo.split('/').pop() ?? pr.repo}#${pr.number} ${pr.checks === 'failing' ? 'CI failing' : 'changes requested'} · ${pr.title}`,
          tone: 'fail' as const,
        })),
      title: 'PRs need action',
    },
  ]

  return sections.filter(section => section.rows.length > 0)
}
