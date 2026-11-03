// The engine sees only the request text, so it would tier these as slices.
import type { DeckPick } from '../../types'

export const HAND_BACK = 'hand-back'

export const TASK_NOTIFICATION = 'task notification'

export const READ_ONLY_ROLE = 'read-only role'

export const NON_SLICE_REASONS: ReadonlySet<string> = new Set([HAND_BACK, TASK_NOTIFICATION, READ_ONLY_ROLE])

const READ_ONLY_ROLES: ReadonlySet<string> = new Set(['advisor', 'analyst', 'groomer', 'health-check', 'planner', 'researcher', 'reviewer'])

// The host wraps a subagent's report and a background task's end in these tags.
const PROMPT_KINDS: readonly (readonly [RegExp, string])[] = [
  [/^\s*<agent-message\b/, HAND_BACK],
  [/^\s*<task-notification\b/, TASK_NOTIFICATION],
]

export const promptNonSliceOf = (text: string): string | undefined => PROMPT_KINDS.find(([pattern]) => pattern.test(text))?.[1]

export const spawnNonSliceOf = (subagentType: string): string | undefined =>
  READ_ONLY_ROLES.has(subagentType.split(':').pop() ?? subagentType) ? READ_ONLY_ROLE : undefined

export const skippedPick = (asking: DeckPick, why: string): DeckPick => ({ ...asking, skippedWhy: why, status: 'skipped' })
