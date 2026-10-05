import { describe, expect, test } from 'claude-code/testing'

import { needsReply } from '../hooks/lib/board'
import { face, nickname } from '../hooks/lib/crew'
import { frontmatterModel, mayApply, parseDecision } from '../hooks/lib/jev'
import { launchPlan, lazygitMarker, pickLauncher } from '../hooks/lib/launch'
import { addUp, byModel, editDelta, lineDelta, makeStep, mergeEdit, recordStep, timeline } from '../hooks/lib/ledger'
import { costOf, modelLabel } from '../hooks/lib/pricing'
import { isInRealm, normalizeRemote } from '../hooks/lib/realm'
import { pairs, search } from '../hooks/lib/recall'
import { checksSummary, headBranch, lastLedgerRow, parseRun } from '../hooks/lib/workflow'

const usage = (input: number, output: number, read = 0, write = 0) => ({
  cache_creation_input_tokens: write,
  cache_read_input_tokens: read,
  input_tokens: input,
  model: 'claude-opus-5-5',
  output_tokens: output,
})

const cents = (amount: number | null): number | null => (amount === null ? null : Math.round(amount * 100))

describe('pricing', () => {
  test('prices each token kind at its own rate', async () => {
    // 1M in at $4, 1M out at $20, 1M cache read at $0.20, 1M cache write at $5.
    expect(cents(costOf('claude-opus-5-5', { cacheRead: 1e6, cacheWrite: 1e6, input: 1e6, output: 1e6 }))).toBe(2920)
    expect(cents(costOf('sonnet', { cacheRead: 0, cacheWrite: 0, input: 1e6, output: 0 }))).toBe(200)
    expect(costOf('some-other-model', { cacheRead: 0, cacheWrite: 0, input: 1, output: 1 })).toBeNull()
  })

  test('labels ids, aliases and suffixed ids', async () => {
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(modelLabel('haiku')).toBe('Haiku 4.5')
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5')
  })
})

describe('ledger', () => {
  test('a step recorded twice under one key counts once', async () => {
    const step = makeStep({ endedAt: 900, hasStop: true, index: 0, model: 'x', startedAt: 100, turnId: 't1', usage: usage(10, 5) })
    const twice = recordStep(recordStep([], step), { ...step, output: 6 })

    expect(twice).toHaveLength(1)
    expect(twice[0]?.output).toBe(6)
    expect(addUp(twice).requests).toBe(1)
  })

  test('main and subagent steps of one index stay apart', async () => {
    const main = makeStep({ endedAt: 2, hasStop: true, index: 0, model: 'x', startedAt: 1, turnId: 't1', usage: usage(1, 1) })
    const sub = makeStep({ agentId: 'a1', endedAt: 2, hasStop: true, index: 0, model: 'x', startedAt: 1, turnId: 't1', usage: usage(1, 1) })

    expect(recordStep(recordStep([], main), sub)).toHaveLength(2)
  })

  test('a request with no response is a failed step', async () => {
    const step = makeStep({ endedAt: 5, hasStop: false, index: 1, model: 'claude-opus-5-5', startedAt: 1, turnId: 't', usage: null })

    expect(step.isFailed).toBe(true)
    expect(step.usd).toBe(0)
  })

  test('rolls requests up per model, priciest first', async () => {
    const opus = makeStep({ endedAt: 1, hasStop: true, index: 0, model: 'm', startedAt: 0, turnId: 't', usage: usage(1e6, 0) })
    const haiku = makeStep({
      endedAt: 1,
      hasStop: true,
      index: 1,
      model: 'm',
      startedAt: 0,
      turnId: 't',
      usage: { ...usage(1e6, 0), model: 'claude-haiku-4-5' },
    })
    const rows = byModel([haiku, opus])

    expect(rows.map(row => row.model)).toEqual(['claude-opus-5-5', 'claude-haiku-4-5'])
  })

  test('counts lines changed after the common head and tail', async () => {
    expect(lineDelta('a\nb\nc', 'a\nB\nB2\nc')).toEqual({ added: 2, removed: 1 })
    expect(editDelta('Write', { content: 'x\ny', file_path: '/r/a.ts' })).toEqual({ added: 2, path: '/r/a.ts', removed: 0 })
    expect(editDelta('Read', { file_path: '/r/a.ts' })).toBeNull()
  })

  test('folds edits of one file into one row, newest first', async () => {
    const first = mergeEdit([], { added: 3, path: '/a', removed: 1 }, 10, true)
    const second = mergeEdit(mergeEdit(first, { added: 1, path: '/b', removed: 0 }, 20, false), { added: 2, path: '/a', removed: 2 }, 30, false)

    expect(second.map(edit => edit.path)).toEqual(['/a', '/b'])
    expect(second[0]).toEqual({ added: 5, count: 2, isNew: true, lastAt: 30, path: '/a', removed: 3 })
  })

  test('splits a turn into model, tool and idle time', async () => {
    const turn = { durationMs: 1000, startedAt: 0, text: 'go', turnId: 't' }
    const step = { ...makeStep({ endedAt: 600, hasStop: true, index: 0, model: 'm', startedAt: 0, turnId: 't', usage: usage(1, 1) }) }
    const view = timeline(turn, [step], [{ detail: 'ls', id: 'u1', ms: 300, startedAt: 650, status: 'ok', tool: 'Bash', turnId: 't' }], 1000)

    expect(view.modelMs).toBe(600)
    expect(view.toolMs).toBe(300)
    expect(view.idleMs).toBe(100)
    expect(view.byTool).toEqual([{ ms: 300, tool: 'Bash' }])
  })
})

describe('realm', () => {
  test('reads every remote spelling', async () => {
    expect(normalizeRemote('git@github.com:Acme/app.git')).toBe('github.com/Acme/app')
    expect(normalizeRemote('https://github.com/Acme/app')).toBe('github.com/Acme/app')
    expect(normalizeRemote('ssh://git@github.com/Acme/app.git')).toBe('github.com/Acme/app')
  })

  test('admits only the configured owner, and nothing when unset', async () => {
    expect(isInRealm('git@github.com:Acme/app.git', 'github.com/Acme')).toBe(true)
    expect(isInRealm('git@github.com:AcmeEvil/app.git', 'github.com/Acme')).toBe(false)
    expect(isInRealm('git@github.com:someone/app.git', 'github.com/Acme/*')).toBe(false)
    expect(isInRealm('git@github.com:Acme/app.git', '')).toBe(false)
    expect(isInRealm(null, 'github.com/Acme')).toBe(false)
  })
})

describe('recall', () => {
  const rows = [
    { role: 'user', text: 'how do I rotate the token' },
    { role: 'assistant', text: 'Run the rotate script.' },
    { role: 'user', text: 'and the cache?' },
    { role: 'assistant', text: 'Clear it with the flush command.' },
  ]

  test('pairs each ask with the answer after it', async () => {
    expect(pairs(rows).map(pair => [pair.ask, pair.answer])).toEqual([
      ['how do I rotate the token', 'Run the rotate script.'],
      ['and the cache?', 'Clear it with the flush command.'],
    ])
  })

  test('needs every term, phrases kept whole', async () => {
    expect(search(pairs(rows), 'flush').map(hit => hit.ask)).toEqual(['and the cache?'])
    expect(search(pairs(rows), '"rotate script"').map(hit => hit.ask)).toEqual(['how do I rotate the token'])
    expect(search(pairs(rows), 'rotate flush')).toHaveLength(0)
  })
})

describe('jev', () => {
  test('reads a tier decision and the agent file model', async () => {
    const decision = parseDecision('{"action":"mechanical","backend":"deterministic","confidence":0.8,"decision_id":"dec_1","outputs":{"tier":"mechanical"}}')

    expect(decision).toEqual({ backend: 'deterministic', confidence: 0.8, decisionId: 'dec_1', rationale: '', tier: 'mechanical' })
    expect(parseDecision('not json')).toBeNull()
    expect(frontmatterModel('---\nname: implementer\nmodel: sonnet\n---\nbody')).toBe('sonnet')
  })

  test('applies only to built-in types that named no model', async () => {
    expect(mayApply('apply', 'Explore', undefined)).toBe(true)
    expect(mayApply('apply', 'vistack:implementer', undefined)).toBe(false)
    expect(mayApply('apply', 'Explore', 'haiku')).toBe(false)
    expect(mayApply('suggest', 'Explore', undefined)).toBe(false)
  })
})

describe('crew', () => {
  test('names stay unique and faces keep their width', async () => {
    const first = nickname('Explore', 'a1', [])

    expect(nickname('Explore', 'a1', [first])).not.toBe(first)

    const widths = [0, 1, 2, 3].map(tickCount => face('vistack:implementer', 'running', tickCount).length)

    expect(new Set(widths).size).toBe(1)
    expect(face('x', 'failed', 0)).toContain('x_x')
  })
})

describe('board', () => {
  test('a pending question and a trailing question both need a reply', async () => {
    const asking = needsReply(
      [{ detail: 'Which db?', id: 'q1', startedAt: 1, status: 'running', tool: 'AskUserQuestion' }],
      [],
      [],
    )

    expect(asking.map(reply => reply.kind)).toEqual(['question'])

    const asked = needsReply([], [{ answer: 'Done. Should I also update the docs?', durationMs: 5, startedAt: 1, text: 'x', turnId: 't' }], [])

    expect(asked[0]?.text).toBe('Should I also update the docs?')
  })
})

describe('workflow and launch', () => {
  test('reads a coordinate state file and the ledger tail', async () => {
    const run = parseRun(
      'demo',
      '/r/.claude/state',
      JSON.stringify({ playbook: 'feature', slices: { api: { blockers: [{}], phase: 'blocked' }, ui: { phase: 'pr-open', pr: 12 } } }),
    )

    expect(run?.slices.map(slice => [slice.id, slice.phase, slice.blockers])).toEqual([
      ['api', 'blocked', 1],
      ['ui', 'pr-open', 0],
    ])
    expect(lastLedgerRow('2026-10-05T10:11:00Z\timplement\tui\tdispatch\twhy\tev\tok\n')).toBe('10:11 · implement · ui · dispatch · ok')
    expect(headBranch('ref: refs/heads/feature/x\n')).toBe('feature/x')
    expect(checksSummary([{ conclusion: 'FAILURE', name: 'lint' }, { conclusion: 'SUCCESS' }])).toEqual({ checks: 'failing', failing: ['lint'] })
  })

  test('picks tmux inside tmux and closes only this lazygit', async () => {
    expect(pickLauncher('auto', { termProgram: 'ghostty', tmux: '/tmp/tmux-1/default' })).toBe('tmux')
    expect(pickLauncher('auto', { termProgram: 'ghostty' })).toBe('ghostty')

    const plan = launchPlan('ghostty', '/Users/me/my.repo')

    expect(plan.open).toContain('lazygit')
    expect(plan.close('')).toEqual(['pkill', '-f', 'lazygit -p /Users/me/my\\.repo$'])
    expect(new RegExp(lazygitMarker('/a/repo')).test('lazygit -p /a/repo-2')).toBe(false)
    expect(new RegExp(lazygitMarker('/a/repo')).test('lazygit -p /a/repo')).toBe(true)
  })
})
