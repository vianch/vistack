import { describe, expect, test } from 'claude-code/testing'

import { advisorSteps, consultsFromApi, consultsFromStep, consultsFromTranscript } from '../hooks/lib/advisor'
import { byModel, executions, recordStep } from '../hooks/lib/ledger'
import { mergeConsults } from '../hooks/lib/org'
import { costOf } from '../hooks/lib/pricing'

import type { DeckStep } from '../types'

// Synthesized fixtures: the field names and shapes of real transcript rows, every value invented.
const FABLE = 'claude-fable-5-1'

const iteration = (type: string, input: number, output: number, model?: string) => ({
  cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  input_tokens: input,
  output_tokens: output,
  type,
  ...(model === undefined ? {} : { model }),
})

const usageOf = (iterations: readonly ReturnType<typeof iteration>[] | null) => ({
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 40000,
  input_tokens: 4,
  output_tokens: 300,
  ...(iterations === null ? {} : { iterations, server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 } }),
})

const row = (messageId: string, timestamp: string, block: object, usage: object, isSidechain = false): string =>
  JSON.stringify({
    isSidechain,
    message: { content: [block], id: messageId, model: 'claude-opus-5-5', role: 'assistant', type: 'message', usage },
    requestId: `req_${messageId}`,
    timestamp,
    type: 'assistant',
  })

const use = (id: string) => ({ id, input: {}, name: 'advisor', type: 'server_tool_use' })
const result = (id: string, content: object) => ({ content, tool_use_id: id, type: 'advisor_tool_result' })
const REDACTED = { encrypted_content: 'FIXTURE', type: 'advisor_redacted_result' }
const PLAIN = { stop_reason: 'end_turn', text: '\n  Check the parser first.\nThen the mapper.', type: 'advisor_result' }
const FAILED = { error_code: 'execution_time_exceeded', type: 'advisor_tool_result_error' }

const T0 = '2026-01-01T00:00:00.000Z'
const T0_MS = Date.parse(T0)

// One response: thinking, the call, its result 80 s later, then text. Every row repeats the usage.
const redactedTranscript = (): string => {
  const usage = usageOf([iteration('message', 2, 100), iteration('advisor_message', 100000, 4000, FABLE), iteration('message', 2, 200)])

  return [
    row('msg_A', T0, { signature: 'FIXTURE', thinking: '', type: 'thinking' }, usage),
    row('msg_A', T0, use('srv_A'), usage),
    row('msg_A', '2026-01-01T00:01:20.000Z', result('srv_A', REDACTED), usage),
    row('msg_A', '2026-01-01T00:01:21.000Z', { text: 'FIXTURE', type: 'text' }, usage),
  ].join('\n')
}

describe('advisor transcript reader', () => {
  test('a redacted consult reads its model, tokens and cost once, and runs from the call to the result', async () => {
    const [consult, ...rest] = consultsFromTranscript(redactedTranscript())

    expect(rest).toHaveLength(0)
    expect(consult).toEqual({
      at: T0_MS,
      cacheRead: 0,
      cacheWrite: 0,
      endedAt: T0_MS + 80000,
      id: 'srv_A',
      input: 100000,
      isRedacted: true,
      model: FABLE,
      output: 4000,
      source: 'transcript',
      usd: costOf(FABLE, { cacheRead: 0, cacheWrite: 0, input: 100000, output: 4000 }),
    })
    expect(consult?.usd).toBe(1.2)
    expect(consult?.advice).toBeUndefined()
    expect(mergeConsults([], consultsFromTranscript(redactedTranscript()), 0).consults[0]?.ms).toBe(80000)
  })

  test('grep output of result rows alone still yields tokens and the result time; odd lines are skipped', async () => {
    const usage = usageOf([iteration('message', 2, 50), iteration('advisor_message', 20000, 1000, FABLE)])
    const lines = [
      'not json',
      row('msg_B', '2026-01-01T00:00:45.500Z', result('srv_B', REDACTED), usage),
      JSON.stringify({ message: { content: 'the text "advisor_tool_result" in a prompt', role: 'user' }, type: 'user' }),
      JSON.stringify({ message: { content: [{ text: '"advisor_tool_result"', type: 'text' }], role: 'assistant' }, type: 'assistant' }),
      '{"type":"assistant","message":{"content":[{"type":"adv',
      '',
    ].join('\n')

    expect(consultsFromTranscript(lines)).toEqual([
      {
        cacheRead: 0,
        cacheWrite: 0,
        endedAt: Date.parse('2026-01-01T00:00:45.500Z'),
        id: 'srv_B',
        input: 20000,
        isRedacted: true,
        model: FABLE,
        output: 1000,
        source: 'transcript',
        usd: costOf(FABLE, { cacheRead: 0, cacheWrite: 0, input: 20000, output: 1000 }),
      },
    ])
  })

  test('a plain result carries its advice and the advice head', async () => {
    const usage = usageOf([iteration('message', 2, 50), iteration('advisor_message', 20000, 1000, FABLE)])
    const [consult] = consultsFromTranscript(row('msg_C', T0, result('srv_C', PLAIN), usage))

    expect(consult?.isRedacted).toBe(false)
    expect(consult?.adviceHead).toBe('Check the parser first.')
    expect(consult?.advice).toBe('Check the parser first.\nThen the mapper.')
  })

  test('an error result has its code and no tokens', async () => {
    const usage = usageOf([iteration('message', 2, 80), iteration('message', 2, 30)])
    const [consult] = consultsFromTranscript([row('msg_D', T0, use('srv_D'), usage), row('msg_D', '2026-01-01T00:06:00.000Z', result('srv_D', FAILED), usage)].join('\n'))

    expect(consult?.error).toBe('execution_time_exceeded')
    expect(consult?.model).toBeUndefined()
    expect(consult?.usd).toBeUndefined()
    expect(consult?.endedAt).toBe(T0_MS + 360000)
  })

  test('a subagent row has no iterations, so its consult has no tokens', async () => {
    const [consult] = consultsFromTranscript(row('msg_E', T0, result('srv_E', REDACTED), usageOf(null), true))

    expect(consult?.isRedacted).toBe(true)
    expect(consult?.input).toBeUndefined()
  })

  test('the k-th call of a response takes the k-th advisor iteration; an error call takes none', async () => {
    const usage = usageOf([
      iteration('message', 2, 50),
      iteration('advisor_message', 30000, 1000, FABLE),
      iteration('message', 2, 60),
      iteration('advisor_message', 31000, 2000, FABLE),
      iteration('message', 2, 70),
    ])
    const text = [
      row('msg_F', T0, result('srv_F0', FAILED), usage),
      row('msg_F', T0, result('srv_F1', REDACTED), usage),
      row('msg_F', T0, result('srv_F2', REDACTED), usage),
    ].join('\n')
    const found = consultsFromTranscript(text)

    expect(found.map(one => [one.id, one.input ?? null])).toEqual([
      ['srv_F0', null],
      ['srv_F1', 30000],
      ['srv_F2', 31000],
    ])
  })

  test('when calls and advisor iterations do not pair up, no tokens are guessed', async () => {
    const usage = usageOf([iteration('message', 2, 50), iteration('advisor_message', 30000, 1000, FABLE), iteration('message', 2, 60)])
    const found = consultsFromTranscript([row('msg_G', T0, result('srv_G1', REDACTED), usage), row('msg_G', T0, result('srv_G2', REDACTED), usage)].join('\n'))

    expect(found.map(one => one.input)).toEqual([undefined, undefined])
  })

  test('an unpriced advisor model leaves usd null', async () => {
    const usage = usageOf([iteration('advisor_message', 10, 10, 'some-future-model')])
    const [consult] = consultsFromTranscript(row('msg_H', T0, result('srv_H', REDACTED), usage))

    expect(consult?.model).toBe('some-future-model')
    expect(consult?.usd).toBeNull()
  })
})

describe('advisor api and stream readers', () => {
  test('the api form gives each consult its result kind', async () => {
    const found = consultsFromApi([
      { content: [{ text: 'FIXTURE', type: 'text' }], role: 'user' },
      {
        content: [
          { signature: 'FIXTURE', thinking: '', type: 'thinking' },
          use('srv_A'),
          result('srv_A', REDACTED),
          { id: 'srv_W', input: {}, name: 'web_search', type: 'server_tool_use' },
          use('srv_B'),
          result('srv_B', PLAIN),
          use('srv_C'),
          result('srv_C', FAILED),
          use('srv_D'),
        ],
        role: 'assistant',
      },
    ])

    expect(found).toEqual([
      { id: 'srv_A', isRedacted: true, source: 'api' },
      { advice: 'Check the parser first.\nThen the mapper.', adviceHead: 'Check the parser first.', id: 'srv_B', isRedacted: false, source: 'api' },
      { error: 'execution_time_exceeded', id: 'srv_C', source: 'api' },
      { id: 'srv_D', source: 'api' },
    ])
  })

  test('the step result gives start and end; a call cut short has no end', async () => {
    const found = consultsFromStep({
      serverToolUses: [
        { endedAt: 1080, id: 'srv_A', name: 'advisor', startedAt: 1000 },
        { endedAt: 1500, id: 'srv_W', name: 'web_search', startedAt: 1400 },
        { id: 'srv_G', name: 'advisor', startedAt: 2000 },
      ],
      turnId: 'turn-1',
    })

    expect(found).toEqual([
      { at: 1000, endedAt: 1080, id: 'srv_A', source: 'stream', turnId: 'turn-1' },
      { at: 2000, id: 'srv_G', source: 'stream', turnId: 'turn-1' },
    ])
    expect(consultsFromStep({ turnId: 'turn-1' })).toEqual([])
  })
})

describe('advisor merge and cost', () => {
  const readers = () => ({
    api: consultsFromApi([{ content: [use('srv_A'), result('srv_A', REDACTED)], role: 'assistant' }]),
    step: consultsFromStep({ serverToolUses: [{ endedAt: T0_MS + 80000, id: 'srv_A', name: 'advisor', startedAt: T0_MS }], turnId: 'turn-1' }),
    transcript: consultsFromTranscript(redactedTranscript()),
  })

  test('the three readers merge into one consult by id, in any order, and a second merge changes nothing', async () => {
    const { api, step, transcript } = readers()
    const forward = mergeConsults(mergeConsults(mergeConsults([], step, 5).consults, api, 6).consults, transcript, 7).consults
    const backward = mergeConsults(mergeConsults(mergeConsults([], transcript, 5).consults, api, 6).consults, step, 7).consults

    expect(forward).toHaveLength(1)
    expect(forward[0]).toEqual({ ...backward[0], source: 'stream' })
    expect(forward[0]).toMatchObject({
      at: T0_MS,
      endedAt: T0_MS + 80000,
      id: 'srv_A',
      input: 100000,
      isRedacted: true,
      model: FABLE,
      ms: 80000,
      output: 4000,
      turnId: 'turn-1',
    })

    const again = mergeConsults(forward, [...step, ...api, ...transcript], 9)

    expect(again.consults).toEqual(forward)
    expect(again.advised).toHaveLength(0)
  })

  test('a read without a field never erases it, and a read without a start keeps the known one', async () => {
    const known = mergeConsults([], consultsFromStep({ serverToolUses: [{ id: 'srv_A', name: 'advisor', startedAt: 100 }], turnId: 't' }), 1).consults
    const merged = mergeConsults(known, [{ id: 'srv_A', isRedacted: true, source: 'api' }], 500).consults

    expect(merged[0]).toEqual({ at: 100, id: 'srv_A', isRedacted: true, source: 'stream', turnId: 't' })
  })

  test('a consult first seen at its result row starts there, with no duration, until the stream measures the start', async () => {
    const usage = usageOf([iteration('message', 2, 50), iteration('advisor_message', 20000, 1000, FABLE)])
    const ended = T0_MS + 80000
    const first = mergeConsults([], consultsFromTranscript(row('msg_R', '2026-01-01T00:01:20.000Z', result('srv_A', REDACTED), usage)), ended + 60000).consults

    expect(first[0]?.at).toBe(ended)
    expect(first[0]?.ms).toBeUndefined()

    const step = consultsFromStep({ serverToolUses: [{ endedAt: ended, id: 'srv_A', name: 'advisor', startedAt: T0_MS }], turnId: 't' })

    expect(mergeConsults(first, step, ended + 70000).consults[0]).toMatchObject({ at: T0_MS, endedAt: ended, ms: 80000 })
  })

  test('consults stay in start order when an older one is filled in', async () => {
    const step = consultsFromStep({
      serverToolUses: [
        { endedAt: 200, id: 'srv_1', name: 'advisor', startedAt: 100 },
        { endedAt: 400, id: 'srv_2', name: 'advisor', startedAt: 300 },
      ],
      turnId: 't',
    })
    const filled = mergeConsults(mergeConsults([], step, 1).consults, [{ id: 'srv_1', isRedacted: true, source: 'api' }], 2).consults

    expect(filled.map(one => one.id)).toEqual(['srv_1', 'srv_2'])
  })

  test('advisor steps put a Fable row in the per-model table and dedupe on their key', async () => {
    const { api, step, transcript } = readers()
    const consults = mergeConsults([], [...step, ...api, ...transcript], 1).consults
    const steps = advisorSteps(consults)

    expect(steps).toEqual([
      {
        cacheRead: 0,
        cacheWrite: 0,
        index: 0,
        input: 100000,
        isFailed: false,
        key: 'advisor-srv_A',
        model: FABLE,
        ms: 80000,
        output: 4000,
        startedAt: T0_MS,
        turnId: 'turn-1',
        usd: costOf(FABLE, { cacheRead: 0, cacheWrite: 0, input: 100000, output: 4000 }),
      },
    ])

    const list = [...steps, ...advisorSteps(consults)].reduce<DeckStep[]>((all, one) => recordStep(all, one), [])
    const fable = byModel(list).find(row => row.model === FABLE)

    expect(list).toHaveLength(1)
    expect(fable?.totals.requests).toBe(1)
    expect(fable?.totals.usd).toBe(1.2)
  })

  test('a consult without tokens makes no step; one without a turn counts by model but in no turn', async () => {
    const steps = advisorSteps([
      { at: 1, id: 'srv_X', isRedacted: true },
      { at: 2, id: 'srv_Y', input: 10, model: FABLE, output: 5, usd: null },
    ])

    expect(steps.map(one => [one.key, one.turnId])).toEqual([['advisor-srv_Y', '']])
    expect(byModel(steps)[0]?.totals.isPartial).toBe(true)

    const runs = executions(steps, [{ startedAt: 0, text: 'hi', turnId: 't1' }], [], 10)

    expect(runs[0]?.totals.requests).toBe(0)
  })
})
