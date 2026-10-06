// The review watch as the deck sees it: its state file (schema in
// skills/review-watch/references/data.md; watch-state.mjs is the only writer) and the decision
// to arm, rotate, or retire this session's /loop. Pure; register.tsx reads the file and acts.
import { isOpen } from './monitors'
import { isInRealm } from './realm'

import type { DeckMonitor, DeckReviewWatch, DeckWatchItem, DeckWatchPost } from '../../types'

// No pass started in this long, anywhere, means no loop is firing: a 30-minute loop plus slack.
export const STALE_AFTER_MS = 40 * 60_000
export const ROTATE_BEFORE_MS = 12 * 3_600_000
// `$.command.run` queues until the session is idle, so an arm gets this long to show up.
export const ARM_RETRY_MS = 40 * 60_000
// CronCreate's recurring jobs auto-expire after 7 days (T291:15734); monitors.ts has a private twin.
export const CRON_LIFE_MS = 7 * 24 * 3_600_000
export const CLEAN_TEXT = 'reviewed, nothing to flag, awaiting your approval'
// Every check for a watch job looks for this in the job's prompt (skills/review-watch/SKILL.md).
export const WATCH_MARK = 'review-watch pass'
export const WATCH_INTERVAL = '30m'

export type WatchPlanReason =
  | 'off pending'
  | 'no state file'
  | 'state file unreadable'
  | 'realm invalid'
  | 'off'
  | 'not interactive'
  | 'origin outside the realm'
  | 'arm requested'
  | 'loop expiring'
  | 'loop live'
  | 'no recent pass'

export type WatchPlan = { arm: boolean; reason: WatchPlanReason; retire: string[] }

export type WatchPlanInput = {
  watch: DeckReviewWatch | null
  monitors: readonly DeckMonitor[]
  now: number
  // `e.isInteractive` at session.start: a headless session must not post under the operator.
  isInteractive: boolean
  // The session repository's origin, as `$.session.repo()` gives it.
  remote: string | null | undefined
}

const UNREADABLE = 'unreadable'
const BAD_REALM = 'realm'
const TEXT_CAP = 120
const URL_CAP = 400
const NEEDS_YOU_CAP = 20
const CLEAN_CAP = 20
const POSTED_CAP = 10
// The realm goes into a /loop prompt, so it must be a host/owner and nothing more.
const REALM = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?\/[A-Za-z0-9][A-Za-z0-9-]{0,38}$/
const COMMAND = /^[a-z0-9]+(-[a-z0-9]+)*(:[a-z0-9]+(-[a-z0-9]+)*)?$/
const DISABLED: Readonly<Record<string, WatchPlanReason>> = { [BAD_REALM]: 'realm invalid', [UNREADABLE]: 'state file unreadable' }

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

// Mention text is someone else's words: no control or direction-override character reaches the
// terminal.
const line = (value: unknown, cap: number): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text === '' ? undefined : [...text].slice(0, cap).join('')
}

const epoch = (value: unknown): number | undefined => {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN

  return Number.isFinite(at) ? at : undefined
}

const itemOf = (value: unknown, textKey: 'excerpt' | 'title' | 'summary'): DeckWatchItem | null => {
  const entry = record(value)
  const key = line(entry?.key, URL_CAP)
  const at = epoch(entry?.at)

  if (entry === null || key === undefined || at === undefined) {
    return null
  }

  const author = line(entry.author, TEXT_CAP)
  const reason = line(entry.reason, TEXT_CAP)

  return {
    at,
    key,
    pr: line(entry.pr, TEXT_CAP) ?? '',
    text: line(entry[textKey], TEXT_CAP) ?? '',
    url: line(entry.url, URL_CAP) ?? '',
    ...(author === undefined ? {} : { author }),
    ...(reason === undefined ? {} : { reason }),
  }
}

const isPostKind = (value: unknown): value is DeckWatchPost['kind'] => value === 'review' || value === 'reply'

const postOf = (value: unknown): DeckWatchPost | null => {
  const item = itemOf(value, 'summary')
  const kind = record(value)?.kind

  return item === null || !isPostKind(kind) ? null : { ...item, kind }
}

const newest = <Item extends { at: number }>(list: unknown, cap: number, read: (value: unknown) => Item | null): Item[] =>
  (Array.isArray(list) ? list : [])
    .map(read)
    .filter((item): item is Item => item !== null)
    .sort((left, right) => right.at - left.at)
    .slice(0, cap)

const unreadable = (now: number): DeckReviewWatch => ({ clean: [], enabled: false, error: UNREADABLE, needsYou: [], posted: [], readAt: now, realm: '' })

// null when there is no file. A file the writer would refuse reads as off and unreadable; a realm
// that is not a host/owner turns the watch off and is left out.
export const parseWatchState = (text: string | null, now: number): DeckReviewWatch | null => {
  if (text === null) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return unreadable(now)
  }

  const state = record(parsed)

  if (state === null || state.version !== 1) {
    return unreadable(now)
  }

  const realm = typeof state.realm === 'string' && REALM.test(state.realm) ? state.realm : ''
  const isRealmBad = realm === '' && (state.enabled === true || state.realm !== undefined)
  const enabledAt = epoch(state.enabledAt)
  const lastPassStartedAt = epoch(state.lastPassStartedAt)
  const lastPassAt = epoch(state.lastPassAt)

  return {
    clean: newest(state.clean, CLEAN_CAP, value => itemOf(value, 'title')),
    enabled: state.enabled === true && realm !== '',
    needsYou: newest(state.needsYou, NEEDS_YOU_CAP, value => itemOf(value, 'excerpt')),
    posted: newest(state.posted, POSTED_CAP, postOf),
    readAt: now,
    realm,
    ...(enabledAt === undefined ? {} : { enabledAt }),
    ...(lastPassStartedAt === undefined ? {} : { lastPassStartedAt }),
    ...(lastPassAt === undefined ? {} : { lastPassAt }),
    ...(isRealmBad ? { error: BAD_REALM } : {}),
  }
}

const promptOf = (monitor: DeckMonitor): string => {
  const recipe = monitor.relaunch

  if (recipe?.via === 'loop') {
    return recipe.args
  }

  return recipe?.via === 'tool' && recipe.tool === 'CronCreate' ? recipe.input.prompt : ''
}

// The loop's cron or wakeup row: its label is the loop prompt, and its recipe carries the prompt
// or the /loop args.
export const isWatchLoop = (monitor: DeckMonitor): boolean =>
  (monitor.kind === 'cron' || monitor.kind === 'wakeup') && (monitor.label.includes(WATCH_MARK) || promptOf(monitor).includes(WATCH_MARK))

// The /loop args that arm the watch, or null when the command name or realm could carry more
// than a name into the prompt. `command` is the name `$.command.list()` gives the plugin's command.
export const watchLoopArgs = (command: string, realm: string): string | null =>
  COMMAND.test(command) && REALM.test(realm) ? `${WATCH_INTERVAL} /${command} pass --realm ${realm}` : null

const isWithin = (at: number | undefined, now: number, windowMs: number): boolean =>
  at !== undefined && now - at >= 0 && now - at < windowMs

const deadlineOf = (monitor: DeckMonitor): number => monitor.deadlineAt ?? monitor.startedAt + CRON_LIFE_MS

const byNewest = (left: DeckMonitor, right: DeckMonitor): number => right.startedAt - left.startedAt || right.id.localeCompare(left.id)

// Whether this session arms the watch loop now, and which duplicate loops it deletes.
// Only crons are retired: a wakeup's one cancel, ScheduleWakeup stop, ends every loop wakeup in
// the session. A pass, a fresh `on`, or a young loop row each count as a live loop.
export const planWatch = (input: WatchPlanInput): WatchPlan => {
  const { now, watch } = input

  if (watch === null) {
    return { arm: false, reason: 'no state file', retire: [] }
  }
  if (watch.isOffPending === true) {
    return { arm: false, reason: 'off pending', retire: [] }
  }

  const [latest, ...older] = input.monitors.filter(monitor => isOpen(monitor) && isWatchLoop(monitor)).sort(byNewest)
  const retire = older.filter(monitor => monitor.kind === 'cron').map(monitor => monitor.id)
  const decide = (arm: boolean, reason: WatchPlanReason): WatchPlan => ({ arm, reason, retire })

  if (!watch.enabled) {
    return decide(false, DISABLED[watch.error ?? ''] ?? 'off')
  }
  if (!input.isInteractive) {
    return decide(false, 'not interactive')
  }
  if (!isInRealm(input.remote, watch.realm)) {
    return decide(false, 'origin outside the realm')
  }
  if (isWithin(watch.armRequestedAt, now, ARM_RETRY_MS)) {
    return decide(false, 'arm requested')
  }
  if (latest !== undefined && deadlineOf(latest) - now <= ROTATE_BEFORE_MS) {
    return decide(true, 'loop expiring')
  }
  if ([watch.lastPassStartedAt, watch.enabledAt, latest?.startedAt].some(at => isWithin(at, now, STALE_AFTER_MS))) {
    return decide(false, 'loop live')
  }

  return decide(true, 'no recent pass')
}

const canonical = (watch: DeckReviewWatch): string =>
  JSON.stringify({ ...watch, readAt: 0 }, (_key, value: unknown) => {
    const entry = record(value)

    return entry === null ? value : Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)))
  })

// The atom's next value after a read: the deck's own fields carry over, a pending off ends once
// the file reads off, and a file that did not change keeps the previous value, so nothing redraws.
export const carryWatch = (previous: DeckReviewWatch | null, next: DeckReviewWatch | null): DeckReviewWatch | null => {
  if (previous === null || next === null) {
    return next
  }

  const carried: DeckReviewWatch = {
    ...next,
    ...(previous.armRequestedAt === undefined ? {} : { armRequestedAt: previous.armRequestedAt }),
    ...(previous.isOffPending === true && next.enabled ? { isOffPending: true } : {}),
  }

  return canonical(carried) === canonical(previous) ? previous : carried
}
