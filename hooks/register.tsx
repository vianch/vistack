import { atom, read, update } from 'claude-code'

import { needsReply } from './lib/board'
import { isLive, nickname } from './lib/crew'
import { DEFAULT_ROSTER, decisionContext, frontmatterModel, mayApply, parseDecision } from './lib/jev'
import { launchPlan, lazygitMarker, pickLauncher } from './lib/launch'
import {
  addUp,
  editDelta,
  finishTool,
  makeStep,
  mergeEdit,
  patchAgent,
  patchTurn,
  recordStep,
  recordTurn,
  startTool,
  toolDetail,
} from './lib/ledger'
import { isInRealm, normalizeRealm, normalizeRemote } from './lib/realm'
import { pairs, search } from './lib/recall'
import { gitdirOf, headBranch, lastLedgerRow, parsePrs, parseRun } from './lib/workflow'
import { agentsTab } from './tabs/agents'
import { boardTab } from './tabs/board'
import { changesTab } from './tabs/changes'
import { costTab } from './tabs/cost'
import { recallTab } from './tabs/recall'
import { sessionTab } from './tabs/session'
import { timelineTab } from './tabs/timeline'
import { workflowTab } from './tabs/workflow'

import type { EngineInterface, Register, RenderElement, Timer } from 'claude-code'
import type { Decision, Roster } from './lib/jev'
import type { Launcher } from './lib/launch'
import type { Kit } from './tabs/parts'
import type {
  DeckAgent,
  DeckEdit,
  DeckLazygit,
  DeckPick,
  DeckPrs,
  DeckRun,
  DeckSkill,
  DeckStep,
  DeckTab,
  DeckTodo,
  DeckTool,
  DeckTurn,
  DeckUsage,
  DeckWorkflow,
  DeckWorktree,
} from '../types'

type Dollar = EngineInterface

// Work the hooks hand to the session's timer, so a hook never waits on a slow process.
type Job =
  | { kind: 'usage'; isForced: boolean }
  | { kind: 'workflow' }
  | { kind: 'prs' }
  | { kind: 'agents' }
  | { kind: 'script' }
  | { kind: 'lazygit-check' }
  | { kind: 'lazygit-toggle' }
  | { kind: 'decide-turn'; turnId: string; text: string; at: number }
  | { kind: 'decide-agent'; agentId: string; request: string; subject: string; model: string; at: number }
  | { kind: 'settle'; pickId: string; result: string; usd: number | null }

type Settings = {
  realm: string
  jevMode: string
  isAutoOpen: boolean
  launcher: Launcher
  vistackRoot: string
}

const PANE = 'vistack-deck'
const COMMAND = 'deck'
const PANE_COLUMNS = 64

const TABS: readonly { id: DeckTab; label: string; hotkey: string }[] = [
  { hotkey: '1', id: 'board', label: 'Board' },
  { hotkey: '2', id: 'agents', label: 'Agents' },
  { hotkey: '3', id: 'cost', label: 'Cost' },
  { hotkey: '4', id: 'session', label: 'Session' },
  { hotkey: '5', id: 'changes', label: 'Changes' },
  { hotkey: '6', id: 'timeline', label: 'Timeline' },
  { hotkey: '7', id: 'workflow', label: 'Flow' },
  { hotkey: '8', id: 'recall', label: 'Recall' },
]

const LAUNCHERS: readonly Launcher[] = ['auto', 'tmux', 'ghostty', 'iterm', 'terminal']

// The deck's state, held by the host for the session. The plugin name is written here and in
// types/index.d.ts only.
const tab = atom({ plugin: 'vistack', key: 'tab' } as const, 'board' as DeckTab)
const steps = atom({ plugin: 'vistack', key: 'steps' } as const, [] as DeckStep[])
const tools = atom({ plugin: 'vistack', key: 'tools' } as const, [] as DeckTool[])
const edits = atom({ plugin: 'vistack', key: 'edits' } as const, [] as DeckEdit[])
const turns = atom({ plugin: 'vistack', key: 'turns' } as const, [] as DeckTurn[])
const agents = atom({ plugin: 'vistack', key: 'agents' } as const, [] as DeckAgent[])
const picks = atom({ plugin: 'vistack', key: 'picks' } as const, [] as DeckPick[])
const skills = atom({ plugin: 'vistack', key: 'skills' } as const, [] as DeckSkill[])
const todos = atom({ plugin: 'vistack', key: 'todos' } as const, [] as DeckTodo[])
const prs = atom({ plugin: 'vistack', key: 'prs' } as const, {
  state: 'off',
  items: [],
  checkedAt: 0,
} as DeckPrs)
const workflow = atom({ plugin: 'vistack', key: 'workflow' } as const, null as DeckWorkflow | null)
const usage = atom({ plugin: 'vistack', key: 'usage' } as const, null as DeckUsage | null)
const lazygit = atom({ plugin: 'vistack', key: 'lazygit' } as const, { isOpen: false } as DeckLazygit)
const frame = atom({ plugin: 'vistack', key: 'frame' } as const, 0)
const query = atom({ plugin: 'vistack', key: 'query' } as const, '')
const openId = atom({ plugin: 'vistack', key: 'openId' } as const, '')

// Module state: rebuilt by register and session.start on every load.
let settings: Settings = { isAutoOpen: true, jevMode: 'suggest', launcher: 'auto', realm: '', vistackRoot: '' }
let cwd = ''
let home: string | undefined
let remote: string | null = null
let script: string | null = null
let roster: Roster = DEFAULT_ROSTER
let currentTurnId: string | undefined
let lastUsageAt = 0
let isDraining = false
let timers: Timer[] = []
let jobs: Job[] = []

const optionText = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)

const field = (input: unknown, name: string): unknown =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[name] : undefined

const enqueue = (job: Job): void => {
  jobs.push(job)
}

const isGitAllowed = (): boolean => settings.realm !== '' && isInRealm(remote, settings.realm)

const exists = async ($: Dollar, path: string): Promise<boolean> => {
  try {
    await $.fs.stat(path)

    return true
  } catch {
    return false
  }
}

const readText = async ($: Dollar, path: string): Promise<string | null> => {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

const listDir = async ($: Dollar, path: string) => {
  try {
    return await $.fs.list(path)
  } catch {
    return []
  }
}

const refreshUsage = async ($: Dollar, isForced: boolean): Promise<void> => {
  const at = await $.clock.now()

  if (!isForced && at - lastUsageAt < 2000) {
    return
  }
  lastUsageAt = at

  const figures = await $.session.usage()

  await update($, usage, () => ({
    at,
    limits: figures.rateLimits.map(limit => ({
      kind: limit.kind,
      percent: limit.percentUsed,
      ...(limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }),
    })),
    startedAt: figures.startedAt,
    window: figures.context.window,
    ...(figures.context.percent === undefined ? {} : { contextPercent: figures.context.percent }),
    ...(figures.context.tokens === undefined ? {} : { contextTokens: figures.context.tokens }),
    ...(figures.cost === undefined ? {} : { usd: figures.cost.usd }),
  }))
}

const refreshPrs = async ($: Dollar): Promise<void> => {
  const at = await $.clock.now()

  if (settings.realm === '') {
    await update($, prs, () => ({ checkedAt: at, items: [], state: 'off' as const }))

    return
  }
  if (!isInRealm(remote, settings.realm)) {
    const origin = remote === null ? 'no origin' : (normalizeRemote(remote) ?? remote)

    await update($, prs, () => ({
      checkedAt: at,
      items: [],
      reason: `${origin} is outside ${normalizeRealm(settings.realm)}`,
      state: 'out-of-realm' as const,
    }))

    return
  }
  await update($, prs, current => ({ ...current, state: 'loading' as const }))
  try {
    const ran = await $.process.run(
      [
        'gh',
        'pr',
        'list',
        '--author',
        '@me',
        '--state',
        'open',
        '--limit',
        '20',
        '--json',
        'number,title,url,headRefName,isDraft,reviewDecision,statusCheckRollup',
      ],
      { cwd, timeoutMs: 20_000 },
    )
    const items = parsePrs(ran.stdout)
    const reason = ran.stderr.trim().split('\n')[0] ?? 'gh failed'

    await update($, prs, () =>
      ran.exitCode === 0
        ? { checkedAt: at, items, state: 'ok' as const }
        : { checkedAt: at, items: [], reason, state: 'error' as const },
    )
  } catch (error) {
    await update($, prs, () => ({ checkedAt: at, items: [], reason: String(error), state: 'error' as const }))
  }
}

// The branch a checkout is on, read from its HEAD file: no git process runs.
const branchOf = async ($: Dollar, dir: string): Promise<string | undefined> => {
  const dotGit = `${dir}/.git`
  const pointer = await readText($, dotGit)
  const gitdir = pointer === null ? dotGit : gitdirOf(pointer)

  if (gitdir === undefined) {
    return undefined
  }

  const head = await readText($, `${gitdir.startsWith('/') ? gitdir : `${dir}/${gitdir}`}/HEAD`)

  return head === null ? undefined : headBranch(head)
}

const refreshWorkflow = async ($: Dollar): Promise<void> => {
  const at = await $.clock.now()
  const repo = await $.session.repo().catch(() => null)

  remote = repo?.remote ?? null

  const repoRoot = repo?.root ?? cwd
  const runs: DeckRun[] = []

  for (const stateRoot of [`${cwd}/.claude/state`, `${cwd}/.codex/vistack/state`]) {
    const entries = await listDir($, stateRoot)

    for (const entry of entries.filter(one => one.kind === 'file' && one.name.endsWith('.json'))) {
      const slug = entry.name.replace(/\.json$/, '')
      const source = await readText($, `${stateRoot}/${entry.name}`)
      const run = source === null ? null : parseRun(slug, stateRoot, source)

      if (run === null || (run.slices.length === 0 && run.playbook === undefined)) {
        continue
      }

      const ledger = await readText($, `${stateRoot}/${slug}.tsv`)
      const last = ledger === null ? undefined : lastLedgerRow(ledger)

      runs.push(last === undefined ? run : { ...run, lastLedger: last })
    }
  }

  const worktrees: DeckWorktree[] = []

  for (const treeRoot of [`${cwd}/.claude/worktrees`, `${cwd}/.codex/vistack/worktrees`]) {
    for (const entry of (await listDir($, treeRoot)).filter(one => one.kind === 'dir')) {
      const path = `${treeRoot}/${entry.name}`
      const branch = await branchOf($, path)

      worktrees.push({ name: entry.name, path, ...(branch === undefined ? {} : { branch }) })
    }
  }

  const branch = await branchOf($, repoRoot)

  await update($, workflow, () => ({
    checkedAt: at,
    cwd,
    isInRealm: isGitAllowed(),
    repoRoot,
    runs,
    worktrees,
    ...(branch === undefined ? {} : { branch }),
    ...(remote === null ? {} : { remote }),
  }))
}

const loadDecisionScript = async ($: Dollar): Promise<void> => {
  const roots = [
    settings.vistackRoot,
    $.plugin.root,
    home === undefined ? '' : `${home}/.claude/plugins/marketplaces/vistack`,
  ]

  for (const root of roots.filter(one => one !== '')) {
    const path = `${root}/scripts/vistack-decision.py`

    if (await exists($, path)) {
      script = path

      const mechanical = frontmatterModel((await readText($, `${root}/agents/implementer.md`)) ?? '')
      const complex = frontmatterModel((await readText($, `${root}/agents/senior-implementer.md`)) ?? '')

      roster = { complex: complex ?? DEFAULT_ROSTER.complex, mechanical: mechanical ?? DEFAULT_ROSTER.mechanical }

      return
    }
  }
  script = null
}

// The fork layer's history and switch file live in the consuming repo when it uses viStack.
const decisionFlags = async ($: Dollar): Promise<string[]> => {
  const stateDir = `${cwd}/.claude/vistack`

  if (!(await exists($, stateDir))) {
    return ['--no-history']
  }

  const config = `${stateDir}/decisions.json`

  return ['--history', `${stateDir}/decision-history.jsonl`, ...((await exists($, config)) ? ['--config', config] : [])]
}

const decide = async ($: Dollar, request: string, source: string): Promise<Decision | null> => {
  if (script === null || request.trim() === '') {
    return null
  }
  try {
    const ran = await $.process.run(
      ['python3', script, 'decision', 'tier-selection', '--backend', 'auto', ...(await decisionFlags($))],
      { cwd, stdin: decisionContext(request, source), timeoutMs: 20_000 },
    )

    return ran.exitCode === 0 ? parseDecision(ran.stdout) : null
  } catch {
    return null
  }
}

const recordOutcome = async ($: Dollar, pick: DeckPick): Promise<void> => {
  if (script === null || pick.decisionId === undefined || !(await exists($, `${cwd}/.claude/vistack`))) {
    return
  }

  const evidence = `actual=${pick.actual ?? '?'} recommended=${pick.recommended} usd=${(pick.usd ?? 0).toFixed(4)}`

  await $.process
    .run(
      [
        'python3',
        script,
        'outcome',
        pick.decisionId,
        pick.result ?? 'unknown',
        '--evidence',
        evidence,
        '--history',
        `${cwd}/.claude/vistack/decision-history.jsonl`,
      ],
      { cwd, timeoutMs: 10_000 },
    )
    .catch(() => undefined)
}

const addPick = async ($: Dollar, pick: DeckPick): Promise<void> => {
  await update($, picks, list => [...list.filter(one => one.id !== pick.id), pick].slice(-80))
}

const decideTurn = async ($: Dollar, turnId: string, text: string, at: number): Promise<void> => {
  const decision = await decide($, text, 'main-turn')

  if (decision === null) {
    return
  }

  const firstStep = (await read($, steps)).find(step => step.agentId === undefined && step.turnId === turnId)

  await addPick($, {
    at,
    backend: decision.backend,
    confidence: decision.confidence,
    id: `turn-${turnId}`,
    isApplied: false,
    recommended: roster[decision.tier],
    scope: 'main',
    subject: text,
    tier: decision.tier,
    turnId,
    ...(decision.decisionId === undefined ? {} : { decisionId: decision.decisionId }),
    ...(firstStep === undefined ? {} : { actual: firstStep.model }),
  })
}

const agentPick = (
  decision: Decision,
  input: { agentId: string; subject: string; model: string; at: number },
  isApplied: boolean,
): DeckPick => ({
  actual: input.model,
  agentId: input.agentId,
  at: input.at,
  backend: decision.backend,
  confidence: decision.confidence,
  id: `agent-${input.agentId}`,
  isApplied,
  recommended: roster[decision.tier],
  scope: 'agent',
  subject: input.subject,
  tier: decision.tier,
  ...(decision.decisionId === undefined ? {} : { decisionId: decision.decisionId }),
})

const decideAgent = async ($: Dollar, job: Extract<Job, { kind: 'decide-agent' }>): Promise<void> => {
  const decision = await decide($, job.request, 'agent-spawn')

  if (decision !== null) {
    await addPick($, agentPick(decision, job, false))
  }
}

const settlePick = async ($: Dollar, pickId: string, result: string, cost: number | null): Promise<void> => {
  const found = (await read($, picks)).find(pick => pick.id === pickId)

  if (found === undefined) {
    return
  }

  const settled = { ...found, result, usd: cost }

  await addPick($, settled)
  await recordOutcome($, settled)
}

const syncAgents = async ($: Dollar): Promise<void> => {
  const known = await read($, agents)

  if (!known.some(agent => isLive(agent.status) || agent.status === 'waiting')) {
    return
  }

  const listed = await $.agent.list()
  const at = await $.clock.now()

  await update($, agents, list => {
    let next = list

    for (const info of listed) {
      const found = next.find(agent => agent.agentId === info.id)

      if (found === undefined) {
        const added: DeckAgent = {
          agentId: info.id,
          description: info.description,
          model: '',
          nickname: nickname(info.type, info.id, next.map(agent => agent.nickname)),
          startedAt: at,
          status: info.status,
          toolUseId: '',
          type: info.type,
        }

        next = [...next, added]
      } else if (found.status !== info.status) {
        next = patchAgent(next, info.id, {
          status: info.status,
          ...(isLive(info.status) || info.status === 'waiting' ? {} : { endedAt: found.endedAt ?? at }),
        })
      }
    }

    return next.slice(-60)
  })
}

const checkLazygit = async ($: Dollar): Promise<void> => {
  const state = await read($, lazygit)

  if (!state.isOpen) {
    return
  }

  const ran = await $.process.run(['pgrep', '-f', lazygitMarker(cwd)], { timeoutMs: 5000 }).catch(() => null)

  if (ran !== null && ran.exitCode === 1) {
    await update($, lazygit, () => ({ isOpen: false }))
  }
}

const toggleLazygit = async ($: Dollar): Promise<void> => {
  if (!isGitAllowed()) {
    $.ui.toast(
      settings.realm === '' ? 'Set the realm option to use lazygit here.' : 'lazygit is off: origin is outside the realm.',
    )

    return
  }

  const state = await read($, lazygit)
  const picked = pickLauncher(settings.launcher, {
    termProgram: (await $.env.get('TERM_PROGRAM')) ?? '',
    tmux: (await $.env.get('TMUX')) ?? '',
  })
  const how = LAUNCHERS.find(one => one !== 'auto' && one === state.how) ?? picked
  const plan = launchPlan(how === 'auto' ? picked : how, cwd)

  try {
    if (state.isOpen) {
      await $.process.run(plan.close(state.handle ?? ''), { timeoutMs: 5000 })
      await update($, lazygit, () => ({ isOpen: false }))

      return
    }

    const ran = await $.process.run(plan.open, { cwd, timeoutMs: 10_000 })

    await update($, lazygit, () =>
      ran.exitCode === 0
        ? { handle: ran.stdout.trim(), how: plan.how, isOpen: true }
        : { error: ran.stderr.trim() || `${plan.how} exited ${ran.exitCode}`, isOpen: false },
    )
  } catch (error) {
    await update($, lazygit, () => ({ error: String(error), isOpen: false }))
  }
}

const runJob = async ($: Dollar, job: Job): Promise<void> => {
  switch (job.kind) {
    case 'usage':
      return refreshUsage($, job.isForced)
    case 'workflow':
      return refreshWorkflow($)
    case 'prs':
      return refreshPrs($)
    case 'agents':
      return syncAgents($)
    case 'script':
      return loadDecisionScript($)
    case 'lazygit-check':
      return checkLazygit($)
    case 'lazygit-toggle':
      return toggleLazygit($)
    case 'decide-turn':
      return decideTurn($, job.turnId, job.text, job.at)
    case 'decide-agent':
      return decideAgent($, job)
    case 'settle':
      return settlePick($, job.pickId, job.result, job.usd)
  }
}

const drain = async ($: Dollar): Promise<void> => {
  if (isDraining) {
    return
  }
  isDraining = true
  try {
    while (jobs.length > 0) {
      const job = jobs.shift()

      if (job !== undefined) {
        await runJob($, job).catch((error: unknown) => $.ui.log(`vistack-deck ${job.kind}: ${String(error)}`, { to: 'debug' }))
      }
    }
  } finally {
    isDraining = false
  }
}

const tick = async ($: Dollar): Promise<void> => {
  const list = await read($, agents)

  if (list.some(agent => agent.status === 'running')) {
    await update($, frame, value => (value + 1) % 1000)
  }
}

const openPane = ($: Dollar) => $.ui.open({ columns: PANE_COLUMNS, id: PANE, title: 'viStack' })

const renderTab = async ($: Dollar, kit: Kit, active: DeckTab, columns: number, at: number): Promise<RenderElement> => {
  switch (active) {
    case 'board': {
      const toolList = await read($, tools)
      const turnList = await read($, turns)
      const agentList = await read($, agents)

      return boardTab(
        kit,
        {
          agents: agentList,
          now: at,
          openId: await read($, openId),
          prs: await read($, prs),
          replies: needsReply(toolList, turnList, agentList),
          steps: await read($, steps),
          todos: await read($, todos),
          tools: toolList,
          turns: turnList,
          workflow: await read($, workflow),
        },
        {
          refreshPrs: () => enqueue({ kind: 'prs' }),
          toggle: id => void update($, openId, current => (current === id ? '' : id)),
        },
        columns,
      )
    }
    case 'agents':
      return agentsTab(
        kit,
        {
          agents: await read($, agents),
          frame: await read($, frame),
          now: at,
          picks: await read($, picks),
          skills: await read($, skills),
          steps: await read($, steps),
        },
        columns,
      )
    case 'cost':
      return costTab(
        kit,
        {
          agents: await read($, agents),
          now: at,
          picks: await read($, picks),
          steps: await read($, steps),
          tools: await read($, tools),
          turns: await read($, turns),
          usage: await read($, usage),
        },
        columns,
      )
    case 'session':
      return sessionTab(
        kit,
        {
          agents: await read($, agents),
          now: at,
          steps: await read($, steps),
          tools: await read($, tools),
          usage: await read($, usage),
        },
        columns,
      )
    case 'changes':
      return changesTab(
        kit,
        { edits: await read($, edits), home, isGitAllowed: isGitAllowed(), lazygit: await read($, lazygit), now: at },
        { toggleLazygit: () => enqueue({ kind: 'lazygit-toggle' }) },
        columns,
      )
    case 'timeline':
      return timelineTab(
        kit,
        { now: at, steps: await read($, steps), tools: await read($, tools), turns: await read($, turns) },
        columns,
      )
    case 'workflow':
      return workflowTab(
        kit,
        { now: at, workflow: await read($, workflow) },
        { refresh: () => enqueue({ kind: 'workflow' }) },
        columns,
      )
    case 'recall': {
      const list = pairs(await $.session.messages())
      const wanted = await read($, query)

      return recallTab(
        kit,
        { hits: search(list, wanted), openId: await read($, openId), query: wanted, total: list.length },
        {
          open: id => void update($, openId, () => id),
          search: value => {
            void update($, query, () => value)
            void update($, openId, () => '')
          },
        },
        columns,
      )
    }
  }
}

export const register: Register = (on, options) => {
  const launcherOption = optionText(options.lazygitLauncher, 'auto')

  settings = {
    isAutoOpen: options.autoOpen !== false,
    jevMode: optionText(options.jevMode, 'suggest'),
    launcher: LAUNCHERS.find(one => one === launcherOption) ?? 'auto',
    realm: optionText(options.realm, '').trim(),
    vistackRoot: optionText(options.vistackRoot, '').trim(),
  }
  jobs = []

  on('session.start', async ($, e, next) => {
    const started = await next(e)

    cwd = e.cwd
    home = await $.env.get('HOME')
    timers.forEach(timer => timer.cancel())
    timers = [
      $.clock.every(250, () => void drain($)),
      $.clock.every(300, () => void tick($)),
      $.clock.every(1500, () => enqueue({ kind: 'agents' })),
      $.clock.every(15_000, () => enqueue({ isForced: true, kind: 'usage' })),
      $.clock.every(20_000, () => enqueue({ kind: 'workflow' })),
      $.clock.every(4000, () => enqueue({ kind: 'lazygit-check' })),
      $.clock.every(300_000, () => enqueue({ kind: 'prs' })),
    ]
    await $.command.register({
      description: 'Open or close the viStack deck: board, agents, cost, session, changes, flow. /deck <tab> jumps to a tab.',
      name: COMMAND,
    })
    enqueue({ kind: 'script' })
    enqueue({ kind: 'workflow' })
    enqueue({ kind: 'prs' })
    enqueue({ isForced: true, kind: 'usage' })
    if (settings.isAutoOpen && e.isInteractive) {
      void openPane($)
    }

    return started
  })

  on('session.end', async ($, e, next) => {
    timers.forEach(timer => timer.cancel())
    timers = []

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    const match = TABS.find(one => one.id === wanted || one.label.toLowerCase() === wanted || one.hotkey === wanted)
    const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)

    if (isUp && match === undefined) {
      await $.ui.close({ id: PANE })

      return { text: 'viStack deck closed.' }
    }
    if (match !== undefined) {
      await update($, tab, () => match.id)
    }
    enqueue({ isForced: true, kind: 'usage' })
    enqueue({ kind: 'workflow' })

    const opened = await openPane($)

    if (!opened.isPlaced) {
      return { text: `viStack deck waits for room: ${opened.reason}` }
    }

    return { text: `viStack deck open${match === undefined ? '' : ` on ${match.label}`}. Keys 1-8 switch tabs.` }
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    const at = await $.clock.now()

    currentTurnId = e.turnId
    await update($, turns, list => recordTurn(list, { startedAt: at, text: e.text, turnId: e.turnId }))
    await update($, openId, () => '')
    if (settings.jevMode !== 'off' && e.text.trim() !== '') {
      enqueue({ at, kind: 'decide-turn', text: e.text, turnId: e.turnId })
    }

    return started
  })

  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    const endedAt = await $.clock.now()
    const step = makeStep({
      endedAt,
      hasStop: result.stopReason !== null,
      index: e.index,
      model: e.model,
      startedAt,
      turnId: e.turnId,
      usage: result.usage,
      ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
    })

    await update($, steps, list => recordStep(list, step))
    await update($, picks, list =>
      list.map(pick =>
        pick.actual === undefined &&
        ((pick.scope === 'main' && step.agentId === undefined && pick.turnId === step.turnId) ||
          (pick.scope === 'agent' && pick.agentId === step.agentId))
          ? { ...pick, actual: step.model }
          : pick,
      ),
    )
    enqueue({ isForced: false, kind: 'usage' })

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const at = await $.clock.now()
    const stepList = await read($, steps)

    if (e.agentId === undefined) {
      const cost = addUp(stepList.filter(step => step.agentId === undefined && step.turnId === e.turnId))

      await update($, turns, list =>
        patchTurn(list, e.turnId, { answer: e.answer.slice(-4000), durationMs: e.durationMs, reason: e.reason }),
      )
      currentTurnId = undefined
      enqueue({ kind: 'settle', pickId: `turn-${e.turnId}`, result: e.reason, usd: cost.isPartial ? null : cost.usd })
    } else {
      const agentId = e.agentId
      const cost = addUp(stepList.filter(step => step.agentId === agentId))
      const status = e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'killed' : 'failed'

      await update($, agents, list => patchAgent(list, agentId, { answer: e.answer.slice(-2000), endedAt: at, status }))
      enqueue({ kind: 'settle', pickId: `agent-${agentId}`, result: e.reason, usd: cost.isPartial ? null : cost.usd })
    }
    enqueue({ isForced: true, kind: 'usage' })

    return done
  })

  on('agent.spawn', async ($, e, next) => {
    const request = `${e.description}\n\n${e.prompt}`
    const decision = mayApply(settings.jevMode, e.subagentType, e.model) ? await decide($, request, 'agent-spawn') : null
    const started = await next(decision === null ? e : { ...e, model: roster[decision.tier] })

    if (started.deny !== undefined || started.agentId === undefined) {
      return started
    }

    const agentId = started.agentId
    const at = await $.clock.now()
    const subject = `${e.subagentType}: ${e.description}`

    await update($, agents, list => {
      const agent: DeckAgent = {
        agentId,
        description: e.description,
        model: started.model,
        nickname: nickname(e.subagentType, agentId, list.map(one => one.nickname)),
        startedAt: at,
        status: 'running',
        toolUseId: e.tool_use_id,
        type: e.subagentType,
      }

      return [...list.filter(one => one.agentId !== agentId), agent].slice(-60)
    })
    if (decision !== null) {
      await addPick($, agentPick(decision, { agentId, at, model: started.model, subject }, true))
    } else if (settings.jevMode !== 'off') {
      enqueue({ agentId, at, kind: 'decide-agent', model: started.model, request, subject })
    }

    return started
  })

  on('skill.prompt', async ($, e, next) => {
    const at = await $.clock.now()

    await update($, skills, list => [...list, { at, skill: e.skill }].slice(-60))

    return next(e)
  })

  on('classic.TaskCreated', async ($, e, next) => {
    await update($, todos, list => [
      ...list.filter(todo => todo.id !== e.task_id),
      { content: e.task_subject, id: e.task_id, status: 'pending' },
    ])

    return next(e)
  })

  on('classic.TaskCompleted', async ($, e, next) => {
    await update($, todos, list => list.map(todo => (todo.id === e.task_id ? { ...todo, status: 'completed' } : todo)))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const id = e.tool_use_id
    const startedAt = await $.clock.now()
    const delta = editDelta(tool, e)
    const isNew = delta !== null && tool === 'Write' ? !(await exists($, delta.path)) : false
    const turnId = e.agentId === undefined ? currentTurnId : undefined

    await update($, tools, list =>
      startTool(list, {
        detail: toolDetail(tool, e),
        id,
        startedAt,
        status: 'running',
        tool,
        ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
        ...(turnId === undefined ? {} : { turnId }),
      }),
    )

    const ran = await next(e)
    const endedAt = await $.clock.now()
    const isError = ran.deny !== undefined || ran.isError === true

    await update($, tools, list => finishTool(list, id, endedAt, isError))
    if (isError) {
      return ran
    }
    if (delta !== null) {
      await update($, edits, list => mergeEdit(list, delta, endedAt, isNew))
      enqueue({ kind: 'workflow' })
    }
    if (tool === 'TodoWrite') {
      const list = field(e, 'todos')

      if (Array.isArray(list)) {
        await update($, todos, current => [
          ...current.filter(todo => !todo.id.startsWith('todo-')),
          ...list.map((todo, index) => ({
            content: String(field(todo, 'content') ?? ''),
            id: `todo-${index}`,
            status: String(field(todo, 'status') ?? 'pending'),
          })),
        ])
      }
    }
    if (tool === 'TaskUpdate') {
      const taskId = String(field(e, 'taskId') ?? '')
      const status = field(e, 'status')

      if (typeof status === 'string') {
        await update($, todos, current =>
          status === 'deleted'
            ? current.filter(todo => todo.id !== taskId)
            : current.map(todo => (todo.id === taskId ? { ...todo, status } : todo)),
        )
      }
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)

      return <Text>Open the deck in the terminal or the desktop app.</Text>
    }

    const kit: Kit = $.ui.resolve(e)
    const { Box, Button, Text } = kit
    const columns = Math.max(24, e.props.bodyColumns - 1)
    const active = await read($, tab)
    const at = await $.clock.now()
    const body = await renderTab($, kit, active, columns, at)

    return (
      <Box flexDirection="column" width={columns}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {TABS.map(one => (
            <Button
              key={`tab-${one.id}`}
              hotkey={one.hotkey}
              label={one.label}
              {...(one.id === active ? { variant: 'primary' as const } : { plain: true as const })}
              onPress={() => update($, tab, () => one.id)}
            />
          ))}
        </Box>
        <Text dimColor>{'─'.repeat(columns)}</Text>
        {body}
      </Box>
    )
  })
}
