import { duration, fit, percent, tokens, usd } from '../lib/format'
import { stepCosts } from '../lib/charts'
import { departmentOf } from '../lib/org'
import { addUp, byModel, cacheShare, executions } from '../lib/ledger'
import { modelLabel } from '../lib/pricing'
import { padEnd, padStart } from '../lib/theme'
import { Bars, Empty, Line, PickRows, Section, Spark, Tile, glyph } from './parts'

import type { RenderElement } from 'claude-code'
import type { BarEntry, Kit } from './parts'
import type { DeckAgent, DeckPick, DeckStep, DeckTool, DeckTurn, DeckUsage } from '../../types'

export type CostData = {
  steps: DeckStep[]
  turns: DeckTurn[]
  agents: DeckAgent[]
  tools: DeckTool[]
  picks: DeckPick[]
  usage: DeckUsage | null
  now: number
}

const RUNS_SHOWN = 8
const MEMBERS_SHOWN = 6
const PICKS_SHOWN = 3

const cell = (text: string, width: number): string => padStart(fit(text, width), width)

const memberCosts = (kit: Kit, data: CostData): BarEntry[] => {
  const { theme } = kit
  const mainCost = addUp(data.steps.filter(step => step.agentId === undefined)).usd
  const members = data.agents
    .map(agent => {
      const cost = addUp(data.steps.filter(step => step.agentId === agent.agentId)).usd

      return { color: theme.agent, key: `cost-${agent.agentId}`, label: agent.nickname, text: usd(cost), value: cost }
    })
    .filter(entry => entry.value > 0)
    .sort((left, right) => right.value - left.value)
  const coordinator = { color: theme.coordinator, key: 'cost-coordinator', label: 'Coordinator', text: usd(mainCost), value: mainCost }

  return [...(mainCost > 0 ? [coordinator] : []), ...members].slice(0, MEMBERS_SHOWN)
}

export const costTab = (kit: Kit, data: CostData, columns: number): RenderElement => {
  const { Box, Text, theme } = kit
  const all = addUp(data.steps)
  const models = byModel(data.steps)
  const runs = executions(data.steps, data.turns, data.agents, data.now).slice(0, RUNS_SHOWN)
  const toolErrors = data.tools.filter(tool => tool.status === 'error').length
  const engine = data.usage?.usd
  const labelWidth = Math.max(8, columns - 34)
  const tileWidth = Math.max(12, Math.floor((columns - 1) / 2))
  const members = memberCosts(kit, data)
  const newestPicks = [...data.picks].reverse().slice(0, PICKS_SHOWN)
  const kindIcon = (run: { id: string; kind: 'turn' | 'agent' }): string => {
    const agent = run.kind === 'agent' ? data.agents.find(one => one.agentId === run.id) : undefined

    return agent === undefined ? kit.icon.coordinator : kit.icon[departmentOf(agent).icon]
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {Tile(kit, { color: theme.cost, icon: 'cost', key: 'tile-engine', label: 'engine total', value: usd(engine) }, tileWidth)}
        {Tile(kit, { color: theme.accent, icon: 'chart', key: 'tile-estimate', label: 'estimate', value: `${usd(all.usd)}${all.isPartial ? ' *' : ''}` }, tileWidth)}
        {Tile(kit, { color: theme.model, icon: 'model', key: 'tile-requests', label: 'requests', value: String(all.requests) }, tileWidth)}
        {Tile(kit, { color: theme.good, icon: 'refresh', key: 'tile-cache', label: 'cache share', value: percent(cacheShare(all) * 100, 100) }, tileWidth)}
      </Box>
      {all.isPartial && <Text color={theme.warn}>{glyph(kit, 'warn')}* unpriced model seen</Text>}
      <Text dimColor>
        {tokens(all.input + all.cacheRead + all.cacheWrite)} in · {tokens(all.output)} out · failed {all.failed} · tool errors {toolErrors}
      </Text>
      {Section(kit, 'Per model', columns)}
      {models.length === 0 && Empty(kit, 'No model request yet.')}
      {models.length > 0 && (
        <Text dimColor>
          {padEnd('model', labelWidth)}
          {cell('req', 5)}
          {cell('in', 7)}
          {cell('out', 7)}
          {cell('cache', 6)}
          {cell('cost', 9)}
        </Text>
      )}
      {models.map(({ model, totals }) => (
        <Text key={model}>
          <Text color={theme.model}>{padEnd(fit(modelLabel(model), labelWidth), labelWidth)}</Text>
          {cell(String(totals.requests), 5)}
          {cell(tokens(totals.input + totals.cacheRead + totals.cacheWrite), 7)}
          {cell(tokens(totals.output), 7)}
          {cell(percent(cacheShare(totals) * 100, 100), 6)}
          <Text color={theme.cost}>{cell(usd(totals.usd), 9)}</Text>
        </Text>
      ))}
      {models.length > 0 &&
        Bars(
          kit,
          models.map(({ model, totals }, index) => ({
            color: theme.ramp[Math.max(0, theme.ramp.length - 1 - index)] ?? theme.cost,
            key: `bar-${model}`,
            label: modelLabel(model),
            text: usd(totals.usd),
            value: totals.usd,
          })),
          columns,
        )}
      {Section(kit, `${glyph(kit, 'chart')}Cost by member`, columns, `top ${MEMBERS_SHOWN}`)}
      {members.length === 0 ? Empty(kit, 'No cost recorded yet.') : Bars(kit, members, columns)}
      {Section(kit, 'Per execution', columns, 'newest first')}
      {runs.length === 0 && Empty(kit, 'Nothing has run yet.')}
      {runs.map(run => {
        const costs = stepCosts(data.steps, run)

        return (
          <Box key={run.id} flexDirection="column" width={columns}>
            {Line(
              kit,
              `${kindIcon(run)} ${run.label}`,
              `${duration(run.ms)} ${usd(run.totals.usd)}`,
              columns,
              run.kind === 'agent' ? theme.agent : undefined,
            )}
            <Box>
              <Text>{'  '}</Text>
              {costs.length > 1 && Spark(kit, costs, 10, theme.cost)}
              <Text dimColor>
                {costs.length > 1 ? ' ' : ''}
                {fit(
                  `${run.models.map(modelLabel).join(', ') || '-'} · ${run.totals.requests} req · ${tokens(run.totals.input + run.totals.cacheRead + run.totals.cacheWrite + run.totals.output)} tok · cache ${percent(cacheShare(run.totals) * 100, 100)} · ${run.status}${run.totals.failed > 0 ? ` · ${run.totals.failed} failed` : ''}`,
                  Math.max(8, columns - (costs.length > 1 ? 14 : 2)),
                )}
              </Text>
            </Box>
          </Box>
        )
      })}
      {Section(kit, 'Fork picks', columns, 'see Decisions (8)')}
      {newestPicks.length === 0 && Empty(kit, 'No fork asked yet. Run /vistack:decisions-on to add a model tier.')}
      {newestPicks.flatMap(pick => PickRows(kit, pick, columns, { agents: data.agents }))}
    </Box>
  )
}
