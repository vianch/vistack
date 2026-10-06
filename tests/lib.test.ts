import { describe, expect, test } from 'claude-code/testing'

import { needsReply } from '../hooks/lib/board'
import { face, nickname, roleOf } from '../hooks/lib/crew'
import { fit } from '../hooks/lib/format'
import { frontmatterModel, mayApply, parseDecision } from '../hooks/lib/jev'
import { launchPlan, lazygitMarker, pickLauncher } from '../hooks/lib/launch'
import { addUp, byModel, editDelta, lineDelta, makeStep, mergeEdit, recordStep, timeline } from '../hooks/lib/ledger'
import {
  alumni,
  bars,
  codeWrites,
  consultsFrom,
  coordinatorStatus,
  histogram,
  mergeConsults,
  nextGeneration,
  orgTree,
  partyOf,
  recordComm,
  reviewPostOf,
  sparkline,
  stacked,
} from '../hooks/lib/org'
import { costOf, modelLabel } from '../hooks/lib/pricing'
import { effectiveRealm, isInRealm, normalizeRemote, realmParts } from '../hooks/lib/realm'
import { pairs, search } from '../hooks/lib/recall'
import { DEFAULT_SETTINGS, cells, clip, readSettings } from '../hooks/lib/theme'
import { checksSummary, headBranch, isPrChange, lastLedgerRow, parsePrSearch, parseRun, prSearchArgs } from '../hooks/lib/workflow'

import type { DeckAgent, DeckTool } from '../types'

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

  test('the realm set in the deck wins over the plugin option', async () => {
    expect(effectiveRealm('github.com/Acme/', 'github.com/Other')).toEqual({ realm: 'github.com/acme', source: 'deck' })
    expect(effectiveRealm('  ', 'github.com/Other')).toEqual({ realm: 'github.com/other', source: 'plugin option' })
    expect(effectiveRealm('', '')).toEqual({ realm: '', source: 'unset' })
    expect(realmParts('https://ghe.acme.io/Platform')).toEqual({ host: 'ghe.acme.io', owner: 'platform' })
    expect(realmParts('github.com')).toBeNull()
    expect(realmParts('github.com/acme/app')).toBeNull()
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

  test('the advisor role wins over the other patterns and keeps its face width', async () => {
    expect(roleOf('vistack:advisor')).toBe('advisor')
    expect(['The Oracle', 'Sage', 'Athena', 'Wise Owl', 'Mentor']).toContain(nickname('vistack:advisor', 'a9', []))

    const widths = [0, 1, 2, 3].map(tickCount => face('vistack:advisor', 'running', tickCount).length)

    expect(new Set(widths).size).toBe(1)
    expect(widths[0]).toBe(face('Explore', 'running', 0).length)
  })

  test('devops agents work in Operations, not Engineering', async () => {
    expect(roleOf('vistack:devops')).toBe('helper')
  })
})

describe('theme', () => {
  test('counts terminal cells: ASCII 1, emoji 2, a ZWJ family 2, a VS16 symbol 2', async () => {
    expect(cells('abc')).toBe(3)
    expect(cells('🦉')).toBe(2)
    expect(cells('\u{1F468}\u200D\u{1F469}\u200D\u{1F467}')).toBe(2)
    expect(cells('\u2709\uFE0F')).toBe(2)
    expect(cells('\u2709')).toBe(1)
  })

  test('clip and fit never exceed the width', async () => {
    const text = '📦 vistack 🌿 main 🧠 Opus 5.5 ✉️ hi'

    for (const width of [0, 1, 2, 3, 5, 8, 13, 21]) {
      expect(cells(clip(text, width)) <= width).toBe(true)
      expect(cells(fit(text, width)) <= width).toBe(true)
    }
    expect(fit('🦉🦉🦉', 4)).toBe('🦉…')
  })

  test('settings read back fall back to the defaults', async () => {
    expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(readSettings({ icons: 'klingon', placement: 'left', theme: 'nope' })).toEqual(DEFAULT_SETTINGS)
    expect(readSettings({ icons: 'ascii', isAnimated: false, placement: 'bottom', realm: ' github.com/acme ', theme: 'nord' })).toEqual({
      icons: 'ascii',
      isAnimated: false,
      placement: 'bottom',
      realm: 'github.com/acme',
      theme: 'nord',
    })
    expect(readSettings({ realm: 42 }).realm).toBe('')
  })
})

const agent = (agentId: string, type: string, extra: Partial<DeckAgent> = {}): DeckAgent => ({
  agentId,
  description: `${type} job`,
  model: 'x',
  nickname: `${type}-${agentId}`,
  startedAt: 1,
  status: 'running',
  toolUseId: `use-${agentId}`,
  type,
  ...extra,
})

const tool = (id: string, name: string, extra: Partial<DeckTool> = {}): DeckTool => ({
  detail: '',
  id,
  startedAt: 5,
  status: 'running',
  tool: name,
  ...extra,
})

describe('org', () => {
  test('groups staff by department, nests spawned agents, and keeps alumni apart', async () => {
    const org = orgTree([
      agent('a1', 'Explore'),
      agent('a2', 'vistack:implementer'),
      agent('a3', 'Explore', { parentId: 'a2' }),
      agent('a4', 'vistack:advisor'),
      agent('a5', 'Explore', { leftAt: 9, leftHow: 'fired' }),
      agent('a6', 'general-purpose', { parentId: 'gone' }),
    ])
    const members = (id: string) => org.departments.find(one => one.id === id)?.members ?? []

    expect(members('scout').map(node => node.agent.agentId)).toEqual(['a1'])
    expect(members('builder').map(node => node.agent.agentId)).toEqual(['a2'])
    expect(members('builder')[0]?.children.map(node => node.agent.agentId)).toEqual(['a3'])
    expect(org.departments.find(one => one.id === 'builder')?.count).toBe(2)
    expect(members('helper').map(node => node.agent.agentId)).toEqual(['a6'])
    expect(org.advisors.map(node => node.agent.agentId)).toEqual(['a4'])
    expect(org.departments.map(one => one.label)).toEqual([
      'Research',
      'Library',
      'Architecture',
      'Engineering',
      'QA & Review',
      'Program',
      'Operations',
    ])
    expect(alumni([agent('a5', 'Explore', { leftAt: 9 }), agent('a1', 'Explore')]).map(one => one.agentId)).toEqual(['a5'])
  })

  test('a parent loop still draws every agent once', async () => {
    const org = orgTree([agent('a1', 'Explore', { parentId: 'a2' }), agent('a2', 'Explore', { parentId: 'a1' })])
    const scouts = org.departments.find(one => one.id === 'scout')

    expect(scouts?.count).toBe(2)
  })

  test('a reload takes the seat to the next generation', async () => {
    const first = agent('a1', 'Explore', { nickname: 'Sherlock' })
    const second = agent('a2', 'Explore', { generation: 2, nickname: 'Sherlock v2' })

    expect(nextGeneration([first], first)).toBe(2)
    expect(nextGeneration([first, second], second)).toBe(3)
  })

  test('reads what the coordinator is doing', async () => {
    const base = { activity: {}, agents: [], tools: [], turns: [] }
    const running = [{ startedAt: 1, text: 'go', turnId: 't1' }]

    expect(coordinatorStatus(base).state).toBe('idle')
    expect(coordinatorStatus({ ...base, turns: running }).state).toBe('thinking')
    expect(
      coordinatorStatus({ ...base, activity: { main: { detail: '', kind: 'writing', since: 2 } }, turns: running }).state,
    ).toBe('writing')
    expect(coordinatorStatus({ ...base, tools: [tool('u1', 'Bash', { detail: 'npm test' })], turns: running })).toEqual({
      label: 'Bash npm test',
      since: 5,
      state: 'tool',
    })
    expect(coordinatorStatus({ ...base, tools: [tool('u2', 'Agent')], turns: running }).state).toBe('delegating')
    expect(coordinatorStatus({ ...base, tools: [tool('u3', 'AskUserQuestion'), tool('u4', 'Bash')] }).state).toBe('waiting-you')
    expect(coordinatorStatus({ ...base, tools: [tool('u5', 'Bash', { agentId: 'a1' })] }).state).toBe('idle')
    expect(coordinatorStatus({ ...base, agents: [agent('a1', 'Explore'), agent('a2', 'Explore')] }).label).toBe('waiting on 2 agents')
  })

  test('flags main-loop code edits and leaves run records and subagent edits alone', async () => {
    const writes = codeWrites([
      tool('u1', 'Edit', { detail: '/repo/src/app.ts', status: 'ok' }),
      tool('u2', 'Write', { detail: '/repo/.claude/state/run.json', status: 'ok' }),
      tool('u3', 'Edit', { agentId: 'a1', detail: '/repo/src/b.ts', status: 'ok' }),
      tool('u4', 'Read', { detail: '/repo/src/app.ts', status: 'ok' }),
    ])

    expect(writes.map(one => one.id)).toEqual(['u1'])
  })

  test('keeps comms capped and resolves addresses', async () => {
    let list = recordComm([], { at: 1, from: 'user', id: 'c0', kind: 'prompt', text: 'go', to: 'coordinator' })

    for (let index = 1; index <= 100; index += 1) {
      list = recordComm(list, { at: index, from: 'coordinator', id: `c${index}`, kind: 'answer', text: 'ok', to: 'user' })
    }
    expect(list).toHaveLength(80)
    expect(list[list.length - 1]?.id).toBe('c100')
    expect(partyOf('sherlock', [agent('a1', 'Explore', { nickname: 'Sherlock' })])).toBe('a1')
    expect(partyOf('team-lead', [])).toBe('team-lead')
  })

  test('reads advisor consults from the transcript and merges their advice once', async () => {
    const found = consultsFrom([
      { role: 'user', toolUses: [] },
      {
        role: 'assistant',
        toolUses: [
          { tool: 'advisor', tool_use_id: 'v1', text: 'Write the test first.' },
          { tool: 'Bash', tool_use_id: 'b1', text: 'ok' },
          { tool: 'Advisor', tool_use_id: 'v2' },
        ],
      },
    ])

    expect(found).toEqual([{ advice: 'Write the test first.', id: 'v1' }, { id: 'v2' }])

    const first = mergeConsults([{ at: 3, id: 'v1' }], found, 10)

    expect(first.advised.map(one => one.id)).toEqual(['v1'])
    expect(first.consults.find(one => one.id === 'v1')?.at).toBe(3)
    expect(first.consults.find(one => one.id === 'v2')?.at).toBe(10)
    expect(mergeConsults(first.consults, found, 20).advised).toHaveLength(0)
  })

  test('recognises a review or review comment posted on a PR', async () => {
    expect(reviewPostOf('gh api repos/acme/app/pulls/12/reviews -X POST --input review.json')).toEqual({ number: 12, repo: 'acme/app' })
    expect(reviewPostOf('gh api repos/acme/app/pulls/12/comments -f body=hi -f path=a.ts')).toEqual({ number: 12, repo: 'acme/app' })
    expect(reviewPostOf('gh api repos/acme/app/pulls/12/comments/345/replies -f body=done')).toEqual({ number: 12, repo: 'acme/app' })
    expect(reviewPostOf('gh api repos/acme/app/pulls/12/comments')).toBeNull()
    expect(reviewPostOf('gh api -X GET repos/acme/app/pulls/12/reviews -f per_page=100')).toBeNull()
    expect(reviewPostOf('gh api repos/{owner}/{repo}/pulls/3/reviews -f event=COMMENT')).toEqual({ number: 3, repo: '' })
    expect(reviewPostOf('gh pr review 12 --repo acme/app --approve')).toEqual({ number: 12, repo: 'acme/app' })
    expect(reviewPostOf('gh pr comment https://github.com/acme/app/pull/9 --body "fix 2 things"')).toEqual({ number: 9, repo: 'acme/app' })
    expect(reviewPostOf('gh pr comment --body "see 4 notes"')).toEqual({ number: null, repo: '' })
    expect(reviewPostOf('gh pr comment 5 --delete-last')).toBeNull()
    expect(reviewPostOf('node ~/.claude/x/skills/review-pr/scripts/post-review.mjs --repo acme/app --pr 44')).toEqual({ number: 44, repo: 'acme/app' })
    expect(reviewPostOf('node skills/review-pr/scripts/post-review.mjs acme/app#44 --dry-run')).toBeNull()
    expect(reviewPostOf('gh pr view 12')).toBeNull()
  })

  test('charts keep their sizes', async () => {
    expect(sparkline([0, 1, 2, 4, 8], 3)).toBe('▃▅█')
    expect(sparkline([], 5)).toBe('')
    expect(sparkline([0, 0], 2)).toBe('▁▁')
    expect(histogram([], 100, 30, 10)).toHaveLength(30)
    expect(histogram([95, 99, 100, 5, 85], 100, 3, 10)).toEqual([0, 1, 3])
    expect(bars([{ value: 10 }, { value: 1 }, { value: 0 }], 10).map(row => row.full.length + row.empty.length)).toEqual([10, 10, 10])
    expect(bars([{ value: 10 }, { value: 1 }], 10).map(row => row.full.length)).toEqual([10, 1])
    expect(stacked([3, 1, 0, 2], 10).reduce((sum, size) => sum + size, 0)).toBe(10)
    expect(stacked([0, 0], 10)).toEqual([0, 0])
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

  test('searches the realm owner for open PRs with one GraphQL call', async () => {
    const args = prSearchArgs({ host: 'github.com', owner: 'acme' }, 'user')

    expect(args.slice(0, 3)).toEqual(['gh', 'api', 'graphql'])
    expect(args).not.toContain('--hostname')
    expect(args[args.length - 1]).toBe('q=is:pr is:open author:@me user:acme archived:false')
    expect(prSearchArgs({ host: 'ghe.acme.io', owner: 'acme' }, 'org')).toContain('--hostname')
    expect(prSearchArgs({ host: 'ghe.acme.io', owner: 'acme' }, 'org').at(-1)).toContain('org:acme')
  })

  test('reads PRs, their repository and their checks from the search answer', async () => {
    const answer = JSON.stringify({
      data: {
        search: {
          nodes: [
            {
              commits: {
                nodes: [
                  {
                    commit: {
                      statusCheckRollup: {
                        contexts: {
                          nodes: [
                            { __typename: 'CheckRun', conclusion: 'FAILURE', name: 'lint', status: 'COMPLETED' },
                            { __typename: 'CheckRun', conclusion: null, name: 'test', status: 'IN_PROGRESS' },
                            { __typename: 'StatusContext', context: 'deploy', state: 'SUCCESS' },
                          ],
                        },
                        state: 'FAILURE',
                      },
                    },
                  },
                ],
              },
              headRefName: 'feat/x',
              isDraft: true,
              number: 12,
              repository: { nameWithOwner: 'acme/app' },
              reviewDecision: null,
              title: 'Add x',
              url: 'https://github.com/acme/app/pull/12',
            },
            {
              commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'StatusContext', context: 'ci', state: 'PENDING' }] } } } }] },
              headRefName: 'fix/y',
              isDraft: false,
              number: 7,
              repository: { nameWithOwner: 'acme/api' },
              reviewDecision: 'APPROVED',
              title: 'Fix y',
              url: 'https://github.com/acme/api/pull/7',
            },
            {},
          ],
        },
      },
    })
    const prs = parsePrSearch(answer)

    expect(prs).toHaveLength(2)
    expect(prs[0]).toEqual({
      branch: 'feat/x',
      checks: 'failing',
      failing: ['lint'],
      isDraft: true,
      number: 12,
      repo: 'acme/app',
      review: 'NONE',
      title: 'Add x',
      url: 'https://github.com/acme/app/pull/12',
    })
    expect(prs[1]?.checks).toBe('pending')
    expect(prs[1]?.review).toBe('APPROVED')
    expect(parsePrSearch('{"errors":[{"message":"bad"}]}')).toEqual([])
    expect(parsePrSearch('not json')).toEqual([])
  })

  test('knows which commands change PRs', async () => {
    expect(isPrChange('gh pr create --draft --title x')).toBe(true)
    expect(isPrChange('cd repo && gh pr merge 12 --squash')).toBe(true)
    expect(isPrChange('gh api repos/acme/app/pulls/12/requested_reviewers -f team=x')).toBe(true)
    expect(isPrChange('gh pr list')).toBe(false)
    expect(isPrChange('git push')).toBe(false)
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
