import { AWAKE_LIMITS, KEEP_AWAKE_LABEL, KEEP_AWAKE_MODES, awakeText, readKeepAwake } from '../lib/awake'
import { ago, duration, fit } from '../lib/format'
import { NO_END_REPORT, isLongRunning, isOpen, sortMonitors, stopAllCalls, stopCall } from '../lib/monitors'
import { LOOP_INTERVALS, loopArgs, relaunchPlan } from '../lib/relaunch'
import { cells } from '../lib/theme'
import { Chip, Empty, Section, pulse } from './parts'

import type { RenderElement } from 'claude-code'
import type { Kit } from './parts'
import type { DeckAwake, DeckIcons, DeckMonitor, DeckMonitorKind, KeepAwake } from '../../types'

export type LoopDraft = { interval: string; prompt: string }

export type MonitorsSectionData = {
  monitors: DeckMonitor[]
  // Both are needed for the keep-awake chip and its selector.
  awake?: DeckAwake
  keepAwake?: KeepAwake
  // The New loop form's fields, kept by the caller.
  loop?: LoopDraft
  // The shared `selected` and `confirm` atoms: a row is `monitor:<id>`, a press waiting for its
  // second is `stop:<id>`, `cancel:<id>`, `relaunch:<id>` or `stop-all:monitors`.
  selected: string
  confirm: string
  now: number
}

export type MonitorAction = 'stop' | 'cancel' | 'relaunch' | 'stop-all'

export type MonitorsSectionActions = {
  select: (key: string) => void
  act: (action: Exclude<MonitorAction, 'relaunch'>, id: string) => void
  refresh: () => void
  setKeepAwake?: (mode: KeepAwake) => void
  createLoop?: (args: string) => void
  setLoop?: (draft: LoopDraft) => void
  relaunch?: (id: string) => void
}

export const STOP_ALL_ID = 'monitors'

const FINISHED_SHOWN = 10

type Glyph = DeckMonitorKind | 'long' | 'awake' | 'asleep' | 'cancel'

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
    wakeup: '◷',
    workflow: '≋',
  },
}

const HOTKEY: Readonly<Record<MonitorAction, string>> = { cancel: 'c', relaunch: 'l', stop: 's', 'stop-all': 'x' }

const mark = (kit: Kit, name: Glyph): string => GLYPHS[kit.iconSet][name]

export const selectKey = (id: string): string => `monitor:${id}`

const awakeChip = (kit: Kit, awake: DeckAwake, keepAwake: KeepAwake): RenderElement => {
  const { theme } = kit
  const text = awakeText(awake, keepAwake)

  if (awake.isHeld) {
    return Chip(kit, `${mark(kit, 'awake')} ${text}`, theme.good)
  }

  return awake.reason !== undefined && keepAwake !== 'off'
    ? Chip(kit, `${kit.icon.warn} ${text}`, theme.warn)
    : Chip(kit, `${mark(kit, 'asleep')} ${text}`, theme.muted)
}

const confirmHint = (kit: Kit, data: MonitorsSectionData, action: MonitorAction, id: string, what: string): RenderElement | null => {
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

const keepAwakeControls = (kit: Kit, data: MonitorsSectionData, actions: MonitorsSectionActions, columns: number): RenderElement[] => {
  const { Box, Select, Text } = kit
  const { awake, keepAwake } = data
  const { setKeepAwake } = actions

  if (awake === undefined || keepAwake === undefined) {
    return []
  }
  if (setKeepAwake === undefined || Select === undefined) {
    return [
      <Box key="mon-awake" flexDirection="row" columnGap={1} width={columns}>
        {awakeChip(kit, awake, keepAwake)}
      </Box>,
    ]
  }

  return [
    <Box key="mon-awake" flexDirection="row" columnGap={1} width={columns}>
      {awakeChip(kit, awake, keepAwake)}
    </Box>,
    <Select
      key="mon-keep-awake"
      label={`${mark(kit, 'awake')} Keep awake `}
      value={keepAwake}
      options={KEEP_AWAKE_MODES.map(mode => ({ label: KEEP_AWAKE_LABEL[mode], value: mode }))}
      onSelect={value => setKeepAwake(readKeepAwake(value))}
    />,
    <Text key="mon-awake-limits" dimColor>
      {fit(AWAKE_LIMITS, columns * 2)}
    </Text>,
  ]
}

const newLoopForm = (kit: Kit, data: MonitorsSectionData, actions: MonitorsSectionActions, columns: number): RenderElement[] => {
  const { Box, Button, Input, Select, Text } = kit
  const { createLoop, setLoop } = actions

  if (createLoop === undefined || Input === undefined || Select === undefined) {
    return []
  }

  const draft = data.loop ?? { interval: '', prompt: '' }
  const run = (prompt: string): void => {
    const plan = loopArgs(draft.interval, prompt)

    if ('args' in plan) {
      createLoop(plan.args)
    }
  }

  return [
    <Text key="mon-loop-title" bold>
      {fit(`${kit.icon.new} New loop`, columns)}
    </Text>,
    <Select
      key="mon-loop-interval"
      label="Every "
      value={draft.interval}
      options={LOOP_INTERVALS.map(({ label, value }) => ({ label, value }))}
      onSelect={value => setLoop?.({ interval: value, prompt: draft.prompt })}
    />,
    <Input
      key="mon-loop-prompt"
      label="Prompt "
      placeholder="what to run each time"
      value={draft.prompt}
      submitLabel="run"
      onInput={value => setLoop?.({ interval: draft.interval, prompt: value })}
      onSubmit={value => run(value)}
    />,
    <Box key="mon-loop-bar" flexDirection="row" columnGap={2}>
      <Button key="mon-loop-run" plain label={`${kit.icon.live} Run`} onPress={() => run(draft.prompt)} />
    </Box>,
  ]
}

// The one action a row offers: Stop for running work, Cancel for active work, Relaunch for ended work.
const stopAction = (kit: Kit, data: MonitorsSectionData, actions: MonitorsSectionActions, monitor: DeckMonitor, width: number): RenderElement[] => {
  const { Box, Button, Text } = kit
  const plan = stopCall(monitor)
  const verb = plan.isAllowed ? plan.verb : monitor.status === 'active' ? 'cancel' : 'stop'
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

const relaunchAction = (kit: Kit, data: MonitorsSectionData, actions: MonitorsSectionActions, monitor: DeckMonitor, width: number): RenderElement[] => {
  const { Box, Button, Text } = kit
  const plan = relaunchPlan(monitor)
  const { relaunch } = actions

  if (!plan.isAllowed) {
    return [
      <Text key={`mon-relaunch-${monitor.id}-off`} dimColor>
        {fit(`${kit.icon.reload} Relaunch: ${plan.reason}`, width)}
      </Text>,
    ]
  }
  if (relaunch === undefined) {
    return []
  }

  const hint = confirmHint(kit, data, 'relaunch', monitor.id, `relaunch ${monitor.label}`)

  return [
    <Box key={`mon-bar-${monitor.id}`} flexDirection="row" columnGap={2}>
      <Button
        key={`mon-relaunch-${monitor.id}`}
        plain
        hotkey={HOTKEY.relaunch}
        label={`${kit.icon.reload} Relaunch`}
        onPress={() => relaunch(monitor.id)}
      />
    </Box>,
    ...(hint === null ? [] : [hint]),
  ]
}

const timing = (monitor: DeckMonitor, now: number): string => {
  if (monitor.status === 'active') {
    return monitor.nextAt === undefined ? 'active' : now >= monitor.nextAt ? 'due' : `in ${duration(monitor.nextAt - now)}`
  }
  if (isOpen(monitor)) {
    return duration(now - monitor.startedAt)
  }

  return monitor.endedAt === undefined ? monitor.status : ago(monitor.endedAt, now)
}

const endedColor = (kit: Kit, monitor: DeckMonitor): string => {
  const { theme } = kit

  switch (monitor.status) {
    case 'dead':
    case 'killed':
      return theme.bad
    case 'canceled':
    case 'stopped':
      return theme.warn
    default:
      return theme.good
  }
}

const detailLine = (kit: Kit, monitor: DeckMonitor, now: number, columns: number): RenderElement => {
  const { Text } = kit
  const key = `mon-detail-${monitor.id}`

  if (isOpen(monitor)) {
    const deadline = monitor.deadlineAt === undefined || monitor.status !== 'running' ? '' : `ends in ${duration(Math.max(0, monitor.deadlineAt - now))}`
    const text = [monitor.detail, monitor.schedule === monitor.detail ? '' : (monitor.schedule ?? ''), deadline, monitor.kind]
      .filter(part => part !== '')
      .join(' · ')

    return (
      <Text key={key} dimColor>
        {fit(`   ${text}`, columns)}
      </Text>
    )
  }

  const unreported = monitor.detail.endsWith(NO_END_REPORT)
  const shown = unreported ? monitor.detail.slice(0, monitor.detail.length - NO_END_REPORT.length) : monitor.detail
  const lead = fit(`   ${[shown, monitor.kind].filter(part => part !== '').join(' · ')}`, Math.max(4, columns - (unreported ? NO_END_REPORT.length : 0)))

  return (
    <Text key={key}>
      <Text color={kit.theme.muted}>{lead}</Text>
      {unreported && <Text dimColor>{NO_END_REPORT}</Text>}
    </Text>
  )
}

const monitorRow = (kit: Kit, data: MonitorsSectionData, actions: MonitorsSectionActions, monitor: DeckMonitor, columns: number): RenderElement[] => {
  const { Box, Button, Text, theme } = kit
  const isRunning = monitor.status === 'running'
  const isOpenRow = isOpen(monitor)
  const isLong = isOpenRow && isLongRunning(monitor, data.now)
  const isSelected = data.selected === selectKey(monitor.id)
  const color = isOpenRow ? (isRunning ? theme.agent : theme.accent) : endedColor(kit, monitor)
  const lead = `${pulse(kit, isRunning, mark(kit, monitor.kind))} `
  const word = monitor.status === 'killed' ? (monitor.rawStatus ?? monitor.status) : monitor.status
  const chip = isLong ? `${mark(kit, 'long')} long` : word
  const time = timing(monitor, data.now)
  const nameRoom = Math.max(4, columns - cells(lead) - cells(chip) - cells(time) - 4)

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
    detailLine(kit, monitor, data.now, columns),
    ...(isSelected ? (isOpenRow ? stopAction(kit, data, actions, monitor, columns - 3) : relaunchAction(kit, data, actions, monitor, columns - 3)) : []),
  ]
}

// The Board's Monitors section: keep-awake, a New loop form, then the rows by state.
export const monitorsSection = (kit: Kit, data: MonitorsSectionData, actions: MonitorsSectionActions, columns: number): RenderElement => {
  const { Box, Button, Text } = kit
  const sorted = sortMonitors(data.monitors)
  const running = sorted.filter(monitor => monitor.status === 'running')
  const active = sorted.filter(monitor => monitor.status === 'active')
  const ended = sorted.filter(monitor => !isOpen(monitor))
  const shownEnded = ended.slice(0, FINISHED_SHOWN)
  const stoppable = stopAllCalls(data.monitors).length

  return (
    <Box key="board-monitors" flexDirection="column" width={columns}>
      {Section(kit, `${mark(kit, 'monitor')} Monitors`, columns, `${running.length} running · ${active.length} active`)}
      {keepAwakeControls(kit, data, actions, columns)}
      {newLoopForm(kit, data, actions, columns)}
      {Section(kit, `${mark(kit, 'monitor')} Running`, columns, String(running.length))}
      {running.length === 0 && Empty(kit, 'Nothing running in the background.')}
      {running.flatMap(monitor => monitorRow(kit, data, actions, monitor, columns))}
      {Section(kit, `${mark(kit, 'wakeup')} Active`, columns, String(active.length))}
      {active.length === 0 && Empty(kit, 'No wakeup or cron is waiting.')}
      {active.flatMap(monitor => monitorRow(kit, data, actions, monitor, columns))}
      {Section(kit, `${kit.icon.ok} ${ended.length > FINISHED_SHOWN ? `Ended (last ${FINISHED_SHOWN})` : 'Ended'}`, columns, String(ended.length))}
      {ended.length === 0 && Empty(kit, 'Nothing has ended yet.')}
      {shownEnded.flatMap(monitor => monitorRow(kit, data, actions, monitor, columns))}
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
