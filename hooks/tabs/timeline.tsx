import { duration, fit, percent } from '../lib/format'
import { timeline } from '../lib/ledger'
import { spinner } from '../lib/theme'
import { Bars, Empty, Section, Tile } from './parts'

import type { RenderElement } from 'claude-code'
import type { Kit } from './parts'
import type { DeckStep, DeckTool, DeckTurn } from '../../types'

export type TimelineData = { turns: DeckTurn[]; steps: DeckStep[]; tools: DeckTool[]; now: number }

// The key prefix of advisorSteps (hooks/lib/advisor.ts). A server consult runs inside the request
// that made it, whose step already spans its time.
const ADVISOR_STEP = 'advisor-'

export const timelineTab = (kit: Kit, data: TimelineData, columns: number): RenderElement => {
  const { Box, Text, theme } = kit
  const KIND_COLOR = { failed: theme.bad, model: theme.model, tool: theme.tool } as const
  const turn = data.turns[data.turns.length - 1]

  if (turn === undefined) {
    return <Box flexDirection="column">{Empty(kit, 'The timeline fills in once a turn runs.')}</Box>
  }

  const requests = data.steps.filter(step => !step.key.startsWith(ADVISOR_STEP))
  const view = timeline(turn, requests, data.tools, data.now)
  const isRunning = turn.durationMs === undefined
  const width = Math.max(10, columns - 2)
  const scale = view.totalMs <= 0 ? 0 : width / view.totalMs
  const spans = view.segments.map(segment => ({
    color: KIND_COLOR[segment.kind],
    from: Math.max(0, Math.floor((segment.startedAt - turn.startedAt) * scale)),
    size: Math.max(1, Math.round(segment.ms * scale)),
  }))
  const lane: { text: string; color?: string }[] = []
  let cursor = 0

  spans.forEach(span => {
    const start = Math.min(width, Math.max(cursor, span.from))

    if (start > cursor) {
      lane.push({ text: '·'.repeat(start - cursor) })
    }

    const size = Math.min(width - start, span.size)

    if (size > 0) {
      lane.push({ color: span.color, text: '█'.repeat(size) })
    }
    cursor = start + size
  })
  if (cursor < width) {
    lane.push({ text: '·'.repeat(width - cursor) })
  }

  const rows = [
    { color: theme.model, label: `${kit.icon.model} model`, ms: view.modelMs },
    ...view.byTool.map(entry => ({ color: theme.tool, label: `${kit.icon.tool} ${entry.tool}`, ms: entry.ms })),
    { color: theme.muted, label: `${kit.icon.idle} idle`, ms: view.idleMs },
  ]
  const tileWidth = Math.max(12, Math.floor((columns - 2) / 3))
  const live = isRunning ? (kit.isAnimated ? spinner(kit.iconSet, kit.frame) : kit.icon.live) : kit.icon.ok

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={isRunning ? theme.agent : theme.good}>{live} </Text>
        <Text dimColor>{isRunning ? 'Running ' : 'Took '}</Text>
        <Text bold>{duration(view.totalMs)}</Text>
        {isRunning && <Text color={theme.agent}> running</Text>}
      </Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {Tile(kit, { color: theme.model, icon: 'model', key: 'tile-model', label: 'model', value: percent(view.modelMs, view.totalMs) }, tileWidth)}
        {Tile(kit, { color: theme.tool, icon: 'tool', key: 'tile-tools', label: 'tools', value: percent(view.toolMs, view.totalMs) }, tileWidth)}
        {Tile(kit, { color: theme.muted, icon: 'idle', key: 'tile-idle', label: 'idle', value: percent(view.idleMs, view.totalMs) }, tileWidth)}
      </Box>
      <Text dimColor>{fit(turn.text === '' ? '(continuation)' : turn.text, columns)}</Text>
      {Section(kit, 'Timeline', columns, `${view.segments.length} spans`)}
      <Text>
        {lane.map((piece, index) =>
          piece.color === undefined ? (
            <Text key={`lane-${index}`} color={theme.muted}>
              {piece.text}
            </Text>
          ) : (
            <Text key={`lane-${index}`} color={piece.color}>
              {piece.text}
            </Text>
          ),
        )}
      </Text>
      <Box justifyContent="space-between" width={width}>
        <Text dimColor>0</Text>
        <Text dimColor>{duration(view.totalMs / 2)}</Text>
        <Text dimColor>{duration(view.totalMs)}</Text>
      </Box>
      <Text>
        <Text color={theme.tool}>█</Text>
        <Text dimColor> {kit.icon.tool} tool </Text>
        <Text color={theme.model}>█</Text>
        <Text dimColor> {kit.icon.model} model </Text>
        <Text color={theme.bad}>█</Text>
        <Text dimColor> {kit.icon.fail} failed · idle</Text>
      </Text>
      {Section(kit, 'Where time went', columns)}
      {Bars(
        kit,
        rows.map(row => ({
          color: row.color,
          key: `where-${row.label}`,
          label: row.label,
          text: `${duration(row.ms)} ${percent(row.ms, view.totalMs)}`,
          value: row.ms,
        })),
        columns,
      )}
      {Section(kit, 'Slowest', columns)}
      {view.slowest.length === 0 && Empty(kit, 'Nothing measured yet.')}
      {view.slowest.map((entry, index) => (
        <Box key={`slow-${index}`} justifyContent="space-between" width={columns}>
          <Text wrap="truncate-end">
            <Text color={entry.kind === 'model' ? theme.model : theme.tool}>
              {entry.kind === 'model' ? kit.icon.model : kit.icon.tool}{' '}
            </Text>
            <Text>{fit(entry.label, Math.max(4, columns - 16))}</Text>
          </Text>
          <Text bold>{duration(entry.ms)}</Text>
        </Box>
      ))}
    </Box>
  )
}
