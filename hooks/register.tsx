import { atom, read, update } from 'claude-code'

import { needsReply } from './lib/board'
import { isLive, nickname } from './lib/crew'
import { basename, duration, usd } from './lib/format'
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
import {
  ADVISOR_TOOL,
  CONSULT_CAP,
  consultsFrom,
  isOnStaff,
  isWorking,
  mergeConsults,
  nextGeneration,
  partyOf,
  recordComm,
  reviewPostOf,
  seatName,
} from './lib/org'
import { modelLabel } from './lib/pricing'
import { effectiveRealm, isInRealm, normalizeRemote, realmParts } from './lib/realm'
import { pairs, search } from './lib/recall'
import { DEFAULT_SETTINGS, iconsOf, paletteOf, readSettings } from './lib/theme'
import { gitdirOf, headBranch, isPrChange, lastLedgerRow, parsePrSearch, parseRun, prSearchArgs } from './lib/workflow'
import { agentsTab } from './tabs/agents'
import { boardTab } from './tabs/board'
import { changesTab } from './tabs/changes'
import { costTab } from './tabs/cost'
import { Header } from './tabs/parts'
import { recallTab } from './tabs/recall'
import { sessionTab } from './tabs/session'
import { settingsTab } from './tabs/settings'
import { timelineTab } from './tabs/timeline'
import { workflowTab } from './tabs/workflow'

import type { AgentSpawnResult, EngineInterface, Register, RenderElement, Timer, TurnStepChunk, TurnStepResult } from 'claude-code'
import type { Decision, Roster } from './lib/jev'
import type { Launcher } from './lib/launch'
import type { ReviewPost } from './lib/org'
import type { RealmSource } from './lib/realm'
import type { IconName } from './lib/theme'
import type { AgentAction } from './tabs/agents'
import type { Kit, KitElements } from './tabs/parts'
import type {
  DeckActivity,
  DeckAdvisor,
  DeckAgent,
  DeckComm,
  DeckEdit,
  DeckLazygit,
  DeckPick,
  DeckPlacement,
  DeckPrs,
  DeckRun,
  DeckSettings,
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
  | { kind: 'about' }
  | { kind: 'model' }
  | { kind: 'advisor-scan' }
  | { kind: 'lazygit-check' }
  | { kind: 'lazygit-toggle' }
  | { kind: 'decide-turn'; turnId: string; text: string; at: number }
  | { kind: 'decide-agent'; agentId: string; request: string; subject: string; model: string; at: number }
  | { kind: 'settle'; pickId: string; result: string; usd: number | null }
  | { kind: 'kill'; agentId: string }
  | { kind: 'fire'; agentId: string }
  | { kind: 'hire'; agentId: string; isReload: boolean }
  | { kind: 'ask-agent'; agentId: string; text: string }
  | { kind: 'draft'; text: string }
  | { kind: 'stop-turn' }

// The plugin's options from pluginConfigs.
type Config = {
  realm: string
  jevMode: string
  isAutoOpen: boolean
  launcher: Launcher
  vistackRoot: string
}

const PLUGIN = 'vistack'
const PANE = 'vistack-deck'
const COMMAND = 'deck'
const PANE_COLUMNS = 64
const STORE_KEY = 'deckSettings'
// Kept apart from the look settings so Reset leaves it alone.
const REALM_KEY = 'deckRealm'
const PR_POLL_MS = 60_000
const LIVE_TICK_MS = 300
const IDLE_TICK_MS = 5000
const PROMPT_CAP = 8000
const COMM_TEXT_CAP = 200
const AGENT_CAP = 60

const TABS: readonly { id: DeckTab; label: string; hotkey: string; icon: IconName }[] = [
  { hotkey: '1', icon: 'tab-board', id: 'board', label: 'Board' },
  { hotkey: '2', icon: 'tab-agents', id: 'agents', label: 'Agents' },
  { hotkey: '3', icon: 'tab-cost', id: 'cost', label: 'Cost' },
  { hotkey: '4', icon: 'tab-session', id: 'session', label: 'Session' },
  { hotkey: '5', icon: 'tab-changes', id: 'changes', label: 'Changes' },
  { hotkey: '6', icon: 'tab-timeline', id: 'timeline', label: 'Timeline' },
  { hotkey: '7', icon: 'tab-workflow', id: 'workflow', label: 'Flow' },
  { hotkey: '8', icon: 'tab-recall', id: 'recall', label: 'Recall' },
  { hotkey: '9', icon: 'tab-settings', id: 'settings', label: 'Settings' },
]

const LAUNCHERS: readonly Launcher[] = ['auto', 'tmux', 'ghostty', 'iterm', 'terminal']

// Kill, fire, reload and stop take a second press of the same key.
const CONFIRMED: readonly AgentAction[] = ['kill', 'fire', 'reload', 'stop']

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
const deckSettings = atom({ plugin: 'vistack', key: 'settings' } as const, DEFAULT_SETTINGS as DeckSettings)
const activity = atom({ plugin: 'vistack', key: 'activity' } as const, {} as Record<string, DeckActivity>)
const comms = atom({ plugin: 'vistack', key: 'comms' } as const, [] as DeckComm[])
const advisor = atom({ plugin: 'vistack', key: 'advisor' } as const, { consults: [], isAdvising: false } as DeckAdvisor)
const selected = atom({ plugin: 'vistack', key: 'selected' } as const, '')
const confirm = atom({ plugin: 'vistack', key: 'confirm' } as const, '')
const asking = atom({ plugin: 'vistack', key: 'asking' } as const, '')
const isBandOpen = atom({ plugin: 'vistack', key: 'isBandOpen' } as const, false)
const model = atom({ plugin: 'vistack', key: 'model' } as const, '')

// Module state: rebuilt by register and session.start on every load.
let config: Config = { isAutoOpen: true, jevMode: 'suggest', launcher: 'auto', realm: '', vistackRoot: '' }
let cwd = ''
let home: string | undefined
let remote: string | null = null
let script: string | null = null
let roster: Roster = DEFAULT_ROSTER
let currentTurnId: string | undefined
let lastUsageAt = 0
let lastSlowTick = 0
let commCount = 0
let sessionId = ''
let deckVersion = ''
let deckRealm = ''
let isDraining = false
let timers: Timer[] = []
let jobs: Job[] = []

const optionText = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)

const field = (input: unknown, name: string): unknown =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[name] : undefined

const enqueue = (job: Job): void => {
  jobs.push(job)
}

const realmNow = (): { realm: string; source: RealmSource } => effectiveRealm(deckRealm, config.realm)

const isGitAllowed = (): boolean => {
  const { realm } = realmNow()

  return realm !== '' && isInRealm(remote, realm)
}

const tail = (text: string): string => text.trim().replace(/\s+/g, ' ').slice(-COMM_TEXT_CAP)

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

// The person's open PRs across the realm owner's repositories, whatever the checkout's origin.
const refreshPrs = async ($: Dollar): Promise<void> => {
  const at = await $.clock.now()
  const { realm } = realmNow()
  const parts = realmParts(realm)

  if (parts === null) {
    await update($, prs, () => ({
      checkedAt: at,
      items: [],
      state: 'off' as const,
      ...(realm === '' ? {} : { reason: `${realm} names no owner: use host/owner, e.g. github.com/your-org` }),
    }))

    return
  }
  await update($, prs, current => ({ ...current, state: 'loading' as const }))
  try {
    const search = (qualifier: 'user' | 'org') => $.process.run(prSearchArgs(parts, qualifier), { cwd, timeoutMs: 20_000 })
    const asUser = await search('user')
    // `user:` can refuse an organization; `org:` is tried once before giving up.
    const ran = asUser.exitCode === 0 ? asUser : await search('org')
    const reason = ran.stderr.trim().split('\n')[0] || 'gh failed'

    await update($, prs, () =>
      ran.exitCode === 0
        ? { checkedAt: at, items: parsePrSearch(ran.stdout), state: 'ok' as const }
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
    config.vistackRoot,
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

// The session id and the viStack version the Settings tab shows.
const loadAbout = async ($: Dollar): Promise<void> => {
  sessionId = await $.session.id().catch(() => '')

  const manifest = await readText($, `${$.plugin.root}/.claude-plugin/plugin.json`)

  try {
    const version = field(JSON.parse(manifest ?? '{}'), 'version')

    deckVersion = typeof version === 'string' ? version : ''
  } catch {
    deckVersion = ''
  }
}

const loadModel = async ($: Dollar): Promise<void> => {
  const name = await $.session.model().catch(() => '')

  await update($, model, () => name)
}

// The fork layer's history and switch file live in the consuming repo when it uses viStack.
const decisionFlags = async ($: Dollar): Promise<string[]> => {
  const stateDir = `${cwd}/.claude/vistack`

  if (!(await exists($, stateDir))) {
    return ['--no-history']
  }

  const decisions = `${stateDir}/decisions.json`

  return ['--history', `${stateDir}/decision-history.jsonl`, ...((await exists($, decisions)) ? ['--config', decisions] : [])]
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
          ...(info.parentId === undefined ? {} : { parentId: info.parentId }),
        }

        next = [...next, added]
      } else if (found.status !== info.status) {
        next = patchAgent(next, info.id, {
          status: info.status,
          ...(isLive(info.status) || info.status === 'waiting' ? {} : { endedAt: found.endedAt ?? at }),
        })
      }
    }

    return next.slice(-AGENT_CAP)
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
      realmNow().realm === '' ? 'Set your Git realm in Settings (9) to use lazygit here.' : 'lazygit is off: origin is outside the realm.',
    )

    return
  }

  const state = await read($, lazygit)
  const picked = pickLauncher(config.launcher, {
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

const addComm = async ($: Dollar, comm: Omit<DeckComm, 'id' | 'at'> & { at?: number }): Promise<void> => {
  const at = comm.at ?? (await $.clock.now())

  commCount += 1
  await update($, comms, list => recordComm(list, { ...comm, at, id: `${at}-${commCount}` }))
}

const setActivity = async ($: Dollar, key: string, value: DeckActivity | null): Promise<void> => {
  await update($, activity, map =>
    value === null ? Object.fromEntries(Object.entries(map).filter(([name]) => name !== key)) : { ...map, [key]: value },
  )
}

const startConsult = async ($: Dollar, id: string, at: number, turnId: string | undefined): Promise<void> => {
  await update($, advisor, value => ({
    consults: [...value.consults.filter(consult => consult.id !== id), { at, id, ...(turnId === undefined ? {} : { turnId }) }].slice(
      -CONSULT_CAP,
    ),
    isAdvising: true,
    since: at,
  }))
}

const endConsult = async ($: Dollar, id: string, at: number, advice: string): Promise<void> => {
  const known = (await read($, advisor)).consults.find(consult => consult.id === id)

  await update($, advisor, value => ({
    ...value,
    consults: value.consults.map(consult =>
      consult.id === id
        ? { ...consult, ms: Math.max(0, at - consult.at), ...(advice === '' ? {} : { advice }) }
        : consult,
    ),
    isAdvising: false,
  }))
  if (advice !== '' && known?.advice === undefined) {
    await addComm($, { at, from: 'advisor', kind: 'advice', text: tail(advice), to: 'coordinator' })
  }
}

// Consults read back from the transcript fill in advice the stream could not see.
const scanAdvisor = async ($: Dollar): Promise<void> => {
  const found = consultsFrom(await $.session.messages())

  if (found.length === 0) {
    return
  }

  const at = await $.clock.now()
  const { advised } = mergeConsults((await read($, advisor)).consults, found, at)

  await update($, advisor, value => ({ ...value, consults: mergeConsults(value.consults, found, at).consults }))
  for (const consult of advised) {
    await addComm($, { at, from: 'advisor', kind: 'advice', text: tail(consult.advice ?? ''), to: 'coordinator' })
  }
}

// TaskStop on the agent; the reason it refused, or null once it stopped.
const stopAgent = async ($: Dollar, agentId: string): Promise<string | null> => {
  try {
    const ran = await $.tool.call({ task_id: agentId, tool: 'TaskStop' })

    if (ran.deny !== undefined) {
      return ran.deny
    }

    return ran.isError === true ? (ran.text ?? 'TaskStop failed') : null
  } catch (error) {
    return String(error)
  }
}

const stopFailure = (agent: DeckAgent, reason: string): string =>
  `Could not stop ${agent.nickname}: ${reason}${
    currentTurnId === undefined ? '' : ". If it runs in the foreground, stop the coordinator's turn instead (select it, press x)."
  }`

const findAgent = async ($: Dollar, agentId: string): Promise<DeckAgent | undefined> =>
  (await read($, agents)).find(agent => agent.agentId === agentId)

const killAgent = async ($: Dollar, agentId: string): Promise<void> => {
  const agent = await findAgent($, agentId)

  if (agent === undefined) {
    return
  }

  const reason = await stopAgent($, agentId)

  if (reason !== null) {
    $.ui.toast(stopFailure(agent, reason))

    return
  }
  await addComm($, { from: 'deck', kind: 'action', text: 'stop', to: agentId })
  $.ui.toast(`Stopping ${agent.nickname}.`)
  enqueue({ kind: 'agents' })
}

const fireAgent = async ($: Dollar, agentId: string): Promise<void> => {
  const agent = await findAgent($, agentId)

  if (agent === undefined) {
    return
  }
  if (isWorking(agent)) {
    const reason = await stopAgent($, agentId)

    if (reason !== null) {
      $.ui.toast(stopFailure(agent, reason))

      return
    }
  }

  const at = await $.clock.now()

  await update($, agents, list => patchAgent(list, agentId, { leftAt: at, leftHow: 'fired' }))
  await update($, selected, current => (current === agentId ? '' : current))
  await addComm($, { at, from: 'deck', kind: 'action', text: 'fire', to: agentId })
  $.ui.toast(`${agent.nickname} fired.`)
}

// Hire gives the same job to a new agent beside the old one; reload replaces the old one
// with the seat's next generation.
const rehire = async ($: Dollar, agentId: string, isReload: boolean): Promise<void> => {
  const old = await findAgent($, agentId)
  const verb = isReload ? 'reload' : 'hire for'

  if (old?.prompt === undefined) {
    $.ui.toast(`Cannot ${verb} ${old?.nickname ?? agentId}: its prompt is unknown.`)

    return
  }
  if (isReload && isWorking(old)) {
    const reason = await stopAgent($, agentId)

    if (reason !== null) {
      $.ui.toast(stopFailure(old, reason))

      return
    }
  }

  const started = await $.agent
    .spawn({ description: old.description, prompt: old.prompt, subagentType: old.type })
    .catch((error: unknown): AgentSpawnResult => ({ deny: String(error) }))

  if (started.deny !== undefined || started.agentId === undefined) {
    $.ui.toast(`Could not ${verb} ${old.nickname}: ${started.deny ?? 'no agent started'}`)

    return
  }

  const hiredId = started.agentId
  const at = await $.clock.now()
  const list = await read($, agents)
  const found = list.find(agent => agent.agentId === hiredId)
  const generation = isReload ? nextGeneration(list, old) : 1
  const name = isReload
    ? `${seatName(old.nickname)} v${generation}`
    : (found?.nickname ?? nickname(old.type, hiredId, list.map(agent => agent.nickname)))
  const hired: DeckAgent = {
    ...(found ?? {
      agentId: hiredId,
      description: old.description,
      model: started.model,
      startedAt: at,
      status: 'running',
      toolUseId: '',
      type: old.type,
    }),
    generation,
    hiredFrom: old.agentId,
    nickname: name,
    prompt: old.prompt,
  }

  await update($, agents, current => {
    const kept = isReload ? patchAgent(current, old.agentId, { leftAt: at, leftHow: 'reloaded' }) : current

    return [...kept.filter(agent => agent.agentId !== hiredId), hired].slice(-AGENT_CAP)
  })
  if (isReload) {
    await update($, selected, current => (current === old.agentId ? hiredId : current))
  }
  await addComm($, { at, from: 'deck', kind: 'action', text: `${isReload ? 'reload' : 'hire'} → ${name}`, to: old.agentId })
  $.ui.toast(isReload ? `${old.nickname} reloaded as ${name}.` : `${name} hired to ${old.description || old.type}.`)
}

const askAgent = async ($: Dollar, agentId: string, text: string): Promise<void> => {
  const name = (await findAgent($, agentId))?.nickname ?? agentId

  try {
    const sent = await $.session.send({ text, to: { agentId } })

    $.ui.toast(sent.isDelivered ? `Sent to ${name}.` : `Not delivered to ${name}: ${sent.reason}`)
  } catch (error) {
    $.ui.toast(`Not delivered to ${name}: ${String(error)}`)
  }
}

const draftPrompt = async ($: Dollar, text: string): Promise<void> => {
  try {
    const filled = await $.prompt.fill({ mode: 'replace', text })

    $.ui.toast(filled.isFilled ? 'Draft in your prompt: press Enter to send it.' : 'The prompt box did not take the draft.')
  } catch (error) {
    $.ui.toast(`The prompt box did not take the draft: ${String(error)}`)
  }
}

const stopTurn = async ($: Dollar): Promise<void> => {
  if (currentTurnId === undefined) {
    $.ui.toast('No coordinator turn is running.')

    return
  }
  try {
    await $.turn.abort({ turnId: currentTurnId })
    await addComm($, { from: 'deck', kind: 'action', text: 'stop the turn', to: 'coordinator' })
  } catch (error) {
    $.ui.toast(`Could not stop the turn: ${String(error)}`)
  }
}

const noteReview = async ($: Dollar, post: ReviewPost, from: string): Promise<void> => {
  const origin = remote === null ? null : normalizeRemote(remote)
  const repo = post.repo === '' ? (origin?.split('/').slice(1).join('/') ?? 'this repo') : post.repo
  const target = post.number === null ? `${repo} (current branch PR)` : `${repo}#${post.number}`

  await addComm($, { from, kind: 'action', text: '💬 review posted', to: target })
  $.ui.toast(`💬 review comment posted on ${target}`)
  enqueue({ kind: 'prs' })
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
    case 'about':
      return loadAbout($)
    case 'model':
      return loadModel($)
    case 'advisor-scan':
      return scanAdvisor($)
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
    case 'kill':
      return killAgent($, job.agentId)
    case 'fire':
      return fireAgent($, job.agentId)
    case 'hire':
      return rehire($, job.agentId, job.isReload)
    case 'ask-agent':
      return askAgent($, job.agentId, job.text)
    case 'draft':
      return draftPrompt($, job.text)
    case 'stop-turn':
      return stopTurn($)
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

const openPane = ($: Dollar) => $.ui.open({ columns: PANE_COLUMNS, id: PANE, title: 'viStack' })

const isPaneUp = async ($: Dollar): Promise<boolean> => (await $.ui.panes()).some(pane => pane.id === PANE)

const isDeckVisible = async ($: Dollar, placement: DeckPlacement): Promise<boolean> => {
  if (placement === 'bottom') {
    return read($, isBandOpen)
  }

  return placement === 'right' && isPaneUp($)
}

const pollPrs = async ($: Dollar): Promise<void> => {
  if (await isDeckVisible($, (await read($, deckSettings)).placement)) {
    enqueue({ kind: 'prs' })
  }
}

// Spinners and connectors move every LIVE_TICK_MS while anything works; otherwise the clocks
// on a visible deck move every IDLE_TICK_MS.
const tick = async ($: Dollar): Promise<void> => {
  const at = await $.clock.now()
  const prefs = await read($, deckSettings)
  const isBusy =
    currentTurnId !== undefined ||
    (await read($, advisor)).isAdvising ||
    (await read($, agents)).some(agent => isOnStaff(agent) && agent.status === 'running')

  if (isBusy && prefs.isAnimated) {
    lastSlowTick = at
    await update($, frame, value => (value + 1) % 1000)

    return
  }
  if (at - lastSlowTick < IDLE_TICK_MS) {
    return
  }
  lastSlowTick = at
  if (await isDeckVisible($, prefs.placement)) {
    await update($, frame, value => (value + 1) % 1000)
  }
}

const place = async ($: Dollar, placement: DeckPlacement): Promise<void> => {
  await update($, isBandOpen, () => placement === 'bottom')
  if (placement === 'right') {
    await openPane($)

    return
  }
  if (await isPaneUp($)) {
    await $.ui.close({ id: PANE })
  }
}

const saveSettings = async ($: Dollar, patch: Partial<DeckSettings>): Promise<void> => {
  const before = await read($, deckSettings)
  const next = readSettings({ ...before, ...patch })
  const { realm, ...look } = next
  const logError = (error: unknown) => $.ui.log(`vistack-deck settings: ${String(error)}`, { to: 'debug' })

  await update($, deckSettings, () => next)
  await $.store.set(STORE_KEY, look).catch(logError)
  if (realm !== before.realm) {
    deckRealm = realm
    await $.store.set(REALM_KEY, realm).catch(logError)
    enqueue({ kind: 'prs' })
    enqueue({ kind: 'workflow' })
  }
  if (next.placement !== before.placement) {
    await place($, next.placement).catch((error: unknown) => $.ui.log(`vistack-deck placement: ${String(error)}`, { to: 'debug' }))
  }
}

const resetSettings = async ($: Dollar): Promise<void> => {
  await saveSettings($, { ...DEFAULT_SETTINGS, realm: (await read($, deckSettings)).realm })
}

const switchTab = async ($: Dollar, next: DeckTab): Promise<void> => {
  await update($, confirm, () => '')
  await update($, tab, () => next)
}

const refreshAll = (): void => {
  enqueue({ isForced: true, kind: 'usage' })
  enqueue({ kind: 'workflow' })
  enqueue({ kind: 'agents' })
  enqueue({ kind: 'prs' })
  enqueue({ kind: 'advisor-scan' })
  enqueue({ kind: 'model' })
}

const selectParty = async ($: Dollar, party: string): Promise<void> => {
  await update($, confirm, () => '')
  await update($, asking, () => '')
  await update($, selected, current => (current === party ? '' : party))
}

const jobFor = (action: AgentAction, party: string): Job | null => {
  switch (action) {
    case 'kill':
      return { agentId: party, kind: 'kill' }
    case 'fire':
      return { agentId: party, kind: 'fire' }
    case 'hire':
      return { agentId: party, isReload: false, kind: 'hire' }
    case 'reload':
      return { agentId: party, isReload: true, kind: 'hire' }
    case 'stop':
      return { kind: 'stop-turn' }
    case 'ask':
      return null
  }
}

const actOn = async ($: Dollar, action: AgentAction, party: string): Promise<void> => {
  const wanted = `${action}:${party}`

  if (action === 'ask') {
    await update($, confirm, () => '')
    await update($, asking, current => (current === party ? '' : party))

    return
  }
  if (CONFIRMED.includes(action) && (await read($, confirm)) !== wanted) {
    await update($, confirm, () => wanted)

    return
  }
  await update($, confirm, () => '')

  const job = jobFor(action, party)

  if (job !== null) {
    enqueue(job)
  }
}

const askParty = async ($: Dollar, party: string, text: string): Promise<void> => {
  await update($, asking, () => '')
  if (text.trim() === '') {
    return
  }
  if (party === 'coordinator') {
    enqueue({ kind: 'draft', text })
  } else if (party === 'advisor') {
    enqueue({ kind: 'draft', text: `Consult the advisor: ${text}` })
  } else {
    enqueue({ agentId: party, kind: 'ask-agent', text })
  }
}

const renderTab = async ($: Dollar, kit: Kit, active: DeckTab, columns: number, at: number): Promise<RenderElement> => {
  switch (active) {
    case 'board': {
      const toolList = await read($, tools)
      const turnList = await read($, turns)
      const agentList = await read($, agents)

      return boardTab(
        kit,
        {
          activity: await read($, activity),
          advisor: await read($, advisor),
          agents: agentList,
          comms: await read($, comms),
          now: at,
          openId: await read($, openId),
          prs: await read($, prs),
          replies: needsReply(toolList, turnList, agentList),
          steps: await read($, steps),
          todos: await read($, todos),
          tools: toolList,
          turns: turnList,
          usage: await read($, usage),
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
          activity: await read($, activity),
          advisor: await read($, advisor),
          agents: await read($, agents),
          asking: await read($, asking),
          comms: await read($, comms),
          confirm: await read($, confirm),
          model: await read($, model),
          now: at,
          picks: await read($, picks),
          selected: await read($, selected),
          skills: await read($, skills),
          steps: await read($, steps),
          tools: await read($, tools),
          turns: await read($, turns),
          usage: await read($, usage),
        },
        {
          act: (action, party) => void actOn($, action, party),
          ask: (party, text) => void askParty($, party, text),
          select: party => void selectParty($, party),
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
      const list = pairs(await $.session.messages().catch(() => []))
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
    case 'settings': {
      const flow = await read($, workflow)
      const realm = realmNow()

      return settingsTab(
        kit,
        {
          about: {
            branch: flow?.branch ?? '',
            project: flow?.repoRoot ?? cwd,
            realm: realm.realm,
            realmSource: realm.source,
            remote: flow?.remote ?? '',
            sessionId,
            version: deckVersion,
          },
          settings: await read($, deckSettings),
        },
        {
          reset: () => void resetSettings($),
          set: patch => void saveSettings($, patch),
        },
        columns,
      )
    }
  }
}

// Header, tab bar and the active tab: the same deck in the pane and in the band.
const renderDeck = async ($: Dollar, elements: KitElements, columns: number, isBand: boolean): Promise<RenderElement> => {
  const { Box, Button, Text } = elements
  const prefs = await read($, deckSettings)
  const active = await read($, tab)
  const kit: Kit = {
    ...elements,
    // The Recall tab reads the transcript on every draw, so the animation clock leaves it alone.
    frame: active === 'recall' ? 0 : await read($, frame),
    icon: iconsOf(prefs.icons),
    iconSet: prefs.icons,
    isAnimated: prefs.isAnimated,
    theme: paletteOf(prefs.theme),
  }
  const at = await $.clock.now()
  const flow = await read($, workflow)
  const figures = await read($, usage)
  const modelName = await read($, model)
  const body = await renderTab($, kit, active, columns, at)

  return (
    <Box flexDirection="column" width={columns}>
      {Header(
        kit,
        {
          branch: flow?.branch ?? '-',
          cost: usd(figures?.usd),
          model: modelName === '' ? '-' : modelLabel(modelName),
          project: basename(flow?.repoRoot ?? cwd) || '-',
          uptime: figures === null ? '-' : duration(at - figures.startedAt),
        },
        columns,
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {TABS.map(one => (
          <Button
            key={`tab-${one.id}`}
            // A bare digit in an empty prompt presses a band's digit hotkey, so the band takes none.
            {...(isBand ? {} : { hotkey: one.hotkey })}
            label={`${kit.icon[one.icon]} ${one.label}`}
            {...(one.id === active ? { variant: 'primary' as const } : { plain: true as const })}
            onPress={() => switchTab($, one.id)}
          />
        ))}
        <Button key="refresh" plain hotkey="u" label={`${kit.icon.refresh} refresh`} onPress={() => refreshAll()} />
      </Box>
      <Text color={kit.theme.muted}>{'─'.repeat(columns)}</Text>
      {body}
    </Box>
  )
}

// What one streamed chunk says the loop is doing; null for the chunks that change nothing.
const chunkActivity = (chunk: TurnStepChunk): Pick<DeckActivity, 'kind' | 'detail'> | null => {
  switch (chunk.kind) {
    case 'thinking':
      return { detail: '', kind: 'thinking' }
    case 'text':
      return { detail: '', kind: 'writing' }
    case 'tool':
      return { detail: chunk.name, kind: 'tool' }
    default:
      return null
  }
}

export const register: Register = (on, options) => {
  const launcherOption = optionText(options.lazygitLauncher, 'auto')

  config = {
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
      $.clock.every(LIVE_TICK_MS, () => void tick($)),
      $.clock.every(1500, () => enqueue({ kind: 'agents' })),
      $.clock.every(15_000, () => enqueue({ isForced: true, kind: 'usage' })),
      $.clock.every(20_000, () => enqueue({ kind: 'workflow' })),
      $.clock.every(4000, () => enqueue({ kind: 'lazygit-check' })),
      $.clock.every(PR_POLL_MS, () => void pollPrs($)),
    ]
    await $.command.register({
      description:
        'Open or close the viStack deck: board, org chart, cost, session, changes, flow, recall, settings. /deck <tab> jumps to a tab.',
      name: COMMAND,
    })

    const stored = await $.store.get(STORE_KEY).catch(() => undefined)
    const prefs = readSettings({
      ...(typeof stored === 'object' && stored !== null ? stored : {}),
      realm: await $.store.get(REALM_KEY).catch(() => undefined),
    })

    deckRealm = prefs.realm
    await update($, deckSettings, () => prefs)
    enqueue({ kind: 'script' })
    enqueue({ kind: 'about' })
    enqueue({ kind: 'model' })
    enqueue({ kind: 'workflow' })
    enqueue({ kind: 'prs' })
    enqueue({ isForced: true, kind: 'usage' })
    if (config.isAutoOpen && e.isInteractive) {
      if (prefs.placement === 'right') {
        void openPane($)
      } else if (prefs.placement === 'bottom') {
        await update($, isBandOpen, () => true)
      }
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
    const prefs = await read($, deckSettings)
    const onTab = match === undefined ? '' : ` on ${match.label}`

    if (match !== undefined) {
      await switchTab($, match.id)
    }
    enqueue({ isForced: true, kind: 'usage' })
    enqueue({ kind: 'workflow' })
    if (prefs.placement === 'bottom') {
      const isOpen = match !== undefined || !(await read($, isBandOpen))

      await update($, isBandOpen, () => isOpen)

      return { text: isOpen ? `viStack deck open above the prompt${onTab}. ctrl+x tab focuses it.` : 'viStack deck closed.' }
    }
    if (prefs.placement === 'hidden') {
      await saveSettings($, { placement: 'right' })

      return { text: `viStack deck placed on the right again${onTab}. Keys 1-9 switch tabs.` }
    }
    if (match === undefined && (await isPaneUp($))) {
      await $.ui.close({ id: PANE })

      return { text: 'viStack deck closed.' }
    }

    const opened = await openPane($)

    if (!opened.isPlaced) {
      return { text: `viStack deck waits for room: ${opened.reason}` }
    }

    return { text: `viStack deck open${onTab}. Keys 1-9 switch tabs.` }
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    const at = await $.clock.now()

    currentTurnId = e.turnId
    await update($, turns, list => recordTurn(list, { startedAt: at, text: e.text, turnId: e.turnId }))
    await update($, openId, () => '')
    if (e.text.trim() !== '') {
      await addComm($, { at, from: 'user', kind: 'prompt', text: tail(e.text), to: 'coordinator' })
    }
    enqueue({ kind: 'model' })
    if (config.jevMode !== 'off' && e.text.trim() !== '') {
      enqueue({ at, kind: 'decide-turn', text: e.text, turnId: e.turnId })
    }

    return started
  })

  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const key = e.agentId ?? 'main'
    const stream = next(e)
    let kind: DeckActivity['kind'] | null = null
    let consultId: string | undefined

    let result: TurnStepResult | undefined

    try {
      for (;;) {
        const item = await stream.next()

        if (item.done === true) {
          result = item.value
          break
        }

        const chunk = item.value

        try {
          const seen = chunkActivity(chunk)

          // Written when the kind changes or a new tool call begins, never per text delta.
          if (seen !== null && (seen.kind !== kind || seen.kind === 'tool')) {
            const at = await $.clock.now()

            kind = seen.kind
            await setActivity($, key, { ...seen, since: at })
            if (consultId !== undefined) {
              await endConsult($, consultId, at, '')
              consultId = undefined
            }
            if (chunk.kind === 'tool' && ADVISOR_TOOL.test(chunk.name)) {
              consultId = chunk.id
              await startConsult($, chunk.id, at, e.turnId)
            }
          }
        } catch (error) {
          $.ui.log(`vistack-deck turn.step: ${String(error)}`, { to: 'debug' })
        }
        yield chunk
      }
    } finally {
      // An aborted stream ends here too: no loop is left showing work it stopped doing.
      const stoppedAt = await $.clock.now()

      if (consultId !== undefined) {
        await endConsult($, consultId, stoppedAt, '').catch(() => undefined)
      }
      await setActivity($, key, null).catch(() => undefined)
    }

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
      if (e.answer.trim() !== '') {
        await addComm($, { at, from: 'coordinator', kind: 'answer', text: tail(e.answer), to: 'user' })
      }
      enqueue({ kind: 'settle', pickId: `turn-${e.turnId}`, result: e.reason, usd: cost.isPartial ? null : cost.usd })
      enqueue({ kind: 'advisor-scan' })
    } else {
      const agentId = e.agentId
      const cost = addUp(stepList.filter(step => step.agentId === agentId))
      const status = e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'killed' : 'failed'
      const parent = (await findAgent($, agentId))?.parentId ?? 'coordinator'

      await update($, agents, list => patchAgent(list, agentId, { answer: e.answer.slice(-2000), endedAt: at, status }))
      if (e.answer.trim() !== '') {
        await addComm($, { at, from: agentId, kind: 'report', text: tail(e.answer), to: parent })
      }
      enqueue({ kind: 'settle', pickId: `agent-${agentId}`, result: e.reason, usd: cost.isPartial ? null : cost.usd })
    }
    enqueue({ isForced: true, kind: 'usage' })

    return done
  })

  on('agent.spawn', async ($, e, next) => {
    // The deck's own hire and reload come back through here; the job that made them records them.
    const isOwn = next.origin.plugin === PLUGIN
    const request = `${e.description}\n\n${e.prompt}`
    const decision =
      !isOwn && mayApply(config.jevMode, e.subagentType, e.model) ? await decide($, request, 'agent-spawn') : null
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
        generation: 1,
        model: started.model,
        nickname: nickname(e.subagentType, agentId, list.map(one => one.nickname)),
        prompt: e.prompt.slice(0, PROMPT_CAP),
        startedAt: at,
        status: 'running',
        toolUseId: e.tool_use_id,
        type: e.subagentType,
        ...(e.parentAgentId === undefined ? {} : { parentId: e.parentAgentId }),
      }

      return [...list.filter(one => one.agentId !== agentId), agent].slice(-AGENT_CAP)
    })
    if (isOwn) {
      return started
    }
    await addComm($, { at, from: e.parentAgentId ?? 'coordinator', kind: 'dispatch', text: tail(e.description), to: agentId })
    if (decision !== null) {
      await addPick($, agentPick(decision, { agentId, at, model: started.model, subject }, true))
    } else if (config.jevMode !== 'off') {
      enqueue({ agentId, at, kind: 'decide-agent', model: started.model, request, subject })
    }

    return started
  })

  on('session.send', async ($, e, next) => {
    const sent = await next(e)

    if (!sent.isDelivered) {
      return sent
    }

    const isDeck = e.origin.kind === 'plugin' && e.origin.name === PLUGIN

    await addComm($, {
      from: isDeck ? 'deck' : (e.agentId ?? 'coordinator'),
      kind: 'message',
      text: tail(e.text),
      to: partyOf(e.to, await read($, agents)),
    })

    return sent
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
    // The deck's own TaskStop is not the coordinator's work.
    if (next.origin.plugin === PLUGIN) {
      return next(e)
    }

    const tool = String(e.tool)
    const id = e.tool_use_id
    const startedAt = await $.clock.now()
    const delta = editDelta(tool, e)
    const isNew = delta !== null && tool === 'Write' ? !(await exists($, delta.path)) : false
    const turnId = e.agentId === undefined ? currentTurnId : undefined
    const detail = toolDetail(tool, e)
    const isConsult = ADVISOR_TOOL.test(tool)

    await update($, tools, list =>
      startTool(list, {
        detail,
        id,
        startedAt,
        status: 'running',
        tool,
        ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
        ...(turnId === undefined ? {} : { turnId }),
      }),
    )
    if (isConsult) {
      await startConsult($, id, startedAt, turnId)
    }
    if (tool === 'AskUserQuestion' && e.agentId === undefined) {
      await addComm($, { at: startedAt, from: 'coordinator', kind: 'question', text: tail(detail || 'a question'), to: 'user' })
    }

    const ran = await next(e)
    const endedAt = await $.clock.now()
    const isError = ran.deny !== undefined || ran.isError === true

    await update($, tools, list => finishTool(list, id, endedAt, isError))
    if (isConsult) {
      await endConsult($, id, endedAt, isError ? '' : (ran.text ?? ''))
    }
    if (isError) {
      return ran
    }
    if (delta !== null) {
      await update($, edits, list => mergeEdit(list, delta, endedAt, isNew))
      enqueue({ kind: 'workflow' })
    }
    if (tool === 'Bash') {
      const command = String(field(e, 'command') ?? '')
      const post = reviewPostOf(command)

      if (post !== null) {
        await noteReview($, post, e.agentId ?? 'coordinator')
      } else if (isPrChange(command)) {
        enqueue({ kind: 'prs' })
      }
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

    const { Box, Button, Input, Select, Text } = $.ui.resolve(e)

    return renderDeck($, { Box, Button, Input, Select, Text }, Math.max(24, e.props.bodyColumns - 1), false)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      return next(e)
    }

    const prefs = await read($, deckSettings)

    if (prefs.placement !== 'bottom' || e.props.hasSurvey || !(await read($, isBandOpen))) {
      return next(e)
    }

    const { Box, Button, Input, Select, Text } = $.ui.resolve(e)

    return renderDeck($, { Box, Button, Input, Select, Text }, Math.max(24, e.props.bodyColumns), true)
  })
}
