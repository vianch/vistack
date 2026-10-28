import { pending } from '../lib/board'
import { face, isLive } from '../lib/crew'
import { ago, basename, duration, fit, until, usd } from '../lib/format'
import { addUp } from '../lib/ledger'
import { STATE_LABELS, codeWrites, coordinatorStatus, doingNow, isOnStaff, teamStatus } from '../lib/org'
import { ARM_RETRY_MS, CLEAN_TEXT, CRON_LIFE_MS, ROTATE_BEFORE_MS } from '../lib/review-watch'
import { cells, flow } from '../lib/theme'
import { monitorCounts, monitorsSection } from './monitors'
import { ACTIVITY_ICON, Empty, Fold, Line, PickRows, Section, glyph, pulse, statusColor } from './parts'

import type { RenderElement } from 'claude-code'
import type { Reply } from '../lib/board'
import type { IconName } from '../lib/theme'
import type { MonitorsSectionActions, MonitorsSectionData } from './monitors'
import type { Kit } from './parts'
import type {
  DeckActivity,
  DeckAdvisor,
  DeckAgent,
  DeckMonitor,
  DeckPick,
  DeckPr,
  DeckPrs,
  DeckReviewWatch,
  DeckStep,
  DeckTodo,
  DeckTool,
  DeckTurn,
  DeckUsage,
  DeckWatchItem,
  DeckWatchPost,
  DeckWorkflow,
} from '../../types'

export type BoardData = {
  replies: Reply[]
  turns: DeckTurn[]
  steps: DeckStep[]
  tools: DeckTool[]
  agents: DeckAgent[]
  todos: DeckTodo[]
  prs: DeckPrs
  workflow: DeckWorkflow | null
  activity: Record<string, DeckActivity>
  advisor: DeckAdvisor
  usage: DeckUsage | null
  openId: string
  now: number
  monitors: MonitorsSectionData
  reviewWatch: DeckReviewWatch | null
  // The newest open loop row of the review watch in this session.
  watchLoop?: DeckMonitor
  picks?: DeckPick[]
  // Section id → true while folded.
  folds?: Readonly<Record<string, boolean>>
}

export type BoardActions = {
  toggle: (id: string) => void
  refreshPrs: () => void
  monitors: MonitorsSectionActions
  turnWatchOff: () => void
  fold?: (id: string) => void
}

// The shared confirm atom's value while Turn off waits for its second press.
export const WATCH_OFF_CONFIRM = 'watch-off:review-watch'

const NOW_SHOWN = 5
const RECENT_SHOWN = 3
const WATCH_POSTS_SHOWN = 5
const WATCH_ERRORS: Readonly<Record<string, string>> = {
  realm: 'the state file names no valid realm (host/owner)',
  unreadable: 'the state file is unreadable; /vistack:review-watch off resets it',
}

type WatchRow = DeckWatchItem & { kind?: DeckWatchPost['kind'] }

type WatchGroup = { id: string; title: string; icon: IconName; color: string; items: readonly WatchRow[]; label: (item: WatchRow) => string; detail: (item: WatchRow) => string }

const watchLoopText = (watch: DeckReviewWatch, loop: DeckMonitor | undefined, now: number): string => {
  if (watch.isOffPending === true) {
    return 'turning off…'
  }
  if (loop !== undefined) {
    return `armed · rotates in ${until(new Date((loop.deadlineAt ?? loop.startedAt + CRON_LIFE_MS) - ROTATE_BEFORE_MS).toISOString(), now)}`
  }

  return watch.armRequestedAt !== undefined && now - watch.armRequestedAt < ARM_RETRY_MS ? 'arming…' : 'not armed in this session'
}

// Rows draw only the fields hooks/lib/review-watch.ts sanitized: mention text is someone else's.
const watchGroup = (kit: Kit, data: BoardData, actions: BoardActions, group: WatchGroup, columns: number): RenderElement[] => {
  const { Box, Button, Text } = kit

  if (group.items.length === 0) {
    return []
  }

  return [
    <Text key={`watch-${group.id}-title`} dimColor>
      {fit(group.title, columns)}
    </Text>,
    ...group.items.flatMap((item, index) => {
      const id = `watch:${group.id}:${item.key}`
      const row = (
        <Box key={`watch-${group.id}-row-${index}`} width={columns}>
          <Text color={group.color}>{glyph(kit, group.icon)}</Text>
          <Button key={`watch-${group.id}-${index}`} plain label={fit(group.label(item), columns - 3)} onPress={() => actions.toggle(id)} />
        </Box>
      )

      return data.openId === id
        ? [
            row,
            // Wraps rather than cuts: the line is there to show the whole URL.
            <Text key={`watch-${group.id}-detail-${index}`} dimColor>
              {`   ${group.detail(item)}`}
            </Text>,
          ]
        : [row]
    }),
  ]
}

const watchBody = (kit: Kit, data: BoardData, actions: BoardActions, watch: DeckReviewWatch, columns: number): RenderElement[] => {
  const { Button, Text, theme } = kit
  const last = watch.lastPassStartedAt ?? watch.lastPassAt
  const loopLine = `${watchLoopText(watch, data.watchLoop, data.now)} · ${last === undefined ? 'no pass yet' : `last pass ${ago(last, data.now)}`}`
  const join = (...parts: (string | undefined)[]): string => parts.filter(part => part !== undefined && part !== '').join(' · ')
  const posts = watch.posted.slice(0, WATCH_POSTS_SHOWN)
  const groups: WatchGroup[] = [
    {
      color: theme.warn,
      detail: item => join(item.reason, item.url),
      icon: 'warn',
      id: 'need',
      items: watch.needsYou,
      label: item => `${item.pr} ${item.author === undefined ? '' : `${item.author}: `}${item.text}`,
      title: `needs you (${watch.needsYou.length})`,
    },
    { color: theme.good, detail: item => join(item.text, item.url), icon: 'ok', id: 'clean', items: watch.clean, label: item => `${item.pr} ${item.text}`, title: `${CLEAN_TEXT} (${watch.clean.length})` },
    {
      color: theme.muted,
      detail: item => item.url,
      icon: 'message',
      id: 'post',
      items: posts,
      label: item => `${item.pr} ${item.kind ?? ''}: ${item.text} · ${ago(item.at, data.now)}`,
      title: `posted (last ${posts.length})`,
    },
  ]
  const isEmpty = groups.every(group => group.items.length === 0)

  return [
    ...(watch.enabled ? [<Text key="watch-loop" dimColor>{fit(loopLine, columns)}</Text>] : []),
    ...(watch.error === undefined ? [] : [<Text key="watch-error" color={theme.bad}>{fit(WATCH_ERRORS[watch.error] ?? watch.error, columns)}</Text>]),
    ...(isEmpty ? [Empty(kit, 'Nothing posted, clean, or waiting on you.')] : []),
    ...groups.flatMap(group => watchGroup(kit, data, actions, group, columns)),
    ...(watch.enabled && watch.isOffPending !== true ? [<Button key="watch-off" plain label={`${kit.icon.stop} Turn off`} onPress={() => actions.turnWatchOff()} />] : []),
    ...(data.monitors.confirm === WATCH_OFF_CONFIRM
      ? [<Text key="watch-off-confirm" color={theme.warn}>press Turn off again to switch the watch off everywhere</Text>]
      : []),
  ]
}

const replyContext = (kit: Kit, data: BoardData, reply: Reply, columns: number): RenderElement => {
  const { Box, Text, theme } = kit
  const turn = data.turns.find(one => one.turnId === reply.turnId) ?? data.turns[data.turns.length - 1]
  const own = data.steps.filter(step => step.agentId === undefined && step.turnId === turn?.turnId)
  const touched = data.tools
    .filter(tool => tool.turnId === turn?.turnId && ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool.tool))
    .map(tool => basename(tool.detail))
  const answerTail = (turn?.answer ?? '').trim().split('\n').filter(Boolean).slice(-3).join(' ')

  return (
    <Box flexDirection="column" paddingLeft={2} borderStyle="single" borderColor={theme.muted} width={columns}>
      <Text dimColor>You asked</Text>
      <Text>{fit(turn?.text ?? '-', (columns - 4) * 2)}</Text>
      {answerTail !== '' && <Text dimColor>Claude said</Text>}
      {answerTail !== '' && <Text>{fit(answerTail, (columns - 4) * 3)}</Text>}
      <Text dimColor>
        {touched.length === 0 ? 'No files touched' : `Touched ${[...new Set(touched)].slice(0, 6).join(', ')}`} · {usd(addUp(own).usd)} ·{' '}
        {duration(turn?.durationMs)}
      </Text>
    </Box>
  )
}

const prRight = (data: BoardData): string => {
  const { prs } = data
  const checked = prs.checkedAt === 0 ? '' : ago(prs.checkedAt, data.now)

  return prs.state === 'ok' ? [String(prs.items.length), checked].filter(part => part !== '').join(' · ') : checked
}

const prBody = (kit: Kit, data: BoardData, actions: BoardActions, columns: number): RenderElement[] => {
  const { Box, Button, Text, theme } = kit
  const { prs } = data

  if (prs.state === 'off') {
    return [Empty(kit, `${prs.reason === undefined ? '' : `${prs.reason}. `}Set your Git realm in Settings (9) to list PRs.`)]
  }
  if (prs.state === 'out-of-realm') {
    return [Empty(kit, `Skipped: ${prs.reason ?? 'origin is outside the realm'}.`)]
  }

  const repos = [...new Set(prs.items.map(pr => pr.repo))]
  const prRows = (pr: DeckPr): RenderElement[] => {
    const id = `pr-${pr.repo}-${pr.number}`
    const tone = pr.checks === 'failing' ? theme.bad : pr.checks === 'pending' ? theme.warn : theme.good
    const line = (
      <Box key={id} justifyContent="space-between" width={columns}>
        <Button
          key={`${id}-open`}
          plain
          label={fit(`${pr.repo.split('/').pop() ?? pr.repo}#${pr.number} ${pr.title}`, columns - 22)}
          onPress={() => actions.toggle(id)}
        />
        <Text>
          <Text color={tone}>{pr.checks}</Text>
          <Text dimColor> {pr.isDraft ? 'draft' : pr.review.toLowerCase().replace(/_/g, ' ')}</Text>
        </Text>
      </Box>
    )

    if (data.openId !== id) {
      return [line]
    }

    return [
      line,
      <Box key={`${id}-detail`} flexDirection="column" paddingLeft={2}>
        <Text dimColor>{fit(`${pr.branch} · ${pr.url}`, columns - 2)}</Text>
        {pr.failing.length > 0 && <Text color={theme.bad}>{fit(`failing: ${pr.failing.join(', ')}`, columns - 2)}</Text>}
      </Box>,
    ]
  }
  const rows =
    repos.length > 1
      ? repos.flatMap(repo => {
          const own = prs.items.filter(pr => pr.repo === repo)

          return [
            <Text key={`repo-${repo}`} bold color={theme.accent2}>
              {fit(`${glyph(kit, 'project')}${repo} (${own.length})`, columns)}
            </Text>,
            ...own.flatMap(prRows),
          ]
        })
      : prs.items.flatMap(prRows)

  return [
    ...(prs.state === 'error'
      ? [
          <Text key="pr-error" color={theme.bad}>
            {fit(prs.reason ?? 'gh failed', columns)}
          </Text>,
        ]
      : []),
    ...(prs.state === 'loading' ? [Empty(kit, 'Loading…')] : []),
    ...(rows.length === 0 && prs.state === 'ok' ? [Empty(kit, 'No open PRs of yours in the realm.')] : rows),
    <Button key="pr-refresh" label="Refresh PRs" onPress={() => actions.refreshPrs()} />,
  ]
}

type StatusSegment = { key: string; text: string; color: string; isBold?: boolean }

const statusLine = (kit: Kit, data: BoardData, columns: number): RenderElement => {
  const { Box, Text, theme } = kit
  const status = coordinatorStatus(data)
  const isBusy = status.state !== 'idle' && status.state !== 'waiting-agents'
  const team = teamStatus(data.agents)
  const live = team.running + team.waiting
  const since = status.state === 'idle' ? '' : duration(data.now - status.since)
  const context = data.usage?.contextPercent
  const you = `${kit.icon.user} You `
  const arrow = `${flow(2, kit.frame, isBusy && kit.isAnimated)}▸ `
  const coordinator = [kit.icon.coordinator, pulse(kit, isBusy, ''), STATE_LABELS[status.state], since].filter(part => part !== '').join(' ')
  const tail: readonly StatusSegment[] = [
    { color: theme.agent, key: 'team', text: ` · team ${live}/${live + team.done + team.failed} live` },
    { color: theme.advisor, key: 'advisor', text: ` · ${kit.icon.advisor} ${data.advisor.consults.length}` },
    { color: theme.cost, key: 'cost', text: ` · ${usd(data.usage?.usd ?? addUp(data.steps).usd)}` },
    ...(context === undefined
      ? []
      : [{ color: context >= 90 ? theme.bad : context >= 70 ? theme.warn : theme.good, key: 'ctx', text: ` · ctx ${context}%` }]),
  ]
  const head = fit(coordinator, Math.max(4, columns - cells(you) - cells(arrow)))
  const shown: StatusSegment[] = []
  let used = cells(you) + cells(arrow) + cells(head)

  for (const segment of tail) {
    if (used + cells(segment.text) > columns) {
      break
    }
    shown.push(segment)
    used += cells(segment.text)
  }

  return (
    <Box key="board-status" width={columns}>
      <Text color={theme.user}>{you}</Text>
      <Text color={theme.muted}>{arrow}</Text>
      <Text bold color={status.state === 'waiting-you' ? theme.warn : theme.coordinator}>
        {head}
      </Text>
      {shown.map(segment => (
        <Text key={`status-${segment.key}`} color={segment.color}>
          {segment.text}
        </Text>
      ))}
    </Box>
  )
}

const policyLine = (kit: Kit, data: BoardData, columns: number): RenderElement => {
  const { Text, theme } = kit
  const writes = codeWrites(data.tools)

  if (writes.length === 0) {
    return <Text key="board-policy" color={theme.good}>{`${glyph(kit, 'ok')}coordinator delegates only`}</Text>
  }

  return (
    <Text key="board-policy" bold color={theme.bad}>
      {fit(`${glyph(kit, 'warn')}coordinator wrote code: ${writes.length} edit${writes.length === 1 ? '' : 's'}`, columns)}
    </Text>
  )
}

const repliesBlock = (kit: Kit, data: BoardData, actions: BoardActions, columns: number): RenderElement[] => {
  const { Box, Button, Text, theme } = kit

  return [
    Section(kit, `${glyph(kit, 'wait')}Needs reply`, columns, String(data.replies.length)),
    ...(data.replies.length === 0 ? [Empty(kit, 'Nothing waits on you.')] : []),
    ...data.replies.flatMap(reply => {
      const isOpen = data.openId === reply.id
      const row = (
        <Box key={reply.id} justifyContent="space-between" width={columns}>
          <Text color={reply.kind === 'plan' || reply.kind === 'question' ? theme.warn : theme.accent}>
            {fit(`${glyph(kit, reply.kind === 'agent' ? 'wait' : 'question')}${reply.text}`, columns - 14)}
          </Text>
          <Button key={`${reply.id}-ctx`} plain label={isOpen ? 'hide' : 'context'} onPress={() => actions.toggle(reply.id)} />
        </Box>
      )

      return isOpen ? [row, replyContext(kit, data, reply, columns)] : [row]
    }),
  ]
}

const doingText = (kit: Kit, doing: DeckActivity | null, fallback: string): string =>
  doing === null ? fallback : `${kit.icon[ACTIVITY_ICON[doing.kind]]} ${doing.detail || doing.kind}`

const nowBlock = (kit: Kit, data: BoardData, columns: number): RenderElement[] => {
  const { Box, Text, theme } = kit
  const running = data.agents.filter(agent => isOnStaff(agent) && isLive(agent.status))
  const ownTool = [...data.tools].reverse().find(tool => tool.status === 'running' && tool.agentId === undefined)
  const agentRow = (agent: DeckAgent): RenderElement => {
    const faceText = face(agent.type, agent.status, kit.isAnimated ? kit.frame : 0)
    const elapsed = duration(data.now - agent.startedAt)
    const room = Math.max(4, columns - cells(faceText) - cells(elapsed) - 2)

    return (
      <Box key={`now-${agent.agentId}`} justifyContent="space-between" width={columns}>
        <Text wrap="truncate-end">
          <Text color={statusColor(kit, agent.status)}>{faceText}</Text>
          <Text>{fit(`${agent.nickname} · ${doingText(kit, doingNow(agent.agentId, data.activity, data.tools), agent.description)}`, room)}</Text>
        </Text>
        <Text dimColor>{elapsed}</Text>
      </Box>
    )
  }

  return [
    Section(kit, `${glyph(kit, 'live')}Now`, columns, `${running.length} live`),
    ...running.slice(0, NOW_SHOWN).map(agentRow),
    ...(running.length > NOW_SHOWN ? [Empty(kit, `+${running.length - NOW_SHOWN} more on Agents (2)`)] : []),
    ...(ownTool === undefined
      ? []
      : [Line(kit, `${kit.icon.coordinator} Coordinator · ${ownTool.tool} ${ownTool.detail}`, duration(data.now - ownTool.startedAt), columns, theme.coordinator)]),
    ...(running.length === 0 && ownTool === undefined ? [Empty(kit, 'Nothing running.')] : []),
  ]
}

const forkBlock = (kit: Kit, data: BoardData, columns: number): RenderElement[] => {
  const picks = data.picks ?? []
  const last = picks[picks.length - 1]

  return [
    Section(kit, `${glyph(kit, 'model')}Last fork`, columns, 'see Decisions (8)'),
    ...(last === undefined ? [Empty(kit, 'No fork asked yet.')] : PickRows(kit, last, columns, { agents: data.agents })),
  ]
}

type FoldSpot = { id: string; title: string; right: string }

const foldable = (kit: Kit, data: BoardData, actions: BoardActions, spot: FoldSpot, body: () => RenderElement[], columns: number): RenderElement[] => {
  const { fold } = actions

  if (fold === undefined) {
    return [Section(kit, spot.title, columns, spot.right), ...body()]
  }

  const isFolded = data.folds?.[spot.id] === true

  return [Fold(kit, { ...spot, isFolded, onToggle: () => fold(spot.id) }, columns), ...(isFolded ? [] : body())]
}

const monitorsBlock = (kit: Kit, data: BoardData, actions: BoardActions, columns: number): RenderElement[] => {
  const { fold } = actions

  if (fold === undefined) {
    return [monitorsSection(kit, data.monitors, actions.monitors, columns)]
  }

  const isFolded = data.folds?.monitors === true
  const head = Fold(kit, { id: 'monitors', isFolded, onToggle: () => fold('monitors'), right: monitorCounts(data.monitors.monitors), title: 'Monitors' }, columns)

  if (isFolded) {
    return [head]
  }

  return [head, monitorsSection(kit, { ...data.monitors, folds: data.folds ?? {}, hasHeader: false }, { ...actions.monitors, fold }, columns)]
}

export const boardTab = (kit: Kit, data: BoardData, actions: BoardActions, columns: number): RenderElement => {
  const { Box, Button, Text, theme } = kit
  const recent = [...data.turns].reverse().slice(0, RECENT_SHOWN)
  const sections = pending({ ...data, agents: [], tools: [] })
  const watch = data.reviewWatch
  const TONE = { fail: theme.bad, run: theme.agent, todo: theme.warn, wait: theme.muted } as const

  return (
    <Box flexDirection="column">
      {statusLine(kit, data, columns)}
      {policyLine(kit, data, columns)}
      {repliesBlock(kit, data, actions, columns)}
      {nowBlock(kit, data, columns)}
      {forkBlock(kit, data, columns)}
      {monitorsBlock(kit, data, actions, columns)}
      {foldable(
        kit,
        data,
        actions,
        { id: 'prs', right: prRight(data), title: `${glyph(kit, 'pr')}Open PRs` },
        () => prBody(kit, data, actions, columns),
        columns,
      )}
      {watch !== null &&
        foldable(
          kit,
          data,
          actions,
          { id: 'watch', right: watch.enabled ? `on · ${watch.realm}` : 'off', title: `${glyph(kit, 'pr')}Review watch` },
          () => watchBody(kit, data, actions, watch, columns),
          columns,
        )}
      {Section(kit, `${glyph(kit, 'ask')}Recent asks`, columns, String(data.turns.length))}
      {recent.length === 0 && Empty(kit, 'No prompts yet this session.')}
      {recent.map(turn => {
        const own = data.steps.filter(step => step.agentId === undefined && step.turnId === turn.turnId)
        const right = `${turn.reason === undefined ? 'running' : duration(turn.durationMs)} ${usd(addUp(own).usd)}`

        return Line(kit, turn.text === '' ? '(continuation)' : turn.text, right, columns, undefined, turn.reason !== undefined)
      })}
      {sections.flatMap(section => [
        Section(kit, section.title, columns, String(section.rows.length)),
        ...section.rows.slice(0, 8).map(row => (
          <Text key={row.id} color={TONE[row.tone]}>
            {fit(`• ${row.text}`, columns)}
          </Text>
        )),
      ])}
      {data.openId !== '' && <Button key="close-all" plain dimColor label="collapse" onPress={() => actions.toggle('')} />}
    </Box>
  )
}
