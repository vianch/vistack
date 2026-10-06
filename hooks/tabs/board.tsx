import { pending } from '../lib/board'
import { ago, basename, duration, fit, tokens, until, usd } from '../lib/format'
import { addUp } from '../lib/ledger'
import { STATE_LABELS, codeWrites, coordinatorStatus, histogram, isWorking, orgTree, stacked, teamStatus } from '../lib/org'
import { ARM_RETRY_MS, CLEAN_TEXT, CRON_LIFE_MS, ROTATE_BEFORE_MS } from '../lib/review-watch'
import { flow } from '../lib/theme'
import { monitorsSection } from './monitors'
import { Bars, CommRow, Empty, Line, Section, Spark, Tile, glyph, pulse } from './parts'

import type { RenderElement } from 'claude-code'
import type { Reply } from '../lib/board'
import type { IconName } from '../lib/theme'
import type { MonitorsSectionActions, MonitorsSectionData } from './monitors'
import type { BarEntry, Kit } from './parts'
import type {
  DeckActivity,
  DeckAdvisor,
  DeckAgent,
  DeckComm,
  DeckMonitor,
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
  comms: DeckComm[]
  activity: Record<string, DeckActivity>
  advisor: DeckAdvisor
  usage: DeckUsage | null
  openId: string
  now: number
  monitors: MonitorsSectionData
  reviewWatch: DeckReviewWatch | null
  // The newest open loop row of the review watch in this session.
  watchLoop?: DeckMonitor
}

export type BoardActions = {
  toggle: (id: string) => void
  refreshPrs: () => void
  monitors: MonitorsSectionActions
  turnWatchOff: () => void
}

// The shared confirm atom's value while Turn off waits for its second press.
export const WATCH_OFF_CONFIRM = 'watch-off:review-watch'

const ACTIVITY_BUCKETS = 30
const MINUTE = 60_000
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

const watchBlock = (kit: Kit, data: BoardData, actions: BoardActions, columns: number): RenderElement[] => {
  const { Button, Text, theme } = kit
  const watch = data.reviewWatch

  if (watch === null) {
    return []
  }

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
    Section(kit, `${glyph(kit, 'pr')}Review watch`, columns, watch.enabled ? `on · ${watch.realm}` : 'off'),
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

const prBlock = (kit: Kit, data: BoardData, actions: BoardActions, columns: number): RenderElement[] => {
  const { Box, Button, Text, theme } = kit
  const { prs } = data
  const head = Section(kit, `${glyph(kit, 'pr')}Open PRs`, columns, prs.checkedAt === 0 ? '' : ago(prs.checkedAt, data.now))

  if (prs.state === 'off') {
    return [head, Empty(kit, `${prs.reason === undefined ? '' : `${prs.reason}. `}Set your Git realm in Settings (9) to list PRs.`)]
  }
  if (prs.state === 'out-of-realm') {
    return [head, Empty(kit, `Skipped: ${prs.reason ?? 'origin is outside the realm'}.`)]
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
    head,
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

const tiles = (kit: Kit, data: BoardData, columns: number): RenderElement => {
  const { Box, theme } = kit
  const all = addUp(data.steps)
  const staff = data.agents.filter(agent => agent.leftAt === undefined)
  const width = Math.max(12, Math.floor((columns - 2) / 3))

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {Tile(kit, { color: theme.user, icon: 'ask', key: 'tile-asks', label: 'asks', value: String(data.turns.length) }, width)}
      {Tile(
        kit,
        {
          color: data.replies.length > 0 ? theme.warn : theme.good,
          icon: 'wait',
          key: 'tile-replies',
          label: 'needs reply',
          value: String(data.replies.length),
        },
        width,
      )}
      {Tile(
        kit,
        { color: theme.agent, icon: 'org', key: 'tile-team', label: 'team live', value: `${staff.filter(isWorking).length}/${staff.length}` },
        width,
      )}
      {Tile(kit, { color: theme.cost, icon: 'cost', key: 'tile-cost', label: 'cost', value: usd(data.usage?.usd ?? all.usd) }, width)}
      {Tile(
        kit,
        {
          color: theme.model,
          icon: 'tokens',
          key: 'tile-tokens',
          label: 'tokens',
          value: tokens(all.input + all.cacheRead + all.cacheWrite + all.output),
        },
        width,
      )}
      {Tile(
        kit,
        { color: theme.advisor, icon: 'advisor', key: 'tile-consults', label: 'consults', value: String(data.advisor.consults.length) },
        width,
      )}
    </Box>
  )
}

const glance = (kit: Kit, data: BoardData, columns: number): RenderElement[] => {
  const { Box, Text, theme } = kit
  const status = coordinatorStatus(data)
  const isBusy = status.state !== 'idle' && status.state !== 'waiting-agents'
  const isFlowing = isBusy && kit.isAnimated
  const org = orgTree(data.agents)
  const writes = codeWrites(data.tools)
  const team = teamStatus(data.agents)
  const parts = [team.running, team.waiting, team.done, team.failed]
  const colors = [theme.agent, theme.warn, theme.good, theme.bad]
  const sizes = stacked(parts, Math.max(4, columns - 2))
  const coordinator = [kit.icon.coordinator, pulse(kit, isBusy, ''), STATE_LABELS[status.state]].filter(part => part !== '').join(' ')
  const departments = org.departments.map(department => `${kit.icon[department.icon]}${department.count}`).join(' ')

  return [
    <Box key="glance-flow" flexDirection="row" flexWrap="wrap" width={columns}>
      <Text color={theme.user}>{`${kit.icon.user} You `}</Text>
      <Text color={theme.muted}>{`${flow(2, kit.frame, isFlowing)}▸ `}</Text>
      <Text bold color={theme.coordinator}>{`${coordinator} `}</Text>
      <Text color={theme.muted}>{`${flow(2, kit.frame, isFlowing)}▸ `}</Text>
      <Text color={theme.agent}>{`${departments}  `}</Text>
      <Text color={theme.advisor}>{`${kit.icon.advisor} ${data.advisor.consults.length}`}</Text>
    </Box>,
    writes.length === 0 ? (
      <Text key="glance-policy" color={theme.good}>{`${glyph(kit, 'ok')}coordinator delegates only`}</Text>
    ) : (
      <Text key="glance-policy" bold color={theme.bad}>
        {fit(`${glyph(kit, 'warn')}coordinator wrote code: ${writes.length} edit${writes.length === 1 ? '' : 's'}`, columns)}
      </Text>
    ),
    <Text key="glance-team">
      {sizes.map((size, index) => (
        <Text key={`team-${index}`} color={colors[index] ?? theme.muted}>
          {'█'.repeat(size)}
        </Text>
      ))}
      {sizes.every(size => size === 0) && <Text color={theme.muted}>{'░'.repeat(Math.max(4, columns - 2))}</Text>}
    </Text>,
    <Text key="glance-legend" dimColor>
      {fit(`running ${team.running} · waiting ${team.waiting} · done ${team.done} · failed ${team.failed}`, columns)}
    </Text>,
  ]
}

const charts = (kit: Kit, data: BoardData, columns: number): RenderElement[] => {
  const { Box, Text, theme } = kit
  const mainCost = addUp(data.steps.filter(step => step.agentId === undefined)).usd
  const members: BarEntry[] = data.agents.map(agent => {
    const cost = addUp(data.steps.filter(step => step.agentId === agent.agentId)).usd

    return { color: theme.agent, key: `cost-${agent.agentId}`, label: agent.nickname, text: usd(cost), value: cost }
  })
  const entries = [
    { color: theme.coordinator, key: 'cost-coordinator', label: 'Coordinator', text: usd(mainCost), value: mainCost },
    ...members,
  ]
    .filter(entry => entry.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 6)
  const width = Math.min(ACTIVITY_BUCKETS, Math.max(8, columns - 16))
  const counts = histogram(
    data.tools.map(tool => tool.startedAt),
    data.now,
    width,
    MINUTE,
  )
  const top = Math.max(0, ...counts)
  const low = Math.min(...counts, top)

  return [
    Section(kit, `${glyph(kit, 'chart')}Cost by member`, columns, 'top 6'),
    ...(entries.length === 0 ? [Empty(kit, 'No cost recorded yet.')] : Bars(kit, entries, columns)),
    Section(kit, `${glyph(kit, 'chart')}Activity`, columns, 'tool calls / min'),
    <Box key="spark" columnGap={2} width={columns}>
      {Spark(kit, counts, width, theme.tool)}
      <Text dimColor>{fit(`min ${low} · max ${top} per min`, Math.max(0, columns - width - 2))}</Text>
    </Box>,
    <Box key="spark-axis" justifyContent="space-between" width={Math.min(columns, width)}>
      <Text dimColor>{`${width}m ago`}</Text>
      <Text dimColor>now</Text>
    </Box>,
  ]
}

export const boardTab = (kit: Kit, data: BoardData, actions: BoardActions, columns: number): RenderElement => {
  const { Box, Button, Text, theme } = kit
  const recent = [...data.turns].reverse().slice(0, 6)
  const sections = pending(data)
  const comms = [...data.comms].reverse().slice(0, 5)
  const TONE = { fail: theme.bad, run: theme.agent, todo: theme.warn, wait: theme.muted } as const

  return (
    <Box flexDirection="column">
      {tiles(kit, data, columns)}
      {Section(kit, `${glyph(kit, 'org')}Org at a glance`, columns)}
      {glance(kit, data, columns)}
      {monitorsSection(kit, data.monitors, actions.monitors, columns)}
      {watchBlock(kit, data, actions, columns)}
      {charts(kit, data, columns)}
      {Section(kit, `${glyph(kit, 'message')}Comms`, columns, String(data.comms.length))}
      {comms.length === 0 && Empty(kit, 'Nobody has said anything yet.')}
      {comms.map(comm => CommRow(kit, comm, data.agents, columns))}
      {Section(kit, `${glyph(kit, 'wait')}Needs reply`, columns, String(data.replies.length))}
      {data.replies.length === 0 && Empty(kit, 'Nothing waits on you.')}
      {data.replies.flatMap(reply => {
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
      })}
      {Section(kit, `${glyph(kit, 'ask')}Recent asks`, columns)}
      {recent.length === 0 && Empty(kit, 'No prompts yet this session.')}
      {recent.map(turn => {
        const own = data.steps.filter(step => step.agentId === undefined && step.turnId === turn.turnId)
        const right = `${turn.reason === undefined ? 'running' : duration(turn.durationMs)} ${usd(addUp(own).usd)}`

        return Line(kit, turn.text === '' ? '(continuation)' : turn.text, right, columns, undefined, turn.reason !== undefined)
      })}
      {prBlock(kit, data, actions, columns)}
      {sections.flatMap(section => [
        Section(kit, section.title, columns, String(section.rows.length)),
        ...section.rows.slice(0, 8).map(row => (
          <Text key={row.id} color={TONE[row.tone]}>
            {fit(`• ${row.text}`, columns)}
          </Text>
        )),
      ])}
      {sections.length === 0 && Section(kit, 'Pending', columns)}
      {sections.length === 0 && Empty(kit, 'Nothing pending.')}
      {data.openId !== '' && <Button key="close-all" plain dimColor label="collapse" onPress={() => actions.toggle('')} />}
    </Box>
  )
}
