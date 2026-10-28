import { duration, fit, percent, tokens, until } from '../lib/format'
import { toolCounts } from '../lib/charts'
import { histogram } from '../lib/org'
import { modelLabel } from '../lib/pricing'
import { padEnd, padStart, spinner } from '../lib/theme'
import { Bars, Empty, Meter, Section, Spark, Tile, glyph } from './parts'

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

const ACTIVITY_BUCKETS = 30
const MINUTE = 60_000

const activity = (kit: Kit, data: SessionData, columns: number): RenderElement[] => {
  const { Box, Text, theme } = kit
  const width = Math.min(ACTIVITY_BUCKETS, Math.max(8, columns - 16))
  const counts = histogram(
    data.tools.map(tool => tool.startedAt),
    data.now,
    width,
    MINUTE,
  )
  const top = Math.max(0, ...counts)
  const low = Math.min(...counts, top)

  return [
    Section(kit, `${glyph(kit, 'chart')}Activity`, columns, 'tool calls / min'),
    <Box key="spark" columnGap={2} width={columns}>
      {Spark(kit, counts, width, theme.tool)}
      <Text dimColor>{fit(`min ${low} · max ${top} per min`, Math.max(0, columns - width - 2))}</Text>
    </Box>,
    <Box key="spark-axis" justifyContent="space-between" width={Math.min(columns, width)}>
      <Text dimColor>{`${width}m ago`}</Text>
      <Text dimColor>now</Text>
    </Box>,
  ]
}

export const sessionTab = (kit: Kit, data: SessionData, columns: number): RenderElement => {
  const { Box, Text, theme } = kit
  const { usage } = data
  const limitColor = (value: number): string => (value >= 90 ? theme.bad : value >= 70 ? theme.warn : theme.good)
  const context = usage?.contextPercent ?? 0
  const recentTools = [...data.tools].reverse().slice(0, 14)
  const recentSteps = [...data.steps].reverse().slice(0, 14)
  const counts = toolCounts(data.tools).slice(0, 6)
  const loopName = (step: DeckStep): string =>
    step.agentId === undefined
      ? `${kit.icon.coordinator} main`
      : `${kit.icon.helper} ${data.agents.find(agent => agent.agentId === step.agentId)?.nickname ?? 'agent'}`
  const nameWidth = Math.max(6, columns - 31)
  const tileWidth = Math.max(12, Math.floor((columns - 2) / 3))
  const limits = usage?.limits ?? []

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {Tile(kit, { color: limitColor(context), icon: 'model', key: 'tile-ctx', label: 'ctx', value: `${context}%` }, tileWidth)}
        {limits.map(limit =>
          Tile(
            kit,
            {
              color: limitColor(limit.percent),
              icon: 'clock',
              key: `tile-${limit.kind}`,
              label: LIMIT_LABEL[limit.kind] ?? limit.kind,
              value: `${Math.round(limit.percent)}%`,
            },
            tileWidth,
          ),
        )}
      </Box>
      {Section(kit, 'Context', columns, `${context}%`)}
      {usage === null && Empty(kit, 'Waiting for the first response.')}
      {usage !== null && (
        <Text dimColor>
          {tokens(usage.contextTokens)} of {tokens(usage.window)}
        </Text>
      )}
      {usage !== null && Meter(kit, '', context / 100, columns, limitColor(context), `${context}%`)}
      {Section(kit, 'Limits', columns)}
      {limits.length === 0 && Empty(kit, 'No rate-limit reading (off a subscription, or none yet).')}
      {limits.map(limit =>
        Meter(
          kit,
          padEnd(LIMIT_LABEL[limit.kind] ?? limit.kind, 3),
          limit.percent / 100,
          columns,
          limitColor(limit.percent),
          `${Math.round(limit.percent)}% ${limit.resetsAt === undefined ? '' : `${kit.icon.refresh}${until(limit.resetsAt, data.now)}`}`.trim(),
        ),
      )}
      {Section(kit, 'Tool histogram', columns, `${data.tools.length} calls`)}
      {counts.length === 0 && Empty(kit, 'No tool call yet.')}
      {counts.length > 0 &&
        Bars(
          kit,
          counts.map(entry => ({
            color: entry.errors > 0 ? theme.warn : theme.tool,
            key: `count-${entry.tool}`,
            label: entry.tool,
            text: entry.errors > 0 ? `${entry.count} (${entry.errors}${kit.icon.fail})` : String(entry.count),
            value: entry.count,
          })),
          columns,
        )}
      {activity(kit, data, columns)}
      {Section(kit, 'Tools', columns, String(data.tools.length))}
      {recentTools.length === 0 && Empty(kit, 'No tool call yet.')}
      {recentTools.map(tool => {
        const mark =
          tool.status === 'running' ? (kit.isAnimated ? spinner(kit.iconSet, kit.frame) : kit.icon.wait) : tool.status === 'error' ? kit.icon.fail : kit.icon.ok
        const color = tool.status === 'error' ? theme.bad : tool.status === 'running' ? theme.warn : theme.good

        return (
          <Box key={tool.id} justifyContent="space-between" width={columns}>
            <Text wrap="truncate-end">
              <Text color={color}>{mark} </Text>
              <Text bold color={theme.tool}>{padEnd(fit(tool.tool, 6), 6)}</Text>
              <Text dimColor> {fit(tool.detail, Math.max(4, columns - 12 - Math.max(6, tool.tool.length)))}</Text>
            </Text>
            <Text dimColor>{tool.ms === undefined ? '' : duration(tool.ms)}</Text>
          </Box>
        )
      })}
      {Section(kit, 'Requests', columns, recentSteps[0] === undefined ? '' : modelLabel(recentSteps[0].model))}
      {recentSteps.length === 0 && Empty(kit, 'No model request yet.')}
      {recentSteps.length > 0 && (
        <Text dimColor>
          {padEnd('loop', nameWidth)}
          {padStart('in', 7)}
          {padStart('out', 7)}
          {padStart('cache', 7)}
          {padStart('time', 8)}
        </Text>
      )}
      {recentSteps.map(step => {
        const all = step.input + step.cacheRead + step.cacheWrite

        return (
          <Text key={step.key} color={step.isFailed ? theme.bad : undefined}>
            <Text bold={step.agentId === undefined} color={step.agentId === undefined ? theme.coordinator : theme.agent}>
              {padEnd(fit(loopName(step), nameWidth), nameWidth)}
            </Text>
            {padStart(tokens(all), 7)}
            {padStart(tokens(step.output), 7)}
            {padStart(percent(step.cacheRead, all), 7)}
            {padStart(duration(step.ms), 8)}
          </Text>
        )
      })}
    </Box>
  )
}
