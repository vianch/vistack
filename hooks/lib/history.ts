// The forks the main session asked through the CLI this session, read from the decision history
// laya/history.py appends to: one `kind: "decision"` row per call, whatever its type.
import { decidedPick, decisionOf, parseObject, record, text } from './jev'

import type { Roster } from './jev'
import type { DeckPick } from '../../types'

export const HISTORY_ROWS = 200

// The deck's own forks are live picks already, so a row it wrote never comes back as a CLI call.
const DECK_SOURCES: ReadonlySet<unknown> = new Set(['main-turn', 'agent-spawn'])

const SUBJECT_CAP = 400

const subjectOf = (context: Record<string, unknown>, source: unknown): string =>
  (text(record(context.task).request) ?? text(source) ?? 'no request sent').slice(0, SUBJECT_CAP)

// The history stamps rows to the second, so a row from the session's first second counts as its own.
export const historyPicksOf = (history: string | null, startedAt: number, roster: Roster, ladder: readonly string[]): DeckPick[] => {
  const since = Math.floor(startedAt / 1000) * 1000
  const seen = new Set<string>()
  const picks: DeckPick[] = []

  for (const line of (history ?? '').split('\n').filter(one => one.trim() !== '').slice(-HISTORY_ROWS)) {
    const row = parseObject(line)

    if (row === null || row.kind !== 'decision') {
      continue
    }

    const decision = decisionOf(record(row.decision))
    const context = record(row.context)
    const source = record(context.metadata).source
    const at = Date.parse(text(row.timestamp) ?? text(record(row.decision).created_at) ?? '')
    const decisionId = decision?.decisionId

    if (decision === null || decisionId === undefined || seen.has(decisionId) || !(at >= since) || DECK_SOURCES.has(source)) {
      continue
    }
    seen.add(decisionId)
    picks.push(
      decidedPick(
        {
          at,
          backend: '',
          confidence: 0,
          decisionType: decision.decisionType,
          id: `history-${decisionId}`,
          isApplied: false,
          recommended: '',
          scope: 'main',
          status: 'decided',
          subject: subjectOf(context, source),
          tier: '',
          trigger: 'cli',
        },
        decision,
        roster,
        ladder,
      ),
    )
  }

  return picks
}

// A fork the deck asked reaches the history before its live pick learns the decision id.
export const mergePicks = (live: readonly DeckPick[], fromHistory: readonly DeckPick[]): DeckPick[] => {
  const known = new Set(live.map(pick => pick.decisionId))
  const added = fromHistory.filter(pick => !known.has(pick.decisionId))

  return added.length === 0 ? [...live] : [...live, ...added].sort((left, right) => left.at - right.at)
}
