import { duration, fit, percent, tokens, until } from '../lib/format'
import { modelLabel } from '../lib/pricing'
import { COLOR, Empty, Meter, Section } from './parts'

import type { RenderElement } from 'claude-code'
import type { Kit } from './parts'
import type { DeckAgent, DeckStep, DeckTool, DeckUsage } from '../../types'

export type SessionData = {
  usage: DeckUsage | null
  steps: DeckStep[]
  tools: DeckTool[]
  agents: DeckAgent[]
  now: number
}

const LIMIT_LABEL: Readonly<Record<string, string>> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }

const limitColor = (value: number): string => (value >= 90 ? COLOR.bad : value >= 70 ? COLOR.warn : COLOR.good)

export const sessionTab = (kit: Kit, data: SessionData, columns: number): RenderElement => {
  const { Box, Text } = kit
  const { usage } = data
  const context = usage?.contextPercent ?? 0
  const recentTools = [...data.tools].reverse().slice(0, 14)
  const recentSteps = [...data.steps].reverse().slice(0, 14)
  const loopName = (step: DeckStep): string =>
    step.agentId === undefined ? 'main' : (data.agents.find(agent => agent.agentId === step.agentId)?.nickname ?? 'agent')
  const nameWidth = Math.max(6, columns - 31)

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>ctx </Text>
        <Text color={limitColor(context)}>{context}%</Text>
        {(usage?.limits ?? []).map(limit => (
          <Text key={limit.kind}>
            <Text dimColor> {LIMIT_LABEL[limit.kind] ?? limit.kind} </Text>
            <Text color={limitColor(limit.percent)}>{Math.round(limit.percent)}%</Text>
          </Text>
        ))}
      </Text>
      {Section(kit, 'Context', columns, `${context}%`)}
      {usage === null && Empty(kit, 'Waiting for the first response.')}
      {usage !== null && (
        <Text dimColor>
          {tokens(usage.contextTokens)} of {tokens(usage.window)}
        </Text>
      )}
      {usage !== null && Meter(kit, '', context / 100, columns, COLOR.model, '')}
      {Section(kit, 'Limits', columns)}
      {(usage?.limits ?? []).length === 0 && Empty(kit, 'No rate-limit reading (off a subscription, or none yet).')}
      {(usage?.limits ?? []).map(limit =>
        Meter(
          kit,
          (LIMIT_LABEL[limit.kind] ?? limit.kind).padEnd(3),
          limit.percent / 100,
          columns,
          limitColor(limit.percent),
          `${Math.round(limit.percent)}% ${limit.resetsAt === undefined ? '' : `↻${until(limit.resetsAt, data.now)}`}`.trim(),
        ),
      )}
      {Section(kit, 'Tools', columns, String(data.tools.length))}
      {recentTools.length === 0 && Empty(kit, 'No tool call yet.')}
      {recentTools.map(tool => {
        const mark = tool.status === 'running' ? '…' : tool.status === 'error' ? '✗' : '✓'
        const color = tool.status === 'error' ? COLOR.bad : tool.status === 'running' ? COLOR.warn : COLOR.good

        return (
          <Box key={tool.id} justifyContent="space-between" width={columns}>
            <Text>
              <Text color={color}>{mark} </Text>
              <Text bold>{tool.tool.padEnd(6)}</Text>
              <Text dimColor> {fit(tool.detail, Math.max(4, columns - tool.tool.length - 12))}</Text>
            </Text>
            <Text dimColor>{tool.ms === undefined ? '' : duration(tool.ms)}</Text>
          </Box>
        )
      })}
      {Section(kit, 'Requests', columns, recentSteps[0] === undefined ? '' : modelLabel(recentSteps[0].model))}
      {recentSteps.length === 0 && Empty(kit, 'No model request yet.')}
      {recentSteps.length > 0 && (
        <Text dimColor>
          {'loop'.padEnd(nameWidth)}
          {'in'.padStart(7)}
          {'out'.padStart(7)}
          {'cache'.padStart(7)}
          {'time'.padStart(8)}
        </Text>
      )}
      {recentSteps.map(step => {
        const all = step.input + step.cacheRead + step.cacheWrite

        return (
          <Text key={step.key} color={step.isFailed ? COLOR.bad : undefined}>
            <Text bold={step.agentId === undefined}>{fit(loopName(step), nameWidth).padEnd(nameWidth)}</Text>
            {tokens(all).padStart(7)}
            {tokens(step.output).padStart(7)}
            {percent(step.cacheRead, all).padStart(7)}
            {duration(step.ms).padStart(8)}
          </Text>
        )
      })}
    </Box>
  )
}
