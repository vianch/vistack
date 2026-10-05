import { pending } from '../lib/board'
import { ago, basename, duration, fit, usd } from '../lib/format'
import { addUp } from '../lib/ledger'
import { COLOR, Empty, Line, Section } from './parts'

import type { RenderElement } from 'claude-code'
import type { Reply } from '../lib/board'
import type { Kit } from './parts'
import type { DeckAgent, DeckPrs, DeckStep, DeckTodo, DeckTool, DeckTurn, DeckWorkflow } from '../../types'

export type BoardData = {
  replies: Reply[]
  turns: DeckTurn[]
  steps: DeckStep[]
  tools: DeckTool[]
  agents: DeckAgent[]
  todos: DeckTodo[]
  prs: DeckPrs
  workflow: DeckWorkflow | null
  openId: string
  now: number
}

export type BoardActions = { toggle: (id: string) => void; refreshPrs: () => void }

const TONE = { fail: COLOR.bad, run: COLOR.agent, todo: COLOR.warn, wait: COLOR.muted } as const

const replyContext = (kit: Kit, data: BoardData, reply: Reply, columns: number): RenderElement => {
  const { Box, Text } = kit
  const turn = data.turns.find(one => one.turnId === reply.turnId) ?? data.turns[data.turns.length - 1]
  const own = data.steps.filter(step => step.agentId === undefined && step.turnId === turn?.turnId)
  const touched = data.tools
    .filter(tool => tool.turnId === turn?.turnId && ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool.tool))
    .map(tool => basename(tool.detail))
  const answerTail = (turn?.answer ?? '').trim().split('\n').filter(Boolean).slice(-3).join(' ')

  return (
    <Box flexDirection="column" paddingLeft={2} borderStyle="single" borderColor={COLOR.muted} width={columns}>
      <Text dimColor>You asked</Text>
      <Text>{fit(turn?.text ?? '-', (columns - 4) * 2)}</Text>
      {answerTail !== '' && <Text dimColor>Claude said</Text>}
      {answerTail !== '' && <Text>{fit(answerTail, (columns - 4) * 3)}</Text>}
      <Text dimColor>
        {touched.length === 0 ? 'No files touched' : `Touched ${[...new Set(touched)].slice(0, 6).join(', ')}`} · {usd(addUp(own).usd)} ·{' '}
        {duration(turn?.durationMs)}
      </Text>
    </Box>
  )
}

const prBlock = (kit: Kit, data: BoardData, actions: BoardActions, columns: number): RenderElement[] => {
  const { Box, Button, Text } = kit
  const { prs } = data
  const head = Section(kit, 'Open PRs', columns, prs.checkedAt === 0 ? '' : ago(prs.checkedAt, data.now))

  if (prs.state === 'off') {
    return [head, Empty(kit, 'Set the realm option (pluginConfigs) to list PRs with gh.')]
  }
  if (prs.state === 'out-of-realm') {
    return [head, Empty(kit, `Skipped: ${prs.reason ?? 'origin is outside the realm'}.`)]
  }

  const rows = prs.items.flatMap(pr => {
    const id = `pr-${pr.number}`
    const tone = pr.checks === 'failing' ? COLOR.bad : pr.checks === 'pending' ? COLOR.warn : COLOR.good
    const line = (
      <Box key={id} justifyContent="space-between" width={columns}>
        <Button key={`${id}-open`} plain label={fit(`#${pr.number} ${pr.title}`, columns - 22)} onPress={() => actions.toggle(id)} />
        <Text>
          <Text color={tone}>{pr.checks}</Text>
          <Text dimColor> {pr.isDraft ? 'draft' : pr.review.toLowerCase().replace(/_/g, ' ')}</Text>
        </Text>
      </Box>
    )

    if (data.openId !== id) {
      return [line]
    }

    return [
      line,
      <Box key={`${id}-detail`} flexDirection="column" paddingLeft={2}>
        <Text dimColor>{fit(`${pr.branch} · ${pr.url}`, columns - 2)}</Text>
        {pr.failing.length > 0 && <Text color={COLOR.bad}>{fit(`failing: ${pr.failing.join(', ')}`, columns - 2)}</Text>}
      </Box>,
    ]
  })

  return [
    head,
    ...(prs.state === 'error' ? [<Text color={COLOR.bad}>{fit(prs.reason ?? 'gh failed', columns)}</Text>] : []),
    ...(prs.state === 'loading' ? [Empty(kit, 'Loading…')] : []),
    ...(rows.length === 0 && prs.state === 'ok' ? [Empty(kit, 'No open PRs of yours.')] : rows),
    <Button key="pr-refresh" label="Refresh PRs" onPress={() => actions.refreshPrs()} />,
  ]
}

export const boardTab = (kit: Kit, data: BoardData, actions: BoardActions, columns: number): RenderElement => {
  const { Box, Button, Text } = kit
  const recent = [...data.turns].reverse().slice(0, 6)
  const sections = pending(data)

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>asks </Text>
        <Text bold>{data.turns.length}</Text>
        <Text dimColor> · needs reply </Text>
        <Text bold color={data.replies.length > 0 ? COLOR.warn : COLOR.good}>
          {data.replies.length}
        </Text>
        <Text dimColor> · open PRs </Text>
        <Text bold>{data.prs.items.length}</Text>
      </Text>
      {Section(kit, 'Needs reply', columns)}
      {data.replies.length === 0 && Empty(kit, 'Nothing waits on you.')}
      {data.replies.flatMap(reply => {
        const isOpen = data.openId === reply.id
        const row = (
          <Box key={reply.id} justifyContent="space-between" width={columns}>
            <Text color={reply.kind === 'plan' || reply.kind === 'question' ? COLOR.warn : COLOR.accent}>
              {fit(reply.text, columns - 14)}
            </Text>
            <Button key={`${reply.id}-ctx`} plain label={isOpen ? 'hide' : 'context'} onPress={() => actions.toggle(reply.id)} />
          </Box>
        )

        return isOpen ? [row, replyContext(kit, data, reply, columns)] : [row]
      })}
      {Section(kit, 'Recent asks', columns)}
      {recent.length === 0 && Empty(kit, 'No prompts yet this session.')}
      {recent.map(turn => {
        const own = data.steps.filter(step => step.agentId === undefined && step.turnId === turn.turnId)
        const right = `${turn.reason === undefined ? 'running' : duration(turn.durationMs)} ${usd(addUp(own).usd)}`

        return Line(kit, turn.text === '' ? '(continuation)' : turn.text, right, columns, undefined, turn.reason !== undefined)
      })}
      {prBlock(kit, data, actions, columns)}
      {sections.flatMap(section => [
        Section(kit, section.title, columns, String(section.rows.length)),
        ...section.rows.slice(0, 8).map(row => (
          <Text key={row.id} color={TONE[row.tone]}>
            {fit(`• ${row.text}`, columns)}
          </Text>
        )),
      ])}
      {sections.length === 0 && Section(kit, 'Pending', columns)}
      {sections.length === 0 && Empty(kit, 'Nothing pending.')}
      {data.openId !== '' && <Button key="close-all" plain dimColor label="collapse" onPress={() => actions.toggle('')} />}
    </Box>
  )
}
