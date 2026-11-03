// Only mayApply in ./jev sets a model: a built-in spawn that named none, in apply mode.
import { NOT_A_SLICE, isNotSlice } from './fork-types'
import { BUILT_IN_TYPES, pickTrigger } from './jev'
import { modelLabel } from './pricing'

import type { DeckPick } from '../../types'

const VISTACK_AGENT = 'vistack:'

export const applyReasonOf = (pick: DeckPick): string => {
  if (pick.status === 'skipped') {
    return `${pick.skippedWhy ?? 'no reason given'}: the deck asked nothing`
  }
  if (pick.isApplied) {
    return 'applied'
  }

  const trigger = pickTrigger(pick)

  if (trigger === 'prompt') {
    return 'advisory: a prompt has no model to set'
  }
  if (trigger === 'cli') {
    return 'advisory: the main session asked it and decides'
  }
  if (pick.subagentType === undefined) {
    return 'suggested; an earlier deck kept no reason'
  }
  if (pick.hasCallerModel === true) {
    return "kept the caller's model"
  }
  if (pick.subagentType.startsWith(VISTACK_AGENT)) {
    return "the coordinator picks this role's model (model-selection)"
  }
  if (!BUILT_IN_TYPES.includes(pick.subagentType)) {
    return `the deck sets only ${BUILT_IN_TYPES.join(', ')}`
  }
  if (pick.mode !== 'apply') {
    return 'suggest mode; jevMode=apply would set it'
  }

  return 'not applied: the answer named no model'
}

export const tierFinalOf = (pick: DeckPick, arrow: string): string => {
  if (isNotSlice(pick)) {
    return `${NOT_A_SLICE} · ${pick.status === 'skipped' ? applyReasonOf(pick) : 'no model to suggest'}`
  }

  return `${pick.tier} ${arrow} ${pick.role ?? '-'} ${arrow} ${modelLabel(pick.recommended)} · ${applyReasonOf(pick)}`
}
