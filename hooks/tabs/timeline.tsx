import { duration, fit, percent } from '../lib/format'
import { timeline } from '../lib/ledger'
import { COLOR, Empty, Section } from './parts'

import type { RenderElement } from 'claude-code'
import type { Kit } from './parts'
import type { DeckStep, DeckTool, DeckTurn } from '../../types'

export type TimelineData = { turns: DeckTurn[]; steps: DeckStep[]; tools: DeckTool[]; now: number }

const KIND_COLOR = { failed: COLOR.bad, model: COLOR.model, tool: COLOR.tool } as const

export const timelineTab = (kit: Kit, data: TimelineData, columns: number): RenderElement => {
  const { Box, Text } = kit
  const turn = data.turns[data.turns.length - 1]

  if (turn === undefined) {
    return <Box flexDirection="column">{Empty(kit, 'The timeline fills in once a turn runs.')}</Box>
  }

  const view = timeline(turn, data.steps, data.tools, data.now)
  const width = Math.max(10, columns - 2)
  const scale = view.totalMs <= 0 ? 0 : width / view.totalMs
  const cells = view.segments.map(segment => ({
    color: KIND_COLOR[segment.kind],
    from: Math.max(0, Math.floor((segment.startedAt - turn.startedAt) * scale)),
    size: Math.max(1, Math.round(segment.ms * scale)),
  }))
  const lane: { text: string; color?: string }[] = []
  let cursor = 0

  cells.forEach(cell => {
    const start = Math.min(width, Math.max(cursor, cell.from))

    if (start > cursor) {
      lane.push({ text: '·'.repeat(start - cursor) })
    }

    const size = Math.min(width - start, cell.size)

    if (size > 0) {
      lane.push({ color: cell.color, text: '█'.repeat(size) })
    }
    cursor = start + size
  })
  if (cursor < width) {
    lane.push({ text: '·'.repeat(width - cursor) })
  }

  const rows = [
    { color: COLOR.model, label: 'model', ms: view.modelMs },
    ...view.byTool.map(entry => ({ color: COLOR.tool, label: entry.tool, ms: entry.ms })),
    { color: COLOR.muted, label: 'idle', ms: view.idleMs },
  ]
  const labelWidth = Math.min(12, Math.max(5, ...rows.map(row => row.label.length)))
  const barWidth = Math.max(4, columns - labelWidth - 14)

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>{turn.durationMs === undefined ? 'Running ' : 'Took '}</Text>
        <Text bold>{duration(view.totalMs)}</Text>
        <Text dimColor> model </Text>
        <Text color={COLOR.model}>{percent(view.modelMs, view.totalMs)}</Text>
        <Text dimColor> tools </Text>
        <Text color={COLOR.tool}>{percent(view.toolMs, view.totalMs)}</Text>
        <Text dimColor> idle </Text>
        <Text>{percent(view.idleMs, view.totalMs)}</Text>
      </Text>
      <Text dimColor>{fit(turn.text === '' ? '(continuation)' : turn.text, columns)}</Text>
      {Section(kit, 'Timeline', columns, `${view.segments.length} spans`)}
      <Text>
        {lane.map((piece, index) =>
          piece.color === undefined ? (
            <Text key={`lane-${index}`} dimColor>
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
        <Text color={COLOR.tool}>█</Text>
        <Text dimColor> tool </Text>
        <Text color={COLOR.model}>█</Text>
        <Text dimColor> model </Text>
        <Text color={COLOR.bad}>█</Text>
        <Text dimColor> failed · idle</Text>
      </Text>
      {Section(kit, 'Where time went', columns)}
      {rows.map(row => {
        const fraction = view.totalMs <= 0 ? 0 : row.ms / view.totalMs
        const filled = Math.min(barWidth, Math.round(fraction * barWidth))

        return (
          <Text key={`where-${row.label}`}>
            <Text color={row.color}>{fit(row.label, labelWidth).padEnd(labelWidth)} </Text>
            <Text color={row.color}>{'█'.repeat(filled)}</Text>
            <Text dimColor>{'·'.repeat(barWidth - filled)}</Text>
            <Text>{duration(row.ms).padStart(7)}</Text>
            <Text bold>{percent(row.ms, view.totalMs).padStart(5)}</Text>
          </Text>
        )
      })}
      {Section(kit, 'Slowest', columns)}
      {view.slowest.length === 0 && Empty(kit, 'Nothing measured yet.')}
      {view.slowest.map((entry, index) => (
        <Box key={`slow-${index}`} justifyContent="space-between" width={columns}>
          <Text>
            <Text color={entry.kind === 'model' ? COLOR.model : COLOR.tool}>{entry.kind === 'model' ? 'model ' : ''}</Text>
            <Text>{fit(entry.label, columns - 16)}</Text>
          </Text>
          <Text>{duration(entry.ms)}</Text>
        </Box>
      ))}
    </Box>
  )
}
