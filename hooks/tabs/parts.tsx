import { bar, fit } from '../lib/format'

import type { Elements, RenderElement } from 'claude-code'

// The elements every tab draws with; the terminal and desktop tables both carry them.
export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input'>

export const COLOR = {
  accent: 'cyan',
  agent: '#c4a7ff',
  bad: 'red',
  cost: '#f5c26b',
  good: 'green',
  model: '#a5a3f2',
  muted: 'gray',
  tool: 'green',
  warn: 'yellow',
} as const

// "── Title ─────────── right ─", the width of the pane body.
export const Section = (kit: Kit, title: string, columns: number, right = ''): RenderElement => {
  const { Box, Text } = kit
  const used = title.length + right.length + 6
  const rule = '─'.repeat(Math.max(1, columns - used))

  return (
    <Box marginTop={1}>
      <Text color={COLOR.muted}>── </Text>
      <Text bold color={COLOR.accent}>
        {title}
      </Text>
      <Text color={COLOR.muted}> {rule} </Text>
      <Text dimColor>{right}</Text>
      <Text color={COLOR.muted}>{right === '' ? '' : ' ─'}</Text>
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
  const { Box, Text } = kit
  const width = Math.max(4, columns - label.length - right.length - 3)
  const cells = bar(fraction, width)

  return (
    <Box>
      <Text>{label} </Text>
      <Text color={color}>{cells.full}</Text>
      <Text color={COLOR.muted}>{cells.empty}</Text>
      <Text> {right}</Text>
    </Box>
  )
}

// Left text truncated so the right text always fits on the line.
export const Line = (kit: Kit, left: string, right: string, columns: number, color?: string, isDim = false): RenderElement => {
  const { Box, Text } = kit
  const room = Math.max(4, columns - right.length - 1)

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
