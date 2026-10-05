import { face, isLive } from '../lib/crew'
import { ago, duration, fit, tokens, usd } from '../lib/format'
import { addUp } from '../lib/ledger'
import { modelFamily, modelLabel } from '../lib/pricing'
import { COLOR, Empty, Section } from './parts'

import type { RenderElement } from 'claude-code'
import type { Kit } from './parts'
import type { DeckAgent, DeckPick, DeckSkill, DeckStep } from '../../types'

export type AgentsData = {
  agents: DeckAgent[]
  steps: DeckStep[]
  picks: DeckPick[]
  skills: DeckSkill[]
  frame: number
  now: number
}

const STATUS_COLOR: Readonly<Record<string, string>> = {
  completed: COLOR.good,
  failed: COLOR.bad,
  killed: COLOR.bad,
  running: COLOR.agent,
  waiting: COLOR.warn,
}

const card = (kit: Kit, label: string, value: string, width: number): RenderElement => {
  const { Box, Text } = kit

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR.muted} paddingX={1} width={width}>
      <Text dimColor>{label}</Text>
      <Text bold>{value}</Text>
    </Box>
  )
}

const agentRow = (kit: Kit, data: AgentsData, agent: DeckAgent, columns: number): RenderElement => {
  const { Box, Text } = kit
  const own = addUp(data.steps.filter(step => step.agentId === agent.agentId))
  const pick = data.picks.find(one => one.agentId === agent.agentId)
  const model = own.requests > 0 ? (data.steps.find(step => step.agentId === agent.agentId)?.model ?? agent.model) : agent.model
  const isMatch = pick === undefined || modelFamily(pick.recommended) === modelFamily(model)
  const color = STATUS_COLOR[agent.status] ?? COLOR.muted
  const time = duration((agent.endedAt ?? data.now) - agent.startedAt)

  return (
    <Box key={agent.agentId} flexDirection="row" width={columns}>
      <Text color={color}>{face(agent.type, agent.status, data.frame)}</Text>
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <Text bold>{fit(agent.nickname, Math.max(6, columns - 22))}</Text>
          <Text color={color}>{agent.status}</Text>
        </Box>
        <Text dimColor>{fit(agent.description, columns - 8)}</Text>
        <Text>
          <Text color={COLOR.model}>{modelLabel(model)}</Text>
          <Text dimColor>
            {' '}
            · {agent.type} · {tokens(own.input + own.cacheRead + own.cacheWrite + own.output)} tok · {usd(own.usd)} · {time}
          </Text>
        </Text>
        {pick !== undefined && (
          <Text color={isMatch ? COLOR.muted : COLOR.warn}>
            jev {pick.tier} → {modelLabel(pick.recommended)} ({pick.confidence.toFixed(2)}, {pick.backend})
            {isMatch ? '' : ` · ran ${modelLabel(model)}`}
            {pick.isApplied ? ' · applied' : ''}
          </Text>
        )}
      </Box>
    </Box>
  )
}

export const agentsTab = (kit: Kit, data: AgentsData, columns: number): RenderElement => {
  const { Box, Text } = kit
  const subSteps = data.steps.filter(step => step.agentId !== undefined)
  const totals = addUp(subSteps)
  const running = data.agents.filter(agent => isLive(agent.status) || agent.status === 'waiting')
  const done = data.agents.filter(agent => !running.includes(agent)).slice(-10).reverse()
  const first = data.agents[0]
  const span = first === undefined ? 0 : data.now - first.startedAt
  const cardWidth = Math.max(10, Math.floor((columns - 2) / 3))

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {card(kit, 'Cost', `≈${usd(totals.usd)}`, cardWidth)}
        {card(kit, 'Tokens', tokens(totals.input + totals.cacheRead + totals.cacheWrite + totals.output), cardWidth)}
        {card(kit, 'Time', duration(span), cardWidth)}
      </Box>
      {Section(kit, 'Running', columns, `${running.length}/${data.agents.length}`)}
      {running.length === 0 && Empty(kit, 'No subagent is running.')}
      {running.map(agent => agentRow(kit, data, agent, columns))}
      {Section(kit, 'Finished', columns, String(done.length))}
      {done.length === 0 && Empty(kit, 'None yet.')}
      {done.map(agent => agentRow(kit, data, agent, columns))}
      {Section(kit, 'Skills', columns, String(data.skills.length))}
      {data.skills.length === 0 && Empty(kit, 'No skill has run.')}
      {[...data.skills]
        .reverse()
        .slice(0, 8)
        .map((skill, index) => (
          <Box key={`skill-${index}`} justifyContent="space-between" width={columns}>
            <Text color={COLOR.accent}>{fit(skill.skill, columns - 10)}</Text>
            <Text dimColor>{ago(skill.at, data.now)}</Text>
          </Box>
        ))}
    </Box>
  )
}
