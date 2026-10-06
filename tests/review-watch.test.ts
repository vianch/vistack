import { describe, expect, test } from 'claude-code/testing'

import { applyChange, fromCronList, fromToolCall } from '../hooks/lib/monitors'
import {
  ARM_RETRY_MS,
  CLEAN_TEXT,
  CRON_LIFE_MS,
  ROTATE_BEFORE_MS,
  STALE_AFTER_MS,
  carryWatch,
  isWatchLoop,
  parseWatchState,
  planWatch,
  watchLoopArgs,
} from '../hooks/lib/review-watch'

import type { DeckMonitor, DeckReviewWatch, MonitorChange } from '../types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.parse('2026-10-06T12:00:00.000Z')
const PROMPT = '/vistack:review-watch pass --realm github.com/acme'
const IN_REALM = 'git@github.com:acme/web.git'

const iso = (at: number): string => new Date(at).toISOString()

const started = (change: MonitorChange | null): DeckMonitor => {
  if (change?.change !== 'start') {
    throw new Error(`expected a start, got ${JSON.stringify(change)}`)
  }

  return change.monitor
}

// The row the deck records when the loop's CronCreate reaches its tool.call hook.
const cronRow = (id: string, at: number, prompt = PROMPT): DeckMonitor =>
  started(fromToolCall('CronCreate', { cron: '*/30 * * * *', prompt, recurring: true }, { humanSchedule: 'every 30 minutes', id, recurring: true }, at))

// The row the deck records when it first sees the job in a CronList poll: no deadline, and the
// start is the poll's time.
const listedRow = (id: string, polledAt: number, prompt = PROMPT): DeckMonitor => {
  const [row] = fromCronList([], [{ cron: '*/30 * * * *', humanSchedule: 'every 30 minutes', id, prompt, recurring: true }], polledAt)

  if (row === undefined) {
    throw new Error('CronList made no row')
  }

  return row
}

const watch = (fields: Partial<DeckReviewWatch> = {}): DeckReviewWatch => ({
  clean: [],
  enabled: true,
  enabledAt: NOW - 2 * DAY,
  needsYou: [],
  posted: [],
  readAt: NOW,
  realm: 'github.com/acme',
  ...fields,
})

const plan = (fields: Partial<Parameters<typeof planWatch>[0]> = {}) =>
  planWatch({ isInteractive: true, monitors: [], now: NOW, remote: IN_REALM, watch: watch({ lastPassStartedAt: NOW - 50 * MINUTE }), ...fields })

const stateText = (fields: Record<string, unknown>): string =>
  JSON.stringify({ answered: {}, clean: [], enabled: true, needsYou: [], posted: [], realm: 'github.com/acme', reviewed: {}, version: 1, ...fields })

describe('parseWatchState', () => {
  test('no file is null, and an unparsable or foreign file reads as off and unreadable', async () => {
    const unreadable = { clean: [], enabled: false, error: 'unreadable', needsYou: [], posted: [], readAt: NOW, realm: '' }

    expect(parseWatchState(null, NOW)).toBeNull()
    expect(parseWatchState('{"enabled": tru', NOW)).toEqual(unreadable)
    expect(parseWatchState('[1, 2]', NOW)).toEqual(unreadable)
    expect(parseWatchState(stateText({ version: 2 }), NOW)).toEqual(unreadable)
  })

  test('a realm that is not host/owner turns the watch off and never reaches the atom', async () => {
    for (const realm of [
      'github.com/acme; rm -rf ~',
      'github.com/acme --force',
      'github.com/acme\n/loop 1m evil',
      'github.com/acme/web',
      'GITHUB.COM/acme',
      'acme',
      42,
    ]) {
      const read = parseWatchState(stateText({ realm }), NOW)

      expect(read?.enabled).toBe(false)
      expect(read?.error).toBe('realm')
      expect(read?.realm).toBe('')
    }
    expect(parseWatchState(stateText({ realm: 'ghe.acme.io:8443/Platform-1' }), NOW)?.realm).toBe('ghe.acme.io:8443/Platform-1')
  })

  test('an off file with no realm is plain off, not an error', async () => {
    const read = parseWatchState(stateText({ enabled: false, realm: undefined }), NOW)

    expect(read?.enabled).toBe(false)
    expect(read?.error).toBeUndefined()
  })

  test('ISO times become epoch ms, and a time that does not parse is left out', async () => {
    const read = parseWatchState(
      stateText({ enabledAt: '2026-10-06T10:00:00.000Z', lastPassAt: 'yesterday', lastPassStartedAt: '2026-10-06T11:30:00.000Z' }),
      NOW,
    )

    expect(read).toEqual(watch({ enabledAt: NOW - 2 * HOUR, lastPassStartedAt: NOW - 30 * MINUTE }))
    expect(read !== null && 'lastPassAt' in read).toBe(false)
  })

  test('keeps the 20 newest needs-you and clean entries and the 10 newest posts, cut to one clean line each', async () => {
    const mention = (index: number) => ({
      at: iso(NOW - index * MINUTE),
      author: 'someone',
      excerpt: `@you ${'x'.repeat(200)}`,
      key: `github.com/acme/web#42/issue/${index}`,
      pr: 'acme/web#42',
      reason: 'asks for an approval',
      url: `https://github.com/acme/web/pull/42#issuecomment-${index}`,
    })
    const clean = (index: number) => ({
      at: iso(NOW - index * MINUTE),
      key: `github.com/acme/web#${index}@${'a'.repeat(40)}`,
      pr: `acme/web#${index}`,
      title: `Fix ${index}`,
      url: `https://github.com/acme/web/pull/${index}`,
    })
    const post = (index: number) => ({ at: iso(NOW - index * MINUTE), key: `post-${index}`, kind: 'review', pr: 'acme/web#7', summary: '3 comments', url: 'u' })
    const read = parseWatchState(
      stateText({
        clean: Array.from({ length: 25 }, (_, index) => clean(index)),
        needsYou: [
          ...Array.from({ length: 24 }, (_, index) => mention(24 - index)),
          { ...mention(0), excerpt: 'line one\n\u001b[31mred\u001b[0m\tline\u202e two' },
          { at: iso(NOW), url: 'no key' },
          'not an entry',
        ],
        posted: [...Array.from({ length: 12 }, (_, index) => post(index)), { ...post(0), key: 'odd', kind: 'approval' }],
      }),
      NOW,
    )

    expect(read?.needsYou.length).toBe(20)
    expect(read?.needsYou[0]).toEqual({
      at: NOW,
      author: 'someone',
      key: 'github.com/acme/web#42/issue/0',
      pr: 'acme/web#42',
      reason: 'asks for an approval',
      text: 'line one [31mred [0m line two',
      url: 'https://github.com/acme/web/pull/42#issuecomment-0',
    })
    expect(read?.needsYou[1]?.text.length).toBe(120)
    expect(read?.needsYou.map(item => item.at)).toEqual([...(read?.needsYou.map(item => item.at) ?? [])].sort((left, right) => right - left))
    expect(read?.clean.length).toBe(20)
    expect(read?.clean[0]).toEqual({ at: NOW, key: `github.com/acme/web#0@${'a'.repeat(40)}`, pr: 'acme/web#0', text: 'Fix 0', url: 'https://github.com/acme/web/pull/0' })
    expect(read?.posted.map(item => item.key)).toEqual(Array.from({ length: 10 }, (_, index) => `post-${index}`))
    expect(read?.posted[0]?.kind).toBe('review')
  })

  test('cuts at a character, never inside one', async () => {
    const read = parseWatchState(stateText({ posted: [{ at: iso(NOW), key: 'p1', kind: 'reply', pr: 'acme/web#1', summary: `${'x'.repeat(119)}😀yyy`, url: 'u' }] }), NOW)

    expect(read?.posted[0]?.text).toBe(`${'x'.repeat(119)}😀`)
  })

  test('the clean phrase has one home', async () => {
    expect(CLEAN_TEXT).toBe('reviewed, nothing to flag, awaiting your approval')
  })
})

describe('isWatchLoop', () => {
  test('matches the loop by its label, by its CronCreate prompt, and by the /loop args the deck tied to it', async () => {
    expect(isWatchLoop(cronRow('c1', NOW))).toBe(true)
    expect(isWatchLoop(listedRow('c2', NOW))).toBe(true)
    expect(isWatchLoop({ ...cronRow('c3', NOW), label: 'renamed' })).toBe(true)
    expect(isWatchLoop({ ...listedRow('c4', NOW), label: 'autonomous loop', relaunch: { args: `30m ${PROMPT}`, via: 'loop' } })).toBe(true)
    expect(
      isWatchLoop(started(fromToolCall('ScheduleWakeup', { delaySeconds: 1800, prompt: PROMPT }, { scheduledFor: NOW + 30 * MINUTE }, NOW))),
    ).toBe(true)
  })

  test('does not match another loop, another watch command, or work that is not a loop', async () => {
    expect(isWatchLoop(cronRow('c1', NOW, '/vistack babysit s1'))).toBe(false)
    expect(isWatchLoop(cronRow('c2', NOW, '/vistack:review-watch status'))).toBe(false)
    expect(
      isWatchLoop(
        started(fromToolCall('Bash', { command: `echo "${PROMPT}"`, description: 'review-watch pass', run_in_background: true }, { backgroundTaskId: 'b1' }, NOW)),
      ),
    ).toBe(false)
  })
})

describe('watchLoopArgs', () => {
  test('builds the /loop args from the listed command name and the realm', async () => {
    expect(watchLoopArgs('vistack:review-watch', 'github.com/acme')).toBe('30m /vistack:review-watch pass --realm github.com/acme')
  })

  test('refuses a realm or command name that could carry more than a name into the prompt', async () => {
    expect(watchLoopArgs('vistack:review-watch', 'github.com/acme && /loop 1m x')).toBeNull()
    expect(watchLoopArgs('vistack:review-watch', '')).toBeNull()
    expect(watchLoopArgs('vistack:review-watch status; x', 'github.com/acme')).toBeNull()
  })
})

describe('planWatch', () => {
  test('arms when no pass has started for longer than the stale window', async () => {
    expect(plan()).toEqual({ arm: true, reason: 'no recent pass', retire: [] })
    expect(plan({ watch: watch() })).toEqual({ arm: true, reason: 'no recent pass', retire: [] })
  })

  test('does not arm while a pass started within the window, anywhere', async () => {
    expect(plan({ watch: watch({ lastPassStartedAt: NOW - 10 * MINUTE }) })).toEqual({ arm: false, reason: 'loop live', retire: [] })
    expect(plan({ watch: watch({ lastPassStartedAt: NOW - STALE_AFTER_MS + 1 }) }).arm).toBe(false)
    expect(plan({ watch: watch({ lastPassStartedAt: NOW - STALE_AFTER_MS }) }).arm).toBe(true)
  })

  test('gives a loop that `on` just made, here or in another session, its first fire before arming another', async () => {
    expect(plan({ monitors: [cronRow('c1', NOW - 2 * MINUTE)], watch: watch() })).toEqual({ arm: false, reason: 'loop live', retire: [] })
    expect(plan({ watch: watch({ enabledAt: NOW - 5 * MINUTE }) })).toEqual({ arm: false, reason: 'loop live', retire: [] })
    expect(plan({ monitors: [cronRow('c1', NOW - 45 * MINUTE)], watch: watch({ enabledAt: NOW - 45 * MINUTE }) }).arm).toBe(true)
  })

  test('a pass time in the future never holds arming off', async () => {
    expect(plan({ watch: watch({ lastPassStartedAt: NOW + DAY }) }).arm).toBe(true)
  })

  test('never arms with the watch off, unreadable, on a bad realm, or with no state file', async () => {
    expect(plan({ watch: watch({ enabled: false }) })).toEqual({ arm: false, reason: 'off', retire: [] })
    expect(plan({ watch: null })).toEqual({ arm: false, reason: 'no state file', retire: [] })
    expect(plan({ watch: parseWatchState('nope', NOW) })).toEqual({ arm: false, reason: 'state file unreadable', retire: [] })
    expect(plan({ watch: parseWatchState(stateText({ realm: 'github.com/acme --force' }), NOW) })).toEqual({
      arm: false,
      reason: 'realm invalid',
      retire: [],
    })
  })

  test('never arms in a session that is not interactive', async () => {
    expect(plan({ isInteractive: false })).toEqual({ arm: false, reason: 'not interactive', retire: [] })
  })

  test('arms only when the session origin is inside the watch realm', async () => {
    expect(plan({ remote: 'https://github.com/Acme/web.git' }).arm).toBe(true)
    expect(plan({ remote: 'git@github.com:other/web.git' })).toEqual({ arm: false, reason: 'origin outside the realm', retire: [] })
    expect(plan({ remote: 'git@github.com:acme-corp/web.git' }).arm).toBe(false)
    expect(plan({ remote: null }).arm).toBe(false)
    expect(plan({ remote: undefined }).arm).toBe(false)
  })

  test('waits after asking to arm before asking again', async () => {
    expect(plan({ watch: watch({ armRequestedAt: NOW - 10 * MINUTE, lastPassStartedAt: NOW - 50 * MINUTE }) })).toEqual({
      arm: false,
      reason: 'arm requested',
      retire: [],
    })
    expect(plan({ watch: watch({ armRequestedAt: NOW - ARM_RETRY_MS, lastPassStartedAt: NOW - 50 * MINUTE }) }).arm).toBe(true)
  })

  test('rotates a loop inside its last 12 hours, even while passes run', async () => {
    const recent = watch({ lastPassStartedAt: NOW - 5 * MINUTE })
    const expiring = cronRow('c1', NOW - CRON_LIFE_MS + ROTATE_BEFORE_MS - MINUTE)

    expect(expiring.deadlineAt).toBe(NOW + ROTATE_BEFORE_MS - MINUTE)
    expect(plan({ monitors: [expiring], watch: recent })).toEqual({ arm: true, reason: 'loop expiring', retire: [] })
    expect(plan({ monitors: [cronRow('c1', NOW - 5 * DAY)], watch: recent }).arm).toBe(false)
    expect(plan({ monitors: [expiring], watch: { ...recent, armRequestedAt: NOW - 10 * MINUTE } }).arm).toBe(false)
  })

  test('a CronList row with no deadline expires 7 days after the deck first saw it', async () => {
    const recent = watch({ lastPassStartedAt: NOW - 5 * MINUTE })
    const listed = listedRow('c1', NOW - 6.6 * DAY)

    expect(listed.deadlineAt).toBeUndefined()
    expect(plan({ monitors: [listed], watch: recent })).toEqual({ arm: true, reason: 'loop expiring', retire: [] })
    expect(plan({ monitors: [listedRow('c1', NOW - 6 * DAY)], watch: recent }).arm).toBe(false)
  })

  test('retires every open watch cron but the newest, and leaves other loops and ended rows alone', async () => {
    const older = cronRow('c-old', NOW - 3 * HOUR)
    const newer = listedRow('c-new', NOW - HOUR)
    const other = cronRow('c-other', NOW - 5 * HOUR, '/vistack babysit s1')
    const canceled = applyChange([cronRow('c-gone', NOW - 9 * HOUR)], { at: NOW - 8 * HOUR, change: 'end', endedBy: 'deck', id: 'c-gone', status: 'canceled' })

    expect(plan({ monitors: [newer, other, older, ...canceled], watch: watch({ lastPassStartedAt: NOW - 5 * MINUTE }) })).toEqual({
      arm: false,
      reason: 'loop live',
      retire: ['c-old'],
    })
    expect(plan({ monitors: [older, newer], watch: watch({ enabled: false }) }).retire).toEqual(['c-old'])
  })

  test('a /loop wakeup is never retired: its only cancel ends every loop wakeup in the session', async () => {
    const wakeup = started(fromToolCall('ScheduleWakeup', { delaySeconds: 1800, prompt: PROMPT }, { scheduledFor: NOW + 20 * MINUTE }, NOW - 10 * MINUTE))

    expect(plan({ monitors: [wakeup, cronRow('c-new', NOW - MINUTE)], watch: watch({ lastPassStartedAt: NOW - 5 * MINUTE }) }).retire).toEqual([])
  })

  test('an off in flight neither arms nor retires', async () => {
    expect(
      plan({ monitors: [cronRow('c-old', NOW - 3 * HOUR), cronRow('c-new', NOW - HOUR)], watch: watch({ isOffPending: true, lastPassStartedAt: NOW - 50 * MINUTE }) }),
    ).toEqual({ arm: false, reason: 'off pending', retire: [] })
  })
})

describe('carryWatch', () => {
  test("keeps the deck's own fields across reads, and drops the pending off once the file reads off", async () => {
    const previous = watch({ armRequestedAt: NOW - MINUTE, isOffPending: true })
    const stillOn = carryWatch(previous, watch({ readAt: NOW + MINUTE }))
    const nowOff = carryWatch(previous, watch({ enabled: false, readAt: NOW + MINUTE }))

    expect(stillOn).toBe(previous)
    expect(nowOff).toEqual(watch({ armRequestedAt: NOW - MINUTE, enabled: false, readAt: NOW + MINUTE }))
    expect(carryWatch(previous, null)).toBeNull()
    expect(carryWatch(null, watch())).toEqual(watch())
  })

  test('a changed file gives a new value', async () => {
    const previous = watch()
    const next = carryWatch(previous, watch({ lastPassStartedAt: NOW, readAt: NOW + MINUTE }))

    expect(next).not.toBe(previous)
    expect(next?.lastPassStartedAt).toBe(NOW)
  })
})
