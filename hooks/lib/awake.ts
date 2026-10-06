// Keeping the machine awake while the session works: a child process holds the operating system's
// sleep lock for as long as it lives. register.tsx starts and ends the child; this file decides.
import type { DeckAwake, KeepAwake } from '../../types'

export type AwakePlan = { argv: readonly string[]; how: string } | { argv: null; reason: string }

export const KEEP_AWAKE_MODES: readonly KeepAwake[] = ['off', 'while-working', 'always']

export const DEFAULT_KEEP_AWAKE: KeepAwake = 'while-working'

// After the last work ends the lock stays this long, so it does not drop between one turn and the next.
export const AWAKE_LINGER_MS = 2 * 60_000

export const AWAKE_LIMITS =
  'A lock prevents idle sleep and display sleep. It cannot stop a shutdown or a restart, and on macOS closing the lid on battery still sleeps.'

export const KEEP_AWAKE_LABEL: Readonly<Record<KeepAwake, string>> = {
  always: 'Always: hold the lock all session',
  off: 'Off: the machine sleeps as usual',
  'while-working': 'While working: agents, turns or monitors in flight',
}

export const readKeepAwake = (raw: unknown): KeepAwake => KEEP_AWAKE_MODES.find(mode => mode === raw) ?? DEFAULT_KEEP_AWAKE

// `platform` is `uname -s` (Darwin, Linux) or a Node platform name (darwin, linux).
export const awakePlan = (platform: string): AwakePlan => {
  const name = platform.trim().toLowerCase()

  if (name === 'darwin') {
    // -d display, -i idle, -m disk, -s system sleep (the last on AC power only).
    return { argv: ['caffeinate', '-dims'], how: 'caffeinate' }
  }
  if (name === 'linux') {
    return {
      argv: [
        'systemd-inhibit',
        '--what=idle:sleep:handle-lid-switch',
        '--who=viStack deck',
        '--why=agents or monitors running',
        '--mode=block',
        'sleep',
        'infinity',
      ],
      how: 'systemd-inhibit',
    }
  }

  return { argv: null, reason: `keep-awake is not supported on ${platform.trim() === '' ? 'this system' : platform.trim()}` }
}

export const shouldHoldAwake = (setting: KeepAwake, isWorking: boolean): boolean =>
  setting === 'always' || (setting === 'while-working' && isWorking)

// The status line beside the keep-awake chip, without its icon.
export const awakeText = (awake: DeckAwake, setting: KeepAwake): string => {
  if (awake.isHeld) {
    return `awake (${awake.how ?? 'lock held'})`
  }
  if (awake.reason !== undefined && setting !== 'off') {
    return awake.reason
  }

  return setting === 'off' ? 'normal sleep (keep-awake off)' : 'normal sleep'
}
