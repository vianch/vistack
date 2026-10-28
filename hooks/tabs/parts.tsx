import { bar, clockTime, duration, fit } from '../lib/format'
import { backendLabel, pickStatus, pickTrigger } from '../lib/jev'
import { bars, commLabel, sparkline } from '../lib/org'
import { modelLabel } from '../lib/pricing'
import { cells, padEnd, spinner } from '../lib/theme'

import type { Elements, RenderElement } from 'claude-code'
import type { IconName, IconSet, Palette } from '../lib/theme'
import type { DeckActivity, DeckAgent, DeckComm, DeckIcons, DeckPick } from '../../types'

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

const headUsed = (title: string, right: string): number => cells(`── ${title}  `) + (right === '' ? 0 : cells(`${right} ─`))

// "── Title ─────────── right ─", the width of the pane body.
export const Section = (kit: Kit, title: string, columns: number, right = ''): RenderElement => {
  const { Box, Text, theme } = kit
  const shownRight = fit(right, Math.max(0, columns - cells(title) - 8))
  const rule = '─'.repeat(Math.max(1, columns - headUsed(title, shownRight)))

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

export type FoldHead = { id: string; title: string; right?: string; isFolded: boolean; onToggle: () => void }

const FOLD_MARKS: Readonly<Record<DeckIcons, { open: string; folded: string }>> = {
  ascii: { folded: '>', open: 'v' },
  emoji: { folded: '▸', open: '▾' },
  unicode: { folded: '▸', open: '▾' },
}

export const Fold = (kit: Kit, fold: FoldHead, columns: number): RenderElement => {
  const { Box, Button, Text, theme } = kit
  const marks = FOLD_MARKS[kit.iconSet]
  const label = `${fold.isFolded ? marks.folded : marks.open} ${fold.title}`
  const shownRight = fit(fold.right ?? '', Math.max(0, columns - cells(label) - 8))
  const rule = '─'.repeat(Math.max(1, columns - headUsed(label, shownRight)))

  return (
    <Box key={`fold-head-${fold.id}`} marginTop={1}>
      <Text color={theme.muted}>── </Text>
      <Button key={`fold-${fold.id}`} plain label={label} onPress={() => fold.onToggle()} />
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

const TRIGGER_MARKS: Readonly<Record<DeckIcons, Readonly<Record<DeckPick['trigger'], string>>>> = {
  ascii: { prompt: '>', spawn: '+', 'spawn-apply': '+' },
  emoji: { prompt: '⌨', spawn: '◇', 'spawn-apply': '◆' },
  unicode: { prompt: '⌨', spawn: '◇', 'spawn-apply': '◆' },
}

const confidenceText = (confidence: number): string => {
  const text = confidence.toFixed(2)

  return text.startsWith('0') ? text.slice(1) : text
}

const PICK_INDENT = '   '

// fit() collapses runs of spaces, so the indent stays outside it.
const pickResult = (kit: Kit, pick: DeckPick, columns: number): RenderElement => {
  const { Text, theme } = kit
  const key = `fork-${pick.id}-result`
  const room = Math.max(0, columns - PICK_INDENT.length)
  const took = pick.ms === undefined ? '' : duration(pick.ms)
  const status = pickStatus(pick)

  if (status === 'deciding') {
    return (
      <Text key={key} color={theme.warn}>
        {PICK_INDENT}
        {fit(`${pulse(kit, true, kit.icon.wait)} asking the fork layer…`, room)}
      </Text>
    )
  }
  if (status === 'failed') {
    return (
      <Text key={key} color={theme.bad}>
        {PICK_INDENT}
        {fit([`${kit.icon.fail} failed: ${pick.error ?? 'no reason given'}`, took].filter(part => part !== '').join(' · '), room)}
      </Text>
    )
  }
  if (status === 'skipped') {
    return (
      <Text key={key} dimColor>
        {PICK_INDENT}
        {fit(`skipped: ${pick.skippedWhy ?? 'no reason given'}`, room)}
      </Text>
    )
  }

  const model = modelLabel(pick.recommended)
  const lead = `${PICK_INDENT}${pick.tier} ▸ ${model} · `
  const rest = [confidenceText(pick.confidence), backendLabel(pick.backend), pick.fork ?? '', took, pick.isApplied ? 'applied' : '']
    .filter(part => part !== '')
    .join(' · ')

  return (
    <Text key={key}>
      <Text>{PICK_INDENT}</Text>
      <Text color={theme.accent}>{pick.tier}</Text>
      <Text color={theme.muted}> ▸ </Text>
      <Text color={theme.model}>{model}</Text>
      <Text dimColor> · </Text>
      <Text dimColor>{fit(rest, Math.max(0, columns - cells(lead)))}</Text>
    </Text>
  )
}

const pickSubject = (kit: Kit, pick: DeckPick, agents: readonly DeckAgent[], columns: number): string => {
  const lead = fit(`${clockTime(pick.at).slice(0, 5)} ${TRIGGER_MARKS[kit.iconSet][pickTrigger(pick)]} ${pick.subject}`, columns)
  const nickname = pick.agentId === undefined ? undefined : agents.find(agent => agent.agentId === pick.agentId)?.nickname
  const named = `${lead} · ${nickname ?? ''}`

  return nickname === undefined || cells(named) > columns ? lead : named
}

export type PickRowsOptions = { agents?: readonly DeckAgent[]; onPress?: () => void }

export const PickRows = (kit: Kit, pick: DeckPick, columns: number, options: PickRowsOptions = {}): RenderElement[] => {
  const { Button, Text } = kit
  const { onPress } = options
  const subject = pickSubject(kit, pick, options.agents ?? [], columns)

  return [
    onPress === undefined ? (
      <Text key={`fork-${pick.id}-subject`}>{subject}</Text>
    ) : (
      <Button key={`pick-${pick.id}`} plain label={subject} onPress={() => onPress()} />
    ),
    pickResult(kit, pick, columns),
  ]
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
