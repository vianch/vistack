// Fable runs only in the coordinator seat (the main session, never a spawn) and the advisor seat;
// mirrors SEAT_ROLES and is_fable in laya/seat_model.py.
export type SpawnAsk = { subagentType: string; model?: string }

const ADVISOR_AGENT = 'vistack:advisor'

// Every agents/*.md pins a model (laya/tests/test_model_selection.py), so a model-less vistack:*
// spawn never inherits the main session's model.
const OWN_AGENT_PREFIX = 'vistack:'

const FALLBACK_MODEL = 'opus'

const ADVISOR_SEAT_MODEL = 'fable'

const FABLE_FAMILIES: readonly string[] = ['fable', 'mythos']

export const isFable = (model: string | undefined): boolean => {
  const id = (model ?? '').toLowerCase()

  return FABLE_FAMILIES.some(family => id.includes(family))
}

const withoutModel = <Event extends SpawnAsk>(ask: Event): Event => {
  const copy = { ...ask }

  delete copy.model

  return copy
}

export const guardSpawn = <Event extends SpawnAsk>(ask: Event, sessionModel: string): Event => {
  const hasModel = ask.model !== undefined && ask.model !== ''
  const isOwnAgent = ask.subagentType.startsWith(OWN_AGENT_PREFIX)
  const isMainUnreadable = sessionModel === ''

  if (ask.subagentType === ADVISOR_AGENT) {
    return !hasModel && isFable(sessionModel) ? { ...ask, model: ADVISOR_SEAT_MODEL } : ask
  }
  if (isFable(ask.model)) {
    return isOwnAgent ? withoutModel(ask) : { ...ask, model: FALLBACK_MODEL }
  }
  if (!hasModel && !isOwnAgent && (isMainUnreadable || isFable(sessionModel))) {
    return { ...ask, model: FALLBACK_MODEL }
  }

  return ask
}
