import { isOpen } from './monitors'

import type { DeckMonitor, MonitorRelaunch } from '../../types'

export type RelaunchCall =
  | Extract<MonitorRelaunch, { via: 'tool' }>
  | { via: 'command'; command: 'loop'; args: string }
  | Extract<MonitorRelaunch, { via: 'rehire' }>

export type RelaunchPlan = { isAllowed: true; call: RelaunchCall } | { isAllowed: false; reason: string }

export type LoopInterval = { label: string; value: string }

export type LoopArgs = { args: string } | { reason: string }

export const LOOP_INTERVALS: readonly LoopInterval[] = [
  { label: 'self-paced', value: '' },
  { label: '5m', value: '5m' },
  { label: '10m', value: '10m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
]

const AUTONOMOUS_LOOP = '<<autonomous-loop>>'

const NO_RECIPE: Readonly<Partial<Record<DeckMonitor['kind'], string>>> = {
  agent: 'a remote agent cannot be relaunched from the deck',
  'run-monitor': 'a run monitor is a claim from a state file',
  wakeup: 'a /loop wakeup whose prompt was not recorded',
  workflow: 'workflows cannot be relaunched from the deck',
}

const isAutonomous = (recipe: MonitorRelaunch): boolean =>
  recipe.via === 'tool' && recipe.tool === 'CronCreate' && recipe.input.prompt === AUTONOMOUS_LOOP

// How to start an ended row again, or why the deck cannot.
export const relaunchPlan = (monitor: DeckMonitor): RelaunchPlan => {
  if (isOpen(monitor)) {
    return { isAllowed: false, reason: monitor.status === 'active' ? 'still waiting' : 'still running' }
  }

  const recipe = monitor.relaunch

  if (recipe === undefined) {
    return { isAllowed: false, reason: NO_RECIPE[monitor.kind] ?? 'how it started was not recorded' }
  }
  if (isAutonomous(recipe)) {
    return { isAllowed: false, reason: 'an autonomous loop belongs to the session that started it' }
  }
  if (recipe.via === 'loop') {
    return { call: { args: recipe.args, command: 'loop', via: 'command' }, isAllowed: true }
  }

  return { call: recipe, isAllowed: true }
}

// The `/loop` arguments for a deck-made loop: "<interval> <prompt>", the interval left out for self-paced.
export const loopArgs = (interval: string, prompt: string): LoopArgs => {
  const text = prompt.trim()

  return text === '' ? { reason: 'empty prompt' } : { args: `${interval} ${text}`.trim() }
}

// Ties a loop the deck started to the row the engine made for it: the newest open wakeup or cron
// with no recipe that began at or after `at`.
export const withLoopArgs = (list: readonly DeckMonitor[], args: string, at: number): DeckMonitor[] => {
  const target = list
    .filter(monitor => isOpen(monitor) && (monitor.kind === 'wakeup' || monitor.kind === 'cron') && monitor.relaunch === undefined && monitor.startedAt >= at)
    .reduce<DeckMonitor | undefined>((newest, monitor) => (newest === undefined || monitor.startedAt > newest.startedAt ? monitor : newest), undefined)

  return list.map(monitor => (monitor === target ? { ...monitor, relaunch: { args, via: 'loop' } } : monitor))
}
