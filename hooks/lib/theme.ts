// Colour themes, icon sets, and the cell-width math that keeps emoji from breaking a pane's columns.
import type { DeckIcons, DeckSettings } from '../../types'

export type Palette = {
  label: string
  accent: string
  accent2: string
  user: string
  coordinator: string
  advisor: string
  agent: string
  model: string
  tool: string
  cost: string
  good: string
  warn: string
  bad: string
  muted: string
  // Chart colours, low to high.
  ramp: readonly string[]
}

export const THEMES: Readonly<Record<string, Palette>> = {
  aurora: {
    accent: '#5eead4',
    accent2: '#f0abfc',
    advisor: '#fcd34d',
    agent: '#c4a7ff',
    bad: '#fb7185',
    coordinator: '#38bdf8',
    cost: '#f5c26b',
    good: '#4ade80',
    label: 'Aurora',
    model: '#a5a3f2',
    muted: 'gray',
    ramp: ['#1e3a5f', '#2563eb', '#38bdf8', '#5eead4', '#a7f3d0'],
    tool: '#34d399',
    user: '#f9a8d4',
    warn: '#fbbf24',
  },
  dracula: {
    accent: '#bd93f9',
    accent2: '#ff79c6',
    advisor: '#f1fa8c',
    agent: '#bd93f9',
    bad: '#ff5555',
    coordinator: '#8be9fd',
    cost: '#ffb86c',
    good: '#50fa7b',
    label: 'Dracula',
    model: '#caa9fa',
    muted: '#6272a4',
    ramp: ['#44475a', '#6272a4', '#bd93f9', '#ff79c6', '#f1fa8c'],
    tool: '#50fa7b',
    user: '#ff79c6',
    warn: '#f1fa8c',
  },
  gruvbox: {
    accent: '#fabd2f',
    accent2: '#fe8019',
    advisor: '#d3869b',
    agent: '#83a598',
    bad: '#fb4934',
    coordinator: '#8ec07c',
    cost: '#fabd2f',
    good: '#b8bb26',
    label: 'Gruvbox',
    model: '#83a598',
    muted: '#928374',
    ramp: ['#3c3836', '#665c54', '#d79921', '#fabd2f', '#fe8019'],
    tool: '#b8bb26',
    user: '#fe8019',
    warn: '#fabd2f',
  },
  matrix: {
    accent: '#00ff41',
    accent2: '#39ff14',
    advisor: '#ccff00',
    agent: '#00d936',
    bad: '#ff3131',
    coordinator: '#00ff9c',
    cost: '#b6ff00',
    good: '#00ff41',
    label: 'Matrix',
    model: '#7dff9b',
    muted: '#1f7a3a',
    ramp: ['#003b00', '#008f11', '#00c92e', '#00ff41', '#b6ffb6'],
    tool: '#00ff41',
    user: '#ccffcc',
    warn: '#d4ff00',
  },
  mono: {
    accent: 'white',
    accent2: 'white',
    advisor: 'white',
    agent: 'white',
    bad: 'white',
    coordinator: 'white',
    cost: 'white',
    good: 'white',
    label: 'Mono',
    model: 'white',
    muted: 'gray',
    ramp: ['#3a3a3a', '#5a5a5a', '#8a8a8a', '#bababa', '#eaeaea'],
    tool: 'white',
    user: 'white',
    warn: 'white',
  },
  nord: {
    accent: '#88c0d0',
    accent2: '#b48ead',
    advisor: '#ebcb8b',
    agent: '#b48ead',
    bad: '#bf616a',
    coordinator: '#81a1c1',
    cost: '#ebcb8b',
    good: '#a3be8c',
    label: 'Nord',
    model: '#8fbcbb',
    muted: '#4c566a',
    ramp: ['#3b4252', '#4c566a', '#5e81ac', '#81a1c1', '#88c0d0'],
    tool: '#a3be8c',
    user: '#d08770',
    warn: '#ebcb8b',
  },
  sunset: {
    accent: '#ff9e64',
    accent2: '#ff6ac1',
    advisor: '#ffd166',
    agent: '#f78fb3',
    bad: '#ef476f',
    coordinator: '#ffa45b',
    cost: '#ffd166',
    good: '#06d6a0',
    label: 'Sunset',
    model: '#f6a6ff',
    muted: '#8d6e8f',
    ramp: ['#3d1e3a', '#7b2d5b', '#c44569', '#ff6b6b', '#ffd166'],
    tool: '#06d6a0',
    user: '#ff6ac1',
    warn: '#ffd166',
  },
  'tokyo-night': {
    accent: '#7aa2f7',
    accent2: '#bb9af7',
    advisor: '#e0af68',
    agent: '#bb9af7',
    bad: '#f7768e',
    coordinator: '#7dcfff',
    cost: '#e0af68',
    good: '#9ece6a',
    label: 'Tokyo Night',
    model: '#2ac3de',
    muted: '#565f89',
    ramp: ['#24283b', '#414868', '#3d59a1', '#7aa2f7', '#7dcfff'],
    tool: '#9ece6a',
    user: '#ff9e64',
    warn: '#e0af68',
  },
}

export const DEFAULT_THEME = 'aurora'

export const DEFAULT_SETTINGS: DeckSettings = { icons: 'emoji', isAnimated: true, placement: 'right', realm: '', theme: DEFAULT_THEME }

export const PLACEMENTS: readonly DeckSettings['placement'][] = ['right', 'bottom', 'hidden']

export const ICON_SETS: readonly DeckIcons[] = ['emoji', 'unicode', 'ascii']

export const paletteOf = (name: string): Palette => THEMES[name] ?? THEMES[DEFAULT_THEME] ?? (Object.values(THEMES)[0] as Palette)

// Settings read back from the store: anything unknown falls back to the default.
export const readSettings = (raw: unknown): DeckSettings => {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const placement = PLACEMENTS.find(one => one === value.placement) ?? DEFAULT_SETTINGS.placement
  const icons = ICON_SETS.find(one => one === value.icons) ?? DEFAULT_SETTINGS.icons
  const theme = typeof value.theme === 'string' && THEMES[value.theme] !== undefined ? value.theme : DEFAULT_THEME

  const realm = typeof value.realm === 'string' ? value.realm.trim() : ''

  return { icons, isAnimated: value.isAnimated !== false, placement, realm, theme }
}

export type IconName =
  | 'user'
  | 'coordinator'
  | 'advisor'
  | 'org'
  | 'project'
  | 'branch'
  | 'model'
  | 'clock'
  | 'cost'
  | 'tokens'
  | 'tool'
  | 'message'
  | 'dispatch'
  | 'report'
  | 'answer'
  | 'question'
  | 'idea'
  | 'reload'
  | 'ask'
  | 'kill'
  | 'fire'
  | 'hire'
  | 'stop'
  | 'refresh'
  | 'chart'
  | 'pr'
  | 'file'
  | 'new'
  | 'ok'
  | 'fail'
  | 'warn'
  | 'live'
  | 'wait'
  | 'idle'
  | 'alumni'
  | 'theme'
  | 'place'
  | 'spark'
  | 'scout'
  | 'scholar'
  | 'builder'
  | 'wizard'
  | 'critic'
  | 'captain'
  | 'helper'
  | 'tab-board'
  | 'tab-agents'
  | 'tab-cost'
  | 'tab-session'
  | 'tab-changes'
  | 'tab-timeline'
  | 'tab-workflow'
  | 'tab-recall'
  | 'tab-settings'

export type IconSet = Readonly<Record<IconName, string>>

// Emoji are picked from the astral planes or the default-emoji BMP set, so cells() counts them as two.
const EMOJI: IconSet = {
  advisor: '🦉',
  alumni: '🎓',
  answer: '💬',
  ask: '💬',
  branch: '🌿',
  builder: '🔧',
  captain: '🎯',
  chart: '📊',
  clock: '🕒',
  coordinator: '🧭',
  cost: '💰',
  critic: '🧪',
  dispatch: '📨',
  fail: '❌',
  file: '📄',
  fire: '🔥',
  helper: '🤖',
  hire: '🤝',
  idea: '💡',
  idle: '💤',
  kill: '🛑',
  live: '🟢',
  message: '✉️',
  model: '🧠',
  new: '🆕',
  ok: '✅',
  org: '🏢',
  place: '📐',
  pr: '🔀',
  project: '📦',
  question: '❓',
  refresh: '🔄',
  reload: '🔁',
  report: '📥',
  scholar: '📚',
  scout: '🔍',
  spark: '✨',
  stop: '🛑',
  'tab-agents': '🏢',
  'tab-board': '📋',
  'tab-changes': '📝',
  'tab-cost': '💰',
  'tab-recall': '🔎',
  'tab-session': '🧠',
  'tab-settings': '🎨',
  'tab-timeline': '🕒',
  'tab-workflow': '🌊',
  theme: '🎨',
  tokens: '🪙',
  tool: '🔨',
  user: '👤',
  wait: '⏳',
  warn: '🚧',
  wizard: '🧙',
}

const UNICODE: IconSet = {
  advisor: '◈',
  alumni: '⌂',
  answer: '◂',
  ask: '✎',
  branch: '⎇',
  builder: '⚒',
  captain: '◎',
  chart: '▤',
  clock: '◷',
  coordinator: '◉',
  cost: '¤',
  critic: '⚖',
  dispatch: '▸',
  fail: '✗',
  file: '▫',
  fire: '✕',
  helper: '◇',
  hire: '+',
  idea: '✦',
  idle: '◌',
  kill: '■',
  live: '●',
  message: '✉',
  model: '◆',
  new: '✚',
  ok: '✓',
  org: '▣',
  place: '⊞',
  pr: '⇄',
  project: '▣',
  question: '?',
  refresh: '↻',
  reload: '↺',
  report: '◂',
  scholar: '❡',
  scout: '⌕',
  spark: '✦',
  stop: '■',
  'tab-agents': '▣',
  'tab-board': '▤',
  'tab-changes': '±',
  'tab-cost': '¤',
  'tab-recall': '⌕',
  'tab-session': '◆',
  'tab-settings': '⚙',
  'tab-timeline': '◷',
  'tab-workflow': '≋',
  theme: '◐',
  tokens: '◦',
  tool: '⚒',
  user: '☺',
  wait: '…',
  warn: '!',
  wizard: '✧',
}

const ASCII: IconSet = {
  advisor: '@',
  alumni: '~',
  answer: '<',
  ask: '?',
  branch: 'b',
  builder: '#',
  captain: '*',
  chart: '|',
  clock: 't',
  coordinator: 'C',
  cost: '$',
  critic: '%',
  dispatch: '>',
  fail: 'x',
  file: '-',
  fire: 'x',
  helper: 'o',
  hire: '+',
  idea: '!',
  idle: 'z',
  kill: 'x',
  live: '*',
  message: 'm',
  model: 'm',
  new: '+',
  ok: 'v',
  org: '#',
  place: '+',
  pr: 'p',
  project: '#',
  question: '?',
  refresh: 'r',
  reload: 'r',
  report: '<',
  scholar: '&',
  scout: '?',
  spark: '*',
  stop: 'x',
  'tab-agents': '#',
  'tab-board': '=',
  'tab-changes': '+',
  'tab-cost': '$',
  'tab-recall': '?',
  'tab-session': 'm',
  'tab-settings': '*',
  'tab-timeline': 't',
  'tab-workflow': '~',
  theme: '*',
  tokens: 'o',
  tool: '#',
  user: 'U',
  wait: '.',
  warn: '!',
  wizard: '*',
}

export const ICONS: Readonly<Record<DeckIcons, IconSet>> = { ascii: ASCII, emoji: EMOJI, unicode: UNICODE }

export const iconsOf = (set: DeckIcons): IconSet => ICONS[set]

const SPINNERS: Readonly<Record<DeckIcons, readonly string[]>> = {
  ascii: ['|', '/', '-', '\\'],
  emoji: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  unicode: ['◐', '◓', '◑', '◒'],
}

export const spinner = (set: DeckIcons, frame: number): string => {
  const frames = SPINNERS[set]

  return frames[frame % frames.length] ?? '*'
}

// A connector that seems to flow toward the right while work is live.
export const flow = (width: number, frame: number, isLive: boolean): string => {
  const size = Math.max(1, width)

  if (!isLive) {
    return '─'.repeat(size)
  }

  return Array.from({ length: size }, (_, index) => ((index - frame) % 4 === 0 ? '▸' : '─')).join('')
}

// ─── Cell width ─────────────────────────────────────────────────────────────

const WIDE_BMP: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
]

const isZeroWidth = (code: number): boolean =>
  code === 0x200d ||
  (code >= 0xfe00 && code <= 0xfe0f) ||
  (code >= 0x0300 && code <= 0x036f) ||
  (code >= 0x1f3fb && code <= 0x1f3ff) ||
  (code >= 0xe0020 && code <= 0xe007f)

const isWide = (code: number): boolean =>
  (code >= 0x1f000 && code <= 0x1faff) ||
  (code >= 0x20000 && code <= 0x3fffd) ||
  WIDE_BMP.some(([low, high]) => code >= low && code <= high)

// Terminal cells one code point takes; a text-style symbol followed by U+FE0F turns wide.
const widthAt = (points: readonly number[], index: number): number => {
  const code = points[index] ?? 0

  if (isZeroWidth(code)) {
    return 0
  }
  if (isWide(code)) {
    return 2
  }

  return points[index + 1] === 0xfe0f ? 2 : 1
}

export const cells = (text: string): number => {
  const points = Array.from(text, char => char.codePointAt(0) ?? 0)
  let total = 0

  for (let index = 0; index < points.length; index += 1) {
    // A ZWJ sequence draws as one glyph: only its first member counts.
    if (points[index - 1] === 0x200d) {
      continue
    }
    total += widthAt(points, index)
  }

  return total
}

// The longest prefix of `text` that fits in `width` cells, never splitting a code point.
export const clip = (text: string, width: number): string => {
  let used = 0
  let out = ''
  const chars = Array.from(text)

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? ''
    const next = chars[index + 1] ?? ''
    const size = cells(char + (next === '️' ? next : ''))

    if (used + size > width) {
      break
    }
    used += size
    out += char
    if (next === '️') {
      out += next
      index += 1
    }
  }

  return out
}

export const padEnd = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - cells(text)))

export const padStart = (text: string, width: number): string => ' '.repeat(Math.max(0, width - cells(text))) + text
