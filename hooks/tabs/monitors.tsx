import { AWAKE_LIMITS, KEEP_AWAKE_LABEL, KEEP_AWAKE_MODES, awakeText, readKeepAwake } from '../lib/awake'
import { ago, duration, fit } from '../lib/format'
import { isLongRunning, isOpen, sortMonitors, stopAllCalls, stopCall, summary } from '../lib/monitors'
import { cells } from '../lib/theme'
import { Chip, Empty, Section, Tile, pulse } from './parts'

import type { RenderElement } from 'claude-code'
import type { DeckAwake, KeepAwake } from '../lib/awake'
import type { DeckMonitor, DeckMonitorKind, MonitorSummary } from '../lib/monitors'
import type { Kit } from './parts'
import type { DeckIcons } from '../../types'

export type MonitorsData = {
  monitors: DeckMonitor[]
  awake: DeckAwake
  keepAwake: KeepAwake
  // The shared `selected` and `confirm` atoms: a row is `monitor:<id>`, a press waiting for its
  // second is `stop:<id>`, `cancel:<id>` or `stop-all:monitors`.
  selected: string
  confirm: string
  now: number
}

export type MonitorAction = 'stop' | 'cancel' | 'stop-all'

export type MonitorsActions = {
  select: (key: string) => void
  act: (action: MonitorAction, id: string) => void
  refresh: () => void
  setKeepAwake: (mode: KeepAwake) => void
}

export const STOP_ALL_ID = 'monitors'

const FINISHED_SHOWN = 10

type Glyph = DeckMonitorKind | 'long' | 'awake' | 'asleep' | 'cancel' | 'tab'

// The tab's own glyphs; theme.ts's IconName carries only the tab icon ('tab-monitors').
const GLYPHS: Readonly<Record<DeckIcons, Readonly<Record<Glyph, string>>>> = {
  ascii: {
    agent: 'A',
    asleep: 'z',
    awake: '*',
    cancel: 'x',
    cron: 'C',
    long: '~',
    monitor: 'M',
    other: '?',
    'run-monitor': 'R',
    shell: '$',
    tab: 'M',
    wakeup: '@',
    workflow: 'W',
  },
  emoji: {
    agent: '🤖',
    asleep: '💤',
    awake: '☕',
    cancel: '⏹️',
    cron: '📅',
    long: '🐢',
    monitor: '👁️',
    other: '⚙️',
    'run-monitor': '🛰️',
    shell: '🐚',
    tab: '👁️',
    wakeup: '⏰',
    workflow: '🌊',
  },
  unicode: {
    agent: '◇',
    asleep: '◌',
    awake: '☼',
    cancel: '■',
    cron: '↻',
    long: '⧗',
    monitor: '◉',
    other: '·',
    'run-monitor': '⌖',
    shell: '$',
    tab: '◉',
    wakeup: '◷',
    workflow: '≋',
  },
}

const HOTKEY: Readonly<Record<MonitorAction, string>> = { cancel: 'c', stop: 's', 'stop-all': 'x' }

const mark = (kit: Kit, name: Glyph): string => GLYPHS[kit.iconSet][name]

export const selectKey = (id: string): string => `monitor:${id}`

const awakeChip = (kit: Kit, data: Pick<MonitorsData, 'awake' | 'keepAwake'>): RenderElement => {
  const { theme } = kit
  const text = awakeText(data.awake, data.keepAwake)

  if (data.awake.isHeld) {
    return Chip(kit, `${mark(kit, 'awake')} ${text}`, theme.good)
  }

  return data.awake.reason !== undefined && data.keepAwake !== 'off'
    ? Chip(kit, `${kit.icon.warn} ${text}`, theme.warn)
    : Chip(kit, `${mark(kit, 'asleep')} ${text}`, theme.muted)
}

const confirmHint = (kit: Kit, data: MonitorsData, action: MonitorAction, id: string, what: string): RenderElement | null => {
  const { Text, theme } = kit

  if (data.confirm !== `${action}:${id}`) {
    return null
  }

  return (
    <Text key={`mon-confirm-${id}`} color={theme.warn}>
      {`press ${HOTKEY[action]} again to ${what}; any other key cancels`}
    </Text>
  )
}

// The one action a row offers: Stop for running work, Cancel for scheduled work.
const rowAction = (kit: Kit, data: MonitorsData, actions: MonitorsActions, monitor: DeckMonitor, width: number): RenderElement[] => {
  const { Box, Button, Text } = kit
  const plan = stopCall(monitor)
  const verb = plan.isAllowed ? plan.verb : monitor.status === 'scheduled' ? 'cancel' : 'stop'
  const icon = verb === 'stop' ? kit.icon.stop : mark(kit, 'cancel')
  const label = verb === 'stop' ? 'Stop' : 'Cancel'
  const button = plan.isAllowed ? (
    <Button
      key={`mon-${verb}-${monitor.id}`}
      plain
      hotkey={HOTKEY[verb]}
      label={`${icon} ${label}`}
      onPress={() => actions.act(verb, monitor.id)}
    />
  ) : (
    <Text key={`mon-${verb}-${monitor.id}-off`} dimColor>
      {fit(`${icon} ${label}: ${plan.reason}`, width)}
    </Text>
  )
  const hint = confirmHint(kit, data, verb, monitor.id, `${verb} ${monitor.label}`)

  return [
    <Box key={`mon-bar-${monitor.id}`} flexDirection="row" columnGap={2}>
      {button}
    </Box>,
    ...(hint === null ? [] : [hint]),
  ]
}

const timing = (monitor: DeckMonitor, now: number): string => {
  if (monitor.status === 'scheduled') {
    return monitor.nextAt === undefined ? 'scheduled' : now >= monitor.nextAt ? 'due' : `in ${duration(monitor.nextAt - now)}`
  }
  if (isOpen(monitor) || monitor.status === 'unknown') {
    return duration(now - monitor.startedAt)
  }

  return monitor.endedAt === undefined ? monitor.status : ago(monitor.endedAt, now)
}

const openRow = (kit: Kit, data: MonitorsData, actions: MonitorsActions, monitor: DeckMonitor, columns: number): RenderElement[] => {
  const { Box, Button, Text, theme } = kit
  const isRunning = monitor.status === 'running'
  const isLong = isLongRunning(monitor, data.now)
  const isSelected = data.selected === selectKey(monitor.id)
  const color = isRunning ? theme.agent : monitor.status === 'scheduled' ? theme.accent : theme.muted
  const lead = `${pulse(kit, isRunning, mark(kit, monitor.kind))} `
  const chip = isLong ? `${mark(kit, 'long')} long` : monitor.status
  const time = timing(monitor, data.now)
  const nameRoom = Math.max(4, columns - cells(lead) - cells(chip) - cells(time) - 4)
  const deadline = monitor.deadlineAt === undefined || !isRunning ? '' : `ends in ${duration(Math.max(0, monitor.deadlineAt - data.now))}`
  const detail = [monitor.detail, monitor.schedule === monitor.detail ? '' : (monitor.schedule ?? ''), deadline, monitor.kind]
    .filter(part => part !== '')
    .join(' · ')

  return [
    <Box key={`mon-row-${monitor.id}`} justifyContent="space-between" width={columns}>
      <Box>
        <Text color={color}>{lead}</Text>
        <Button key={`sel-mon-${monitor.id}`} plain label={fit(monitor.label, nameRoom)} onPress={() => actions.select(selectKey(monitor.id))} />
      </Box>
      <Box>
        {Chip(kit, chip, isLong ? theme.warn : color)}
        <Text dimColor> {time}</Text>
      </Box>
    </Box>,
    <Text key={`mon-detail-${monitor.id}`} dimColor>
      {fit(`   ${detail}`, columns)}
    </Text>,
    ...(isSelected ? rowAction(kit, data, actions, monitor, columns - 3) : []),
  ]
}

const finishedRow = (kit: Kit, monitor: DeckMonitor, now: number, columns: number): RenderElement => {
  const { Box, Text, theme } = kit
  const color = monitor.status === 'failed' ? theme.bad : monitor.status === 'stopped' ? theme.warn : theme.good
  const time = timing(monitor, now)
  const room = Math.max(4, columns - cells(monitor.status) - cells(time) - 6)

  return (
    <Box key={`mon-done-${monitor.id}`} justifyContent="space-between" width={columns}>
      <Text dimColor>{fit(`${mark(kit, monitor.kind)} ${monitor.label}`, room)}</Text>
      <Text>
        <Text color={color}>{monitor.status}</Text>
        <Text dimColor> {time}</Text>
      </Text>
    </Box>
  )
}

const tiles = (kit: Kit, counts: MonitorSummary, columns: number): RenderElement => {
  const { Box, theme } = kit
  const width = Math.max(12, Math.floor((columns - 3) / 4))

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {Tile(kit, { color: theme.agent, icon: 'live', key: 'mon-tile-running', label: 'running', value: String(counts.running) }, width)}
      {Tile(kit, { color: theme.accent, icon: 'clock', key: 'mon-tile-scheduled', label: 'scheduled', value: String(counts.scheduled) }, width)}
      {Tile(
        kit,
        {
          color: counts.longRunning > 0 ? theme.warn : theme.muted,
          icon: 'warn',
          key: 'mon-tile-long',
          label: 'long-running',
          value: String(counts.longRunning),
        },
        width,
      )}
      {Tile(kit, { color: theme.good, icon: 'ok', key: 'mon-tile-done', label: 'done', value: String(counts.done + counts.stopped + counts.failed) }, width)}
    </Box>
  )
}

export const monitorsTab = (kit: Kit, data: MonitorsData, actions: MonitorsActions, columns: number): RenderElement => {
  const { Box, Button, Select, Text } = kit
  const sorted = sortMonitors(data.monitors)
  const counts = summary(data.monitors, data.now)
  const running = sorted.filter(monitor => monitor.status === 'running' || monitor.status === 'unknown')
  const scheduled = sorted.filter(monitor => monitor.status === 'scheduled')
  const finished = sorted.filter(monitor => !isOpen(monitor) && monitor.status !== 'unknown').slice(0, FINISHED_SHOWN)
  const stoppable = stopAllCalls(data.monitors).length

  return (
    <Box flexDirection="column">
      {tiles(kit, counts, columns)}
      <Box key="mon-awake" flexDirection="row" columnGap={1} width={columns}>
        {awakeChip(kit, data)}
      </Box>
      <Select
        key="mon-keep-awake"
        label={`${mark(kit, 'awake')} Keep awake `}
        value={data.keepAwake}
        options={KEEP_AWAKE_MODES.map(mode => ({ label: KEEP_AWAKE_LABEL[mode], value: mode }))}
        onSelect={value => actions.setKeepAwake(readKeepAwake(value))}
      />
      <Text dimColor>{fit(AWAKE_LIMITS, columns * 2)}</Text>
      {Section(kit, `${mark(kit, 'monitor')} Running`, columns, String(running.length))}
      {running.length === 0 && Empty(kit, 'Nothing running in the background.')}
      {running.flatMap(monitor => openRow(kit, data, actions, monitor, columns))}
      {Section(kit, `${mark(kit, 'wakeup')} Scheduled`, columns, String(scheduled.length))}
      {scheduled.length === 0 && Empty(kit, 'No wakeup or cron is waiting.')}
      {scheduled.flatMap(monitor => openRow(kit, data, actions, monitor, columns))}
      {Section(kit, `${kit.icon.ok} Finished`, columns, counts.done + counts.stopped + counts.failed > FINISHED_SHOWN ? `last ${FINISHED_SHOWN}` : '')}
      {finished.length === 0 && Empty(kit, 'Nothing has finished yet.')}
      {finished.map(monitor => finishedRow(kit, monitor, data.now, columns))}
      <Box key="mon-footer" flexDirection="row" columnGap={2} marginTop={1}>
        <Button key="mon-refresh" plain hotkey="r" label={`${kit.icon.refresh} Refresh`} onPress={() => actions.refresh()} />
        {stoppable === 0 ? (
          <Text key="mon-stop-all-off" dimColor>{`${kit.icon.stop} Stop all: nothing to stop`}</Text>
        ) : (
          <Button
            key="mon-stop-all"
            plain
            hotkey={HOTKEY['stop-all']}
            label={`${kit.icon.stop} Stop all (${stoppable})`}
            onPress={() => actions.act('stop-all', STOP_ALL_ID)}
          />
        )}
      </Box>
      {confirmHint(kit, data, 'stop-all', STOP_ALL_ID, `stop and cancel ${stoppable} item${stoppable === 1 ? '' : 's'}`)}
    </Box>
  )
}

export type MonitorsBriefData = Pick<MonitorsData, 'monitors' | 'awake' | 'keepAwake' | 'now'>

// The Board's compact Monitors section: counts, the longest-running item, the keep-awake chip.
export const monitorsBrief = (kit: Kit, data: MonitorsBriefData, actions: { open: () => void }, columns: number): RenderElement => {
  const { Box, Button, Text, theme } = kit
  const counts = summary(data.monitors, data.now)
  const { longest } = counts

  return (
    <Box key="board-monitors" flexDirection="column" width={columns}>
      {Section(kit, `${mark(kit, 'monitor')} Monitors`, columns, `${counts.running} running · ${counts.scheduled} scheduled`)}
      {longest === undefined ? (
        Empty(kit, 'Nothing running in the background.')
      ) : (
        <Text color={isLongRunning(longest, data.now) ? theme.warn : theme.agent}>
          {fit(
            `${isLongRunning(longest, data.now) ? `${mark(kit, 'long')} ` : ''}longest: ${longest.label} · ${duration(data.now - longest.startedAt)}`,
            columns,
          )}
        </Text>
      )}
      <Box flexDirection="row" columnGap={2}>
        {awakeChip(kit, data)}
        <Button key="board-monitors-open" plain label={`${mark(kit, 'tab')} open`} onPress={() => actions.open()} />
      </Box>
    </Box>
  )
}

// The header's monitors segment, without its icon: "3 running · ☕", or null when there is nothing to say.
export const monitorsHeadline = (kit: Kit, data: Pick<MonitorsData, 'monitors' | 'awake' | 'now'>): string | null => {
  const counts = summary(data.monitors, data.now)
  const parts = [
    counts.running > 0 ? `${counts.running} running` : '',
    counts.running === 0 && counts.scheduled > 0 ? `${counts.scheduled} scheduled` : '',
    data.awake.isHeld ? mark(kit, 'awake') : '',
  ].filter(part => part !== '')

  return parts.length === 0 ? null : parts.join(' · ')
}
