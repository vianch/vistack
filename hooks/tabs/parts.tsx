import { bar, clockTime, fit } from '../lib/format'
import { bars, commLabel, sparkline } from '../lib/org'
import { cells, padEnd, spinner } from '../lib/theme'

import type { Elements, RenderElement } from 'claude-code'
import type { IconName, IconSet, Palette } from '../lib/theme'
import type { DeckActivity, DeckAgent, DeckComm, DeckIcons } from '../../types'

// The elements every tab draws with; the terminal and desktop tables both carry them.
export type KitElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input' | 'Select'>

// The elements plus the person's theme and icons and the animation frame.
export type Kit = KitElements & {
  theme: Palette
  icon: IconSet
  iconSet: DeckIcons
  frame: number
  isAnimated: boolean
}

export const glyph = (kit: Kit, name: IconName): string => `${kit.icon[name]} `

export const pulse = (kit: Kit, isLive: boolean, still: string): string =>
  isLive && kit.isAnimated ? spinner(kit.iconSet, kit.frame) : still

// "── Title ─────────── right ─", the width of the pane body.
export const Section = (kit: Kit, title: string, columns: number, right = ''): RenderElement => {
  const { Box, Text, theme } = kit
  const shownRight = fit(right, Math.max(0, columns - cells(title) - 8))
  const used = cells(title) + cells(shownRight) + 6
  const rule = '─'.repeat(Math.max(1, columns - used))

  return (
    <Box marginTop={1}>
      <Text color={theme.muted}>── </Text>
      <Text bold color={theme.accent}>
        {title}
      </Text>
      <Text color={theme.muted}> {rule} </Text>
      <Text dimColor>{shownRight}</Text>
      <Text color={theme.muted}>{shownRight === '' ? '' : ' ─'}</Text>
    </Box>
  )
}

export const Meter = (
  kit: Kit,
  label: string,
  fraction: number,
  columns: number,
  color: string,
  right: string,
): RenderElement => {
  const { Box, Text, theme } = kit
  const width = Math.max(4, columns - cells(label) - cells(right) - 3)
  const filled = bar(fraction, width)

  return (
    <Box>
      <Text>{label} </Text>
      <Text color={color}>{filled.full}</Text>
      <Text color={theme.muted}>{filled.empty}</Text>
      <Text> {right}</Text>
    </Box>
  )
}

// Left text truncated so the right text always fits on the line.
export const Line = (kit: Kit, left: string, right: string, columns: number, color?: string, isDim = false): RenderElement => {
  const { Box, Text } = kit
  const room = Math.max(4, columns - cells(right) - 1)

  return (
    <Box justifyContent="space-between" width={columns}>
      {color === undefined ? <Text dimColor={isDim}>{fit(left, room)}</Text> : <Text color={color}>{fit(left, room)}</Text>}
      <Text dimColor>{right}</Text>
    </Box>
  )
}

export const Empty = (kit: Kit, text: string): RenderElement => {
  const { Text } = kit

  return <Text dimColor>{text}</Text>
}

// A KPI card.
export const Tile = (
  kit: Kit,
  tile: { key: string; icon: IconName; label: string; value: string; color: string },
  width: number,
): RenderElement => {
  const { Box, Text, theme } = kit
  const inner = Math.max(1, width - 4)

  return (
    <Box key={tile.key} flexDirection="column" borderStyle="round" borderColor={theme.muted} paddingX={1} width={width}>
      <Text dimColor>{fit(`${glyph(kit, tile.icon)}${tile.label}`, inner)}</Text>
      <Text bold color={tile.color}>
        {fit(tile.value, inner)}
      </Text>
    </Box>
  )
}

// A status pill.
export const Chip = (kit: Kit, text: string, color: string): RenderElement => {
  const { Text } = kit

  return (
    <Text color={color} inverse>
      {` ${text} `}
    </Text>
  )
}

export type BarEntry = { key: string; label: string; value: number; text: string; color?: string }

export const Bars = (kit: Kit, entries: readonly BarEntry[], columns: number): RenderElement[] => {
  const { Box, Text, theme } = kit
  const labelWidth = Math.min(16, Math.max(4, ...entries.map(entry => cells(entry.label))))
  const textWidth = Math.max(1, ...entries.map(entry => cells(entry.text)))
  const rows = bars(entries, Math.max(4, columns - labelWidth - textWidth - 2))

  return rows.map(row => (
    <Box key={row.key} width={columns}>
      <Text>{padEnd(fit(row.label, labelWidth), labelWidth)} </Text>
      <Text color={row.color ?? theme.accent}>{row.full}</Text>
      <Text color={theme.muted}>{row.empty}</Text>
      <Text bold> {row.text}</Text>
    </Box>
  ))
}

// A sparkline of `values`, the newest at the right.
export const Spark = (kit: Kit, values: readonly number[], width: number, color: string): RenderElement => {
  const { Text } = kit

  return <Text color={color}>{sparkline(values, width)}</Text>
}

export const statusColor = (kit: Kit, status: string): string => {
  const { theme } = kit

  if (status === 'running' || status === 'pending') {
    return theme.agent
  }
  if (status === 'waiting' || status === 'idle') {
    return theme.warn
  }
  if (status === 'completed') {
    return theme.good
  }

  return status === 'failed' || status === 'killed' ? theme.bad : theme.muted
}

export const COMM_ICON: Readonly<Record<DeckComm['kind'], IconName>> = {
  action: 'spark',
  advice: 'idea',
  answer: 'answer',
  dispatch: 'dispatch',
  message: 'message',
  prompt: 'message',
  question: 'question',
  report: 'report',
}

export const ACTIVITY_ICON: Readonly<Record<DeckActivity['kind'], IconName>> = { thinking: 'idea', tool: 'tool', writing: 'answer' }

// "12:04:09  🧭 → 🔍 Sherlock  📨 dispatch: map the call sites", one line.
export const CommRow = (kit: Kit, comm: DeckComm, agents: readonly DeckAgent[], columns: number): RenderElement => {
  const { Text, theme } = kit
  const from = commLabel(comm.from, agents)
  const to = commLabel(comm.to, agents)
  const time = clockTime(comm.at)
  const toName = fit(to.name, 14)
  const kind = `${kit.icon[COMM_ICON[comm.kind]]} ${comm.kind}: `
  const lead = `${time}  ${kit.icon[from.icon]} → ${kit.icon[to.icon]} ${toName}  ${kind}`

  return (
    <Text key={`comm-${comm.id}`} wrap="truncate-end">
      <Text dimColor>{time} </Text>
      <Text> {kit.icon[from.icon]} </Text>
      <Text color={theme.muted}>→ </Text>
      <Text>{kit.icon[to.icon]} </Text>
      <Text bold>{toName}</Text>
      <Text dimColor>  {kind}</Text>
      <Text>{fit(comm.text, Math.max(0, columns - cells(lead)))}</Text>
    </Text>
  )
}

export type HeaderSegment = { key: string; icon: IconName; text: string; color: string }

// `extra` segments follow the cost.
export type HeaderInfo = {
  project: string
  branch: string
  model: string
  uptime: string
  cost: string
  extra?: readonly HeaderSegment[]
}

// "📦 repo  🌿 branch  🧠 model  🕒 uptime  💰 cost", dropping from the right what does not fit.
export const Header = (kit: Kit, info: HeaderInfo, columns: number): RenderElement => {
  const { Box, Text, theme } = kit
  const segments: readonly HeaderSegment[] = [
    { color: theme.accent, icon: 'project', key: 'project', text: info.project },
    { color: theme.good, icon: 'branch', key: 'branch', text: info.branch },
    { color: theme.model, icon: 'model', key: 'model', text: info.model },
    { color: theme.accent2, icon: 'clock', key: 'uptime', text: info.uptime },
    { color: theme.cost, icon: 'cost', key: 'cost', text: info.cost },
    ...(info.extra ?? []),
  ]
  const shown: { key: string; text: string; color: string }[] = []
  let used = 0

  for (const segment of segments) {
    const text = fit(`${kit.icon[segment.icon]} ${segment.text}`, columns)
    const size = cells(text) + (shown.length === 0 ? 0 : 2)

    if (used + size > columns) {
      break
    }
    shown.push({ color: segment.color, key: segment.key, text })
    used += size
  }

  return (
    <Box key="deck-header" columnGap={2} width={columns}>
      {shown.map(segment => (
        <Text key={`head-${segment.key}`} bold={segment.key === 'project'} color={segment.color}>
          {segment.text}
        </Text>
      ))}
    </Box>
  )
}
