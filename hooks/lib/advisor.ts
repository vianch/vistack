// The server-side advisor, read three ways: a step result's timing, the api form's result
// kind, and the transcript's usage, the only place the advisor's model and tokens appear.
// Each reader returns ConsultFound; mergeConsults joins them by id.
import { ADVISOR_TOOL } from './org'
import { costOf } from './pricing'

import type { ConsultFound } from './org'
import type { DeckConsult, DeckStep } from '../../types'

type Fields = Record<string, unknown>

type ServerToolUse = { id: string; name: string; startedAt: number; endedAt?: number }

type Row = { messageId: string; at: number | undefined; blocks: Fields[]; iterations: Fields[] | null }

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)

const stringOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const countOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const callId = (block: Fields): string | null => {
  const name = stringOf(block.name)

  return block.type === 'server_tool_use' && name !== undefined && ADVISOR_TOOL.test(name) ? (stringOf(block.id) ?? null) : null
}

const resultId = (block: Fields): string | null =>
  block.type === 'advisor_tool_result' ? (stringOf(block.tool_use_id) ?? null) : null

export const adviceHead = (text: string): string =>
  text
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '') ?? ''

const resultOf = (content: unknown): Partial<ConsultFound> => {
  if (!isFields(content)) {
    return {}
  }

  switch (content.type) {
    case 'advisor_redacted_result':
      return { isRedacted: true }
    case 'advisor_result': {
      const text = (stringOf(content.text) ?? '').trim()

      return text === '' ? { isRedacted: false } : { advice: text, adviceHead: adviceHead(text), isRedacted: false }
    }
    case 'advisor_tool_result_error':
      return { error: stringOf(content.error_code) ?? 'unknown' }
    default:
      return {}
  }
}

// `turn.step`'s result. A call cut short has no `endedAt`; the stream's reader closes it.
export const consultsFromStep = (step: { turnId: string; serverToolUses?: readonly ServerToolUse[] }): ConsultFound[] =>
  (step.serverToolUses ?? [])
    .filter(use => ADVISOR_TOOL.test(use.name))
    .map(use => ({
      at: use.startedAt,
      id: use.id,
      source: 'stream' as const,
      turnId: step.turnId,
      ...(use.endedAt === undefined ? {} : { endedAt: use.endedAt }),
    }))

// `$.session.messages({ as: 'api' })`: the call and result blocks, with no usage.
export const consultsFromApi = (messages: readonly { role: string; content: readonly unknown[] }[]): ConsultFound[] => {
  const found = new Map<string, ConsultFound>()

  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue
    }
    for (const block of message.content.filter(isFields)) {
      const id = callId(block) ?? resultId(block)

      if (id === null) {
        continue
      }
      found.set(id, { ...(found.get(id) ?? { id, source: 'api' as const }), ...(resultId(block) === null ? {} : resultOf(block.content)) })
    }
  }

  return [...found.values()]
}

const rowOf = (line: string): Row | null => {
  let parsed: unknown

  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const fields: Fields = isFields(parsed) ? parsed : {}
  const message = fields.message

  if (!isFields(message) || message.role !== 'assistant') {
    return null
  }

  const content = message.content
  const usage = isFields(message.usage) ? message.usage : {}
  const iterations = usage.iterations
  const at = Date.parse(stringOf(fields.timestamp) ?? '')

  if (!Array.isArray(content)) {
    return null
  }

  return {
    at: Number.isNaN(at) ? undefined : at,
    blocks: content.filter(isFields),
    iterations: Array.isArray(iterations) ? iterations.filter(isFields) : null,
    messageId: stringOf(message.id) ?? '',
  }
}

const usageOf = (iteration: Fields): Partial<ConsultFound> => {
  const model = stringOf(iteration.model)
  const counts = {
    cacheRead: countOf(iteration.cache_read_input_tokens),
    cacheWrite: countOf(iteration.cache_creation_input_tokens),
    input: countOf(iteration.input_tokens),
    output: countOf(iteration.output_tokens),
  }

  return model === undefined ? { ...counts, usd: null } : { ...counts, model, usd: costOf(model, counts) }
}

// Transcript lines: the whole file, or only the lines a grep for "advisor_tool_result" kept.
// Every row of a response repeats its final usage, so the usage is read once per message id.
// The k-th call of a response that got an answer takes its k-th advisor_message iteration;
// when the two counts differ, no call gets tokens rather than the wrong ones.
export const consultsFromTranscript = (text: string): ConsultFound[] => {
  const found = new Map<string, ConsultFound>()
  const callsByMessage = new Map<string, string[]>()
  const iterationsByMessage = new Map<string, Fields[]>()

  for (const line of text.split('\n')) {
    const row = line.trim() === '' ? null : rowOf(line)

    if (row === null) {
      continue
    }
    if (row.iterations !== null) {
      iterationsByMessage.set(row.messageId, row.iterations.filter(item => item.type === 'advisor_message'))
    }
    for (const block of row.blocks) {
      const call = callId(block)
      const answer = resultId(block)
      const id = call ?? answer

      if (id === null) {
        continue
      }

      const stamp = row.at === undefined ? {} : call === null ? { endedAt: row.at } : { at: row.at }
      const calls = callsByMessage.get(row.messageId) ?? []

      found.set(id, { ...(found.get(id) ?? { id, source: 'transcript' as const }), ...stamp, ...(answer === null ? {} : resultOf(block.content)) })
      callsByMessage.set(row.messageId, calls.includes(id) ? calls : [...calls, id])
    }
  }

  for (const [messageId, ids] of callsByMessage) {
    const iterations = iterationsByMessage.get(messageId) ?? []
    const answered = ids.filter(id => found.get(id)?.error === undefined)

    if (answered.length !== iterations.length) {
      continue
    }
    answered.forEach((id, index) => {
      const iteration = iterations[index]
      const known = found.get(id)

      if (iteration !== undefined && known !== undefined) {
        found.set(id, { ...known, ...usageOf(iteration) })
      }
    })
  }

  return [...found.values()]
}

// Keyed per consult so a re-read replaces its step. turnId '' when the turn is unknown:
// per-model totals count the step, no turn row does.
export const advisorSteps = (consults: readonly DeckConsult[]): DeckStep[] =>
  consults.flatMap(consult => {
    if (consult.model === undefined) {
      return []
    }

    const counts = {
      cacheRead: consult.cacheRead ?? 0,
      cacheWrite: consult.cacheWrite ?? 0,
      input: consult.input ?? 0,
      output: consult.output ?? 0,
    }

    return [
      {
        ...counts,
        index: 0,
        isFailed: false,
        key: `advisor-${consult.id}`,
        model: consult.model,
        ms: consult.ms ?? 0,
        startedAt: consult.at,
        turnId: consult.turnId ?? '',
        usd: consult.usd === undefined ? costOf(consult.model, counts) : consult.usd,
      },
    ]
  })
