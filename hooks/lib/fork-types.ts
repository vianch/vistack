// The fork layer's decision types as the deck shows them: the word a row leads with, what it
// chose, and the order the tab lists and filters them in.
import { NON_SLICE_REASONS } from './non-slice'

import type { DeckPick } from '../../types'

export type Headline = { lead: string; choice?: string; model?: string }

export const TIER_SELECTION = 'tier-selection'

export const PLAYBOOK_SELECTION = 'playbook-selection'

export const INTAKE_ANALYSIS = 'intake-analysis'

export const NOT_A_SLICE = 'not a slice'

// laya/schema.py's DECISION_TYPES in its order, each with the word its rows lead with.
export const TYPE_LABELS: readonly (readonly [string, string])[] = [
  ['intake-analysis', 'intake'],
  ['grooming', 'grooming'],
  ['playbook-selection', 'playbook'],
  ['decomposition', 'slices'],
  ['tier-selection', 'tier'],
  ['model-selection', 'model'],
  ['dispatch-readiness', 'dispatch'],
  ['runtime-progress', 'progress'],
  ['verification', 'verify'],
  ['skill-improvement', 'skill'],
  ['tool-selection', 'tool'],
  ['file-selection', 'file'],
]

const LABELS: ReadonlyMap<string, string> = new Map(TYPE_LABELS)

const TYPE_ORDER: readonly string[] = TYPE_LABELS.map(([type]) => type)

const rank = (type: string): number => {
  const at = TYPE_ORDER.indexOf(type)

  return at === -1 ? TYPE_ORDER.length : at
}

export const sortByType = <Item>(items: readonly Item[], typeOf: (item: Item) => string): Item[] =>
  [...items].sort((left, right) => rank(typeOf(left)) - rank(typeOf(right)) || typeOf(left).localeCompare(typeOf(right)))

export const pickType = (pick: DeckPick): string => pick.decisionType ?? TIER_SELECTION

// The engine sends slice_like as a boolean or its text; anything else is unknown.
export const sliceLikeOf = (decisionType: string, outputs: Readonly<Record<string, unknown>> | undefined): boolean | undefined => {
  const value = decisionType === TIER_SELECTION ? String(outputs?.slice_like).toLowerCase() : ''

  if (value === 'true' || value === 'false') {
    return value === 'true'
  }

  return undefined
}

export const isNotSlice = (pick: DeckPick): boolean =>
  (pick.status === 'skipped' && NON_SLICE_REASONS.has(pick.skippedWhy ?? '')) || sliceLikeOf(pickType(pick), pick.outputs) === false

export const headlineOf = (pick: DeckPick): Headline => {
  const type = pickType(pick)
  const action = pick.action ?? pick.tier
  const label = LABELS.get(type) ?? type

  if (type === TIER_SELECTION) {
    return isNotSlice(pick) ? { lead: NOT_A_SLICE } : { lead: pick.tier, model: pick.recommended }
  }
  if (type === 'skill-improvement') {
    return { lead: action }
  }
  if (type === PLAYBOOK_SELECTION) {
    return { choice: pick.outputs?.playbook ?? action, lead: label }
  }

  return { choice: action, lead: label, ...(pick.recommended === '' ? {} : { model: pick.recommended }) }
}

export const typesOf = (picks: readonly DeckPick[]): [string, number][] => {
  const counts = new Map<string, number>()

  for (const pick of picks) {
    counts.set(pickType(pick), (counts.get(pickType(pick)) ?? 0) + 1)
  }

  return sortByType([...counts], ([type]) => type)
}

export const nextFilter = (current: string, picks: readonly DeckPick[]): string => {
  const others = typesOf(picks)
    .map(([type]) => type)
    .filter(type => !LABELS.has(type))
  const cycle = ['', ...TYPE_ORDER, ...others]

  return cycle[(cycle.indexOf(current) + 1) % cycle.length] ?? ''
}
