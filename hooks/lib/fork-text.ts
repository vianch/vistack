// Display wording only: ladderOf in ./jev parses the engine's strings as sent.
import { backendLabel } from './jev'

export const MARGIN_LEGEND = "confidence = the margin between a model's top two odds"

export const VOTE_KEYS: ReadonlySet<string> = new Set(['backend_model', 'corroborated_by', 'dissent', 'margins'])

const share = (value: number): string => value.toFixed(2).replace(/^0\./, '.')

const parsed = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const voiceOf = (item: unknown): string => {
  if (typeof item === 'string') {
    return backendLabel(item)
  }

  const entry = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
  const name = [entry.backend, entry.tier, entry.name].find((value): value is string => typeof value === 'string')

  return [name === undefined ? '?' : backendLabel(name), typeof entry.action === 'string' ? entry.action : ''].filter(part => part !== '').join(' ')
}

// The deck keeps each output as JSON text cut to a line; a cut one (ending "…") shows as kept.
const voicesOf = (value: string | undefined): string | undefined => {
  if (value === undefined || value === '') {
    return undefined
  }

  const list = value.endsWith('…') ? value : parsed(value)

  if (!Array.isArray(list)) {
    return typeof list === 'string' ? list : value
  }

  return list.length === 0 ? undefined : list.map(voiceOf).join(', ')
}

const marginsOf = (value: string | undefined): string | undefined => {
  const margins = value === undefined || value.endsWith('…') ? value : parsed(value)

  if (typeof margins !== 'object' || margins === null) {
    return margins === undefined ? undefined : String(margins)
  }

  const shown = Object.entries(margins as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([tier, margin]) => `${backendLabel(tier)} ${share(margin)}`)

  return shown.length === 0 ? undefined : shown.join(', ')
}

export const votesOf = (outputs: Readonly<Record<string, string>> | undefined): string[] => {
  const agreed = voicesOf(outputs?.corroborated_by)
  const dissent = voicesOf(outputs?.dissent)
  const margins = marginsOf(outputs?.margins)
  const model = outputs?.backend_model

  return [
    ...(agreed === undefined ? [] : [`corroborated by ${agreed}`]),
    ...(dissent === undefined ? [] : [`dissent ${dissent}`]),
    ...(margins === undefined ? [] : [`margins ${margins}`]),
    ...(model === undefined || model === '' ? [] : [`model ${model}`]),
  ]
}

export const marginText = (text: string): string => text.replace(/\bconfidence (\d+(?:\.\d+)?) is below\b/g, 'margin $1 is below')
