import { NOT_A_SLICE, TYPE_LABELS, isNotSlice, pickType, sliceLikeOf } from './fork-types'
import { fit } from './format'
import { parseObject, pickStatus, record, text } from './jev'

import type { DeckForkType, DeckHistoryTally, DeckPick, DeckTypeTally } from '../../types'

export type AskedBy = 'deck' | 'coordinator'

export type TypeRow = {
  type: string
  askedBy: AskedBy
  // Forks asked this session; the deck's skipped picks are not forks.
  session: number
  // The whole history; null when it could not be read and the status gave no count.
  allTime: number | null
  meanMargin?: number
  fallbackShare?: number
  lastAction?: string
  isNeverAsked: boolean
}

// Mirrors the Boundaries table in skills/laya-decision/SKILL.md for the coordinator's types.
const ASKED: ReadonlyMap<string, readonly [AskedBy, string]> = new Map([
  ['intake-analysis', ['deck', 'on the first prompt or "new task"']],
  ['grooming', ['coordinator', 'while grooming, in the intake playbook']],
  ['playbook-selection', ['deck', 'on the first prompt or "new task"']],
  ['decomposition', ['coordinator', 'after slice-plan']],
  ['tier-selection', ['deck', 'on each prompt and each subagent spawn']],
  ['model-selection', ['coordinator', 'at each dispatch']],
  ['dispatch-readiness', ['coordinator', 'before each dispatched ledger row']],
  ['runtime-progress', ['coordinator', 'at each monitor pass']],
  ['verification', ['coordinator', 'before merge-ready']],
  ['skill-improvement', ['coordinator', 'after a correction-recorded row']],
  ['tool-selection', ['coordinator', 'at a step inside a slice with candidate tools']],
  ['file-selection', ['coordinator', 'at a step inside a slice with candidate files']],
  ['seat-model', ['coordinator', 'at run start, at the plan, repeat and retry checkpoints, and at run end']],
])

const UNLISTED: readonly [AskedBy, string] = ['coordinator', 'at a boundary in skills/laya-decision/SKILL.md']

const POLICY_FALLBACK = 'deterministic-fallback'

const CELLS: readonly { head: string; width: number; isLeft?: true }[] = [
  { head: 'type', isLeft: true, width: 18 },
  { head: 'now', width: 3 },
  { head: 'all', width: 4 },
  { head: 'margin', width: 6 },
  { head: 'fall', width: 4 },
  { head: 'by', isLeft: true, width: 5 },
]

const FIXED_WIDTH = CELLS.reduce((sum, cell) => sum + cell.width + 1, 0)

const LAST_MIN = 4

export const askedHintOf = (type: string): string => {
  const [by, when] = ASKED.get(type) ?? UNLISTED

  return `the ${by} asks it ${when}`
}

// An outcome row names no type, so it is passed over before parsing.
export const historyTallyOf = (history: string | null): DeckHistoryTally => {
  if (history === null) {
    return { byType: {}, hasHistory: false }
  }

  const byType = new Map<string, DeckTypeTally>()
  const seen = new Set<string>()

  for (const line of history.split('\n')) {
    const row = line.includes('"decision_type"') ? parseObject(line) : null
    const decision = record(row?.decision)
    const type = text(decision.decision_type)
    const id = text(decision.decision_id) ?? text(row?.decision_id)

    if (row?.kind !== 'decision' || type === undefined || (id !== undefined && seen.has(id))) {
      continue
    }
    if (id !== undefined) {
      seen.add(id)
    }

    const current = byType.get(type) ?? { confidenceSum: 0, fallbacks: 0, forks: 0 }
    const action = sliceLikeOf(type, record(decision.outputs)) === false ? NOT_A_SLICE : (text(decision.action) ?? current.lastAction)

    byType.set(type, {
      confidenceSum: current.confidenceSum + (typeof decision.confidence === 'number' ? decision.confidence : 0),
      fallbacks: current.fallbacks + (decision.backend === POLICY_FALLBACK ? 1 : 0),
      forks: current.forks + 1,
      ...(action === undefined ? {} : { lastAction: action }),
    })
  }

  return { byType: Object.fromEntries(byType), hasHistory: true }
}

const actionOf = (pick: DeckPick): string | undefined => (isNotSlice(pick) ? NOT_A_SLICE : (pick.action ?? (pick.tier === '' ? undefined : pick.tier)))

// The whole history first, then the status's count when the file could not be read, then this
// session's picks for a type the history has none of.
const rowOf = (type: string, session: readonly DeckPick[], tally: DeckHistoryTally | null, status: DeckForkType | undefined): TypeRow => {
  const whole = tally !== null && Object.hasOwn(tally.byType, type) ? tally.byType[type] : undefined
  const decided = session.filter(pick => pickStatus(pick) === 'decided')
  const allTime = tally?.hasHistory === true ? (whole?.forks ?? 0) : (status?.forks ?? null)
  const newest = decided.reduce<DeckPick | undefined>((found, pick) => (found === undefined || pick.at >= found.at ? pick : found), undefined)
  const sessionMean = decided.length === 0 ? undefined : decided.reduce((sum, pick) => sum + pick.confidence, 0) / decided.length
  const sessionFallback = decided.length === 0 ? undefined : decided.filter(pick => pick.backend === POLICY_FALLBACK).length / decided.length
  const meanMargin = whole !== undefined && whole.forks > 0 ? whole.confidenceSum / whole.forks : (status?.meanConfidence ?? sessionMean)
  const fallbackShare = whole !== undefined && whole.forks > 0 ? whole.fallbacks / whole.forks : sessionFallback
  const lastAction = whole?.lastAction ?? (newest === undefined ? undefined : actionOf(newest))

  return {
    allTime,
    askedBy: (ASKED.get(type) ?? UNLISTED)[0],
    isNeverAsked: session.length === 0 && (allTime ?? 0) === 0,
    session: session.length,
    type,
    ...(meanMargin === undefined ? {} : { meanMargin }),
    ...(fallbackShare === undefined ? {} : { fallbackShare }),
    ...(lastAction === undefined ? {} : { lastAction }),
  }
}

export const typeOverviewOf = (picks: readonly DeckPick[], tally: DeckHistoryTally | null, statusByType: readonly DeckForkType[] = []): TypeRow[] => {
  const asked = picks.filter(pick => pickStatus(pick) !== 'skipped')
  const listed = TYPE_LABELS.map(([type]) => type)
  const others = [...new Set([...asked.map(pickType), ...Object.keys(tally?.byType ?? {})])].filter(type => !listed.includes(type))

  return [...listed, ...others].map(type =>
    rowOf(
      type,
      asked.filter(pick => pickType(pick) === type),
      tally,
      statusByType.find(entry => entry.type === type),
    ),
  )
}

const share = (value: number): string => value.toFixed(2).replace(/^0\./, '.')

const cellsOf = (values: readonly string[]): string =>
  CELLS.map((cell, index) => {
    const value = fit(values[index] ?? '', cell.width)

    return `${cell.isLeft === true ? value.padEnd(cell.width) : value.padStart(cell.width)} `
  }).join('')

// fit() would collapse the padding, so only the last column goes through it.
const laidOut = (fixed: string, last: string, width: number): string =>
  width - FIXED_WIDTH < LAST_MIN ? fixed.trimEnd().slice(0, width) : `${fixed}${fit(last, width - FIXED_WIDTH)}`

export const overviewHeadOf = (width: number): string => laidOut(cellsOf(CELLS.map(cell => cell.head)), 'last', width)

export const overviewLineOf = (row: TypeRow, width: number): string =>
  laidOut(
    cellsOf([
      row.type,
      String(row.session),
      row.allTime === null ? '-' : String(row.allTime),
      row.meanMargin === undefined ? '-' : share(row.meanMargin),
      row.fallbackShare === undefined ? '-' : `${Math.round(row.fallbackShare * 100)}%`,
      row.askedBy === 'deck' ? 'deck' : 'coord',
    ]),
    row.isNeverAsked ? 'never asked' : (row.lastAction ?? '-'),
    width,
  )
