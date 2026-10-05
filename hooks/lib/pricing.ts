// Estimated US dollars per million tokens, first-party API list prices as of 2026-09-25.
// Cache writes use the 5-minute rate (1.25x input). The engine's own session total
// ($.session.usage().cost) is the authority; these estimates split it by model and task.
type Rate = { input: number; output: number; cacheRead: number; cacheWrite: number }

const RATES: readonly (readonly [RegExp, Rate])[] = [
  [/fable-5-1|mythos-5-1/, { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
  [/fable-5|mythos-5/, { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }],
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }],
  [/opus-5|opus-4-[5-8]/, { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  [/sonnet-5/, { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  [/sonnet-4/, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  [/haiku-4/, { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
]

const ALIASES: Readonly<Record<string, string>> = {
  fable: 'claude-fable-5-1',
  haiku: 'claude-haiku-4-5',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
}

export type TokenCounts = { input: number; output: number; cacheRead: number; cacheWrite: number }

export const resolveModel = (model: string): string => ALIASES[model.toLowerCase()] ?? model

export const rateFor = (model: string): Rate | null => {
  const id = resolveModel(model).toLowerCase()
  const found = RATES.find(([pattern]) => pattern.test(id))

  return found ? found[1] : null
}

export const costOf = (model: string, counts: TokenCounts): number | null => {
  const rate = rateFor(model)

  if (rate === null) {
    return null
  }

  const micro =
    counts.input * rate.input +
    counts.output * rate.output +
    counts.cacheRead * rate.cacheRead +
    counts.cacheWrite * rate.cacheWrite

  return micro / 1_000_000
}

// "claude-opus-5-5[1m]" -> "Opus 5.5"; an id outside the families stays as given.
export const modelLabel = (model: string): string => {
  const id = resolveModel(model).toLowerCase()
  const match = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(id)

  if (match === null) {
    return model
  }

  const family = match[1] ?? ''
  const version = match[3] === undefined ? match[2] : `${match[2]}.${match[3]}`

  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version}`
}

export const modelFamily = (model: string): string => {
  const match = /(fable|mythos|opus|sonnet|haiku)/.exec(resolveModel(model).toLowerCase())

  return match?.[1] ?? model
}
