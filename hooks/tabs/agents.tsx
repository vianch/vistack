import { adviceHead } from '../lib/advisor'
import { face, isLive } from '../lib/crew'
import { ago, basename, duration, fit, tokens, usd } from '../lib/format'
import { addUp } from '../lib/ledger'
import {
  STATE_LABELS,
  alumni,
  codeWrites,
  coordinatorStatus,
  departmentOf,
  doingNow,
  isWorking,
  orgTree,
  runningTurn,
} from '../lib/org'
import { modelFamily, modelLabel } from '../lib/pricing'
import { cells, flow } from '../lib/theme'
import { ACTIVITY_ICON, COMM_ICON, Chip, CommRow, Empty, Section, glyph, pulse, statusColor } from './parts'

import type { RenderElement } from 'claude-code'
import type { OrgNode } from '../lib/org'
import type { IconName } from '../lib/theme'
import type { Kit } from './parts'
import type {
  DeckActivity,
  DeckAdvisor,
  DeckAgent,
  DeckComm,
  DeckConsult,
  DeckPick,
  DeckSkill,
  DeckStep,
  DeckTool,
  DeckTurn,
  DeckUsage,
} from '../../types'

export type AgentAction = 'reload' | 'ask' | 'kill' | 'fire' | 'hire' | 'stop'

export type AgentsData = {
  agents: DeckAgent[]
  steps: DeckStep[]
  tools: DeckTool[]
  turns: DeckTurn[]
  picks: DeckPick[]
  skills: DeckSkill[]
  comms: DeckComm[]
  activity: Record<string, DeckActivity>
  advisor: DeckAdvisor
  usage: DeckUsage | null
  model: string
  selected: string
  confirm: string
  asking: string
  now: number
}

// `party` is 'coordinator', 'advisor', or an agent id.
export type AgentsActions = {
  select: (party: string) => void
  act: (action: AgentAction, party: string) => void
  ask: (party: string, text: string) => void
}

const HOTKEY: Readonly<Record<AgentAction, string>> = { ask: 'a', fire: 'f', hire: 'h', kill: 'k', reload: 'r', stop: 'x' }

const confirmHint = (kit: Kit, data: AgentsData, party: string, name: string): RenderElement | null => {
  const { Text, theme } = kit
  const [action, target] = data.confirm.split(':')

  if (target !== party || action === undefined) {
    return null
  }

  const verb: Readonly<Record<string, string>> = {
    fire: `fire ${name}`,
    kill: `stop ${name}`,
    reload: `reload ${name} as a new generation`,
    stop: "stop the coordinator's turn",
  }

  return (
    <Text key={`confirm-${party}`} color={theme.warn}>
      {`press ${HOTKEY[action as AgentAction] ?? '?'} again to ${verb[action] ?? action}; any other key cancels`}
    </Text>
  )
}

const actionButton = (
  kit: Kit,
  actions: AgentsActions,
  action: AgentAction,
  party: string,
  icon: IconName,
  label: string,
): RenderElement => {
  const { Button } = kit

  return (
    <Button
      key={`${action}-${party}`}
      plain
      hotkey={HOTKEY[action]}
      label={`${kit.icon[icon]} ${label}`}
      onPress={() => actions.act(action, party)}
    />
  )
}

const offButton = (kit: Kit, action: AgentAction, party: string, icon: IconName, text: string): RenderElement => {
  const { Text } = kit

  return (
    <Text key={`${action}-${party}-off`} dimColor>
      {`${kit.icon[icon]} ${text}`}
    </Text>
  )
}

const askInput = (kit: Kit, actions: AgentsActions, party: string, placeholder: string): RenderElement => {
  const { Input } = kit

  return (
    <Input
      key={`ask-input-${party}`}
      label="Ask"
      placeholder={placeholder}
      submitLabel="send"
      autoFocus
      onSubmit={value => actions.ask(party, value)}
    />
  )
}

const lastComm = (data: AgentsData, parties: readonly string[]): DeckComm | undefined =>
  [...data.comms].reverse().find(comm => parties.includes(comm.from) && parties.includes(comm.to))

const commText = (kit: Kit, comm: DeckComm | undefined): string =>
  comm === undefined ? '' : `${kit.icon[COMM_ICON[comm.kind]]} ${comm.kind}: ${comm.text}`

const youCard = (kit: Kit, data: AgentsData, columns: number): RenderElement => {
  const { Box, Text, theme } = kit
  const inner = Math.max(8, columns - 4)
  const prompt = [...data.turns].reverse().find(turn => turn.text.trim() !== '')

  return (
    <Box key="org-you" flexDirection="column" borderStyle="round" borderColor={theme.user} paddingX={1} width={columns}>
      <Box justifyContent="space-between">
        <Text bold color={theme.user}>
          {`${glyph(kit, 'user')}You · Owner`}
        </Text>
        <Text dimColor>{`asks ${data.turns.length}`}</Text>
      </Box>
      {prompt === undefined ? (
        <Text dimColor>No prompt yet.</Text>
      ) : (
        <Text>{fit(`“${prompt.text}”`, inner)}</Text>
      )}
    </Box>
  )
}

const connector = (kit: Kit, data: AgentsData, isBusy: boolean, columns: number): RenderElement => {
  const { Text, theme } = kit
  const comm = lastComm(data, ['user', 'coordinator'])
  const isDown = comm === undefined || comm.from === 'user'
  const ends = isDown ? [kit.icon.user, kit.icon.coordinator] : [kit.icon.coordinator, kit.icon.user]
  const line = `  ${ends[0]} ${flow(5, kit.frame, isBusy && kit.isAnimated)}▸ ${ends[1]}  `

  return (
    <Text key="org-link-you" wrap="truncate-end">
      <Text color={theme.coordinator}>{line}</Text>
      <Text dimColor>{fit(commText(kit, comm), Math.max(0, columns - cells(line)))}</Text>
    </Text>
  )
}

const coordinatorCard = (kit: Kit, data: AgentsData, actions: AgentsActions, columns: number): RenderElement => {
  const { Box, Button, Text, theme } = kit
  const inner = Math.max(8, columns - 4)
  const status = coordinatorStatus(data)
  const isBusy = status.state !== 'idle' && status.state !== 'waiting-agents'
  const turn = runningTurn(data.turns)
  const lastTurn = data.turns[data.turns.length - 1]
  const turnTime = turn === undefined ? duration(lastTurn?.durationMs) : duration(data.now - turn.startedAt)
  const uptime = data.usage === null ? '-' : duration(data.now - data.usage.startedAt)
  const mainCost = addUp(data.steps.filter(step => step.agentId === undefined))
  const mainTools = data.tools.filter(tool => tool.agentId === undefined)
  const writes = codeWrites(data.tools)
  const doing = doingNow(undefined, data.activity, data.tools)
  const now = doing === null ? status.label : doing.detail || doing.kind
  const since = status.state === 'idle' ? '' : ` (${duration(data.now - status.since)})`
  const isSelected = data.selected === 'coordinator'
  const chip = `${pulse(kit, isBusy, kit.icon.coordinator)} ${STATE_LABELS[status.state]}`
  const said = commText(kit, [...data.comms].reverse().find(comm => comm.from === 'coordinator'))
  const modelText = data.model === '' ? 'model ?' : modelLabel(data.model)

  return (
    <Box key="org-coordinator" flexDirection="column" borderStyle="double" borderColor={theme.coordinator} paddingX={1} width={columns}>
      <Box justifyContent="space-between">
        <Button
          key="sel-coordinator"
          plain
          label={fit(`${glyph(kit, 'coordinator')}Coordinator · Chief of Staff`, Math.max(8, inner - cells(chip) - 3))}
          onPress={() => actions.select('coordinator')}
        />
        {Chip(kit, chip, status.state === 'waiting-you' ? theme.warn : theme.coordinator)}
      </Box>
      <Text dimColor>
        {fit(`${modelText} · turn ${turnTime} · up ${uptime} · ${usd(mainCost.usd)} · ${mainTools.length} tools`, inner)}
      </Text>
      <Text>
        <Text color={theme.coordinator}>now: </Text>
        <Text>{fit(`${now}${since}`, Math.max(0, inner - 5))}</Text>
      </Text>
      {said !== '' && <Text dimColor>{fit(said, inner)}</Text>}
      {writes.length === 0 ? (
        <Text color={theme.good}>{`${glyph(kit, 'ok')}delegates only`}</Text>
      ) : (
        <Text bold color={theme.bad}>
          {fit(
            `${glyph(kit, 'warn')}coordinator wrote code: ${writes.length} edit${writes.length === 1 ? '' : 's'} (${[
              ...new Set(writes.map(tool => basename(tool.detail))),
            ]
              .slice(-3)
              .join(', ')})`,
            inner,
          )}
        </Text>
      )}
      {isSelected && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {actionButton(kit, actions, 'ask', 'coordinator', 'ask', 'Ask')}
          {turn === undefined
            ? offButton(kit, 'stop', 'coordinator', 'stop', 'Stop turn: no turn running')
            : actionButton(kit, actions, 'stop', 'coordinator', 'stop', 'Stop turn')}
        </Box>
      )}
      {isSelected && confirmHint(kit, data, 'coordinator', 'the coordinator')}
      {isSelected && data.asking === 'coordinator' && askInput(kit, actions, 'coordinator', 'drafted into your prompt')}
    </Box>
  )
}

const memberRows = (
  kit: Kit,
  data: AgentsData,
  actions: AgentsActions,
  node: OrgNode,
  lead: string,
  isLast: boolean,
  columns: number,
): RenderElement[] => {
  const { Box, Button, Text, theme } = kit
  const { agent } = node
  const id = agent.agentId
  const branch = `${lead}${isLast ? '└─ ' : '├─ '}`
  const under = `${lead}${isLast ? '   ' : '│  '}`
  const detailLead = `${under}${node.children.length > 0 ? '│ ' : '  '}`
  const own = addUp(data.steps.filter(step => step.agentId === id))
  const model = data.steps.find(step => step.agentId === id)?.model ?? agent.model
  const color = statusColor(kit, agent.status)
  const chip = `${pulse(kit, isLive(agent.status), '')} ${agent.status}`.trim()
  const elapsed = duration((agent.endedAt ?? data.now) - agent.startedAt)
  const faceText = face(agent.type, agent.status, kit.isAnimated ? kit.frame : 0)
  const nameRoom = Math.max(4, columns - cells(branch) - cells(faceText) - cells(chip) - cells(elapsed) - 5)
  const name = fit(agent.nickname, Math.min(nameRoom, 20))
  const title = fit(` · ${departmentOf(agent).title}`, Math.max(0, nameRoom - cells(name)))
  const doing = isWorking(agent) ? doingNow(id, data.activity, data.tools) : null
  const detail = [
    model === '' ? '' : modelLabel(model),
    `${tokens(own.input + own.cacheRead + own.cacheWrite + own.output)} tok`,
    usd(own.usd),
    doing === null ? '' : `${kit.icon[ACTIVITY_ICON[doing.kind]]} ${doing.detail || doing.kind}`,
  ]
    .filter(part => part !== '')
    .join(' · ')
  const rows: RenderElement[] = [
    <Box key={`row-${id}`} justifyContent="space-between" width={columns}>
      <Box>
        <Text color={theme.muted}>{branch}</Text>
        <Text color={color}>{faceText}</Text>
        <Button key={`sel-${id}`} plain label={name} onPress={() => actions.select(id)} />
        <Text dimColor>{title}</Text>
      </Box>
      <Box>
        {Chip(kit, chip, color)}
        <Text dimColor> {elapsed}</Text>
      </Box>
    </Box>,
    <Text key={`detail-${id}`} wrap="truncate-end">
      <Text color={theme.muted}>{detailLead}</Text>
      <Text dimColor>{fit(detail, Math.max(0, columns - cells(detailLead)))}</Text>
    </Text>,
  ]

  if (data.selected === id) {
    rows.push(expanded(kit, data, actions, agent, cells(detailLead), columns))
  }

  return [
    ...rows,
    ...node.children.flatMap((child, index) =>
      memberRows(kit, data, actions, child, under, index === node.children.length - 1, columns),
    ),
  ]
}

const expanded = (
  kit: Kit,
  data: AgentsData,
  actions: AgentsActions,
  agent: DeckAgent,
  indent: number,
  columns: number,
): RenderElement => {
  const { Box, Text, theme } = kit
  const id = agent.agentId
  const width = Math.max(8, columns - indent)
  const pick = data.picks.find(one => one.agentId === id)
  const model = data.steps.find(step => step.agentId === id)?.model ?? agent.model
  const isMatch = pick === undefined || modelFamily(pick.recommended) === modelFamily(model)
  const answerTail = (agent.answer ?? '').trim().split('\n').filter(Boolean).slice(-2).join(' ')
  const hasPrompt = agent.prompt !== undefined && agent.prompt.trim() !== ''

  return (
    <Box key={`open-${id}`} flexDirection="column" paddingLeft={indent} width={columns}>
      <Text>{fit(`${glyph(kit, 'dispatch')}${agent.description || agent.type}`, width)}</Text>
      {hasPrompt ? (
        <Text dimColor>{fit(`prompt: ${agent.prompt ?? ''}`, width * 2)}</Text>
      ) : (
        <Text color={theme.warn}>{fit('Prompt unknown: found by the agent list, so Hire and Reload are off.', width * 2)}</Text>
      )}
      {answerTail !== '' && <Text dimColor>{fit(`${glyph(kit, 'report')}${answerTail}`, width * 2)}</Text>}
      {pick !== undefined && (
        <Text color={isMatch ? theme.muted : theme.warn}>
          {fit(
            `jev ${pick.tier} → ${modelLabel(pick.recommended)} (${pick.confidence.toFixed(2)}, ${pick.backend})${
              isMatch ? '' : ` · ran ${modelLabel(model)}`
            }${pick.isApplied ? ' · applied' : ''}`,
            width,
          )}
        </Text>
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {hasPrompt ? actionButton(kit, actions, 'reload', id, 'reload', 'Reload') : offButton(kit, 'reload', id, 'reload', 'Reload')}
        {actionButton(kit, actions, 'ask', id, 'ask', 'Ask')}
        {isWorking(agent) ? actionButton(kit, actions, 'kill', id, 'kill', 'Kill') : offButton(kit, 'kill', id, 'kill', 'Kill: not running')}
        {actionButton(kit, actions, 'fire', id, 'fire', 'Fire')}
        {hasPrompt ? actionButton(kit, actions, 'hire', id, 'hire', 'Hire') : offButton(kit, 'hire', id, 'hire', 'Hire')}
      </Box>
      {confirmHint(kit, data, id, agent.nickname)}
      {data.asking === id && askInput(kit, actions, id, `a message to ${agent.nickname}`)}
    </Box>
  )
}

const consultDetail = (consult: DeckConsult): string =>
  [
    consult.model === undefined ? '' : modelLabel(consult.model),
    consult.input === undefined && consult.output === undefined
      ? ''
      : `${tokens((consult.input ?? 0) + (consult.cacheRead ?? 0) + (consult.cacheWrite ?? 0))}/${tokens(consult.output ?? 0)} tok`,
    consult.usd === undefined ? '' : usd(consult.usd),
    consult.ms === undefined ? '' : `took ${duration(consult.ms)}`,
  ]
    .filter(part => part !== '')
    .join(' · ')

const consultOutcome = (kit: Kit, consult: DeckConsult, width: number): RenderElement | null => {
  const { Text, theme } = kit
  const head = consult.adviceHead ?? (consult.advice === undefined ? '' : adviceHead(consult.advice))

  if (consult.error !== undefined) {
    return <Text color={theme.warn}>{fit(`${glyph(kit, 'warn')}advisor unavailable (${consult.error})`, width)}</Text>
  }
  if (head !== '') {
    return <Text color={theme.advisor}>{fit(`${glyph(kit, 'idea')}${head}`, width * 2)}</Text>
  }

  return consult.isRedacted === true ? <Text dimColor>{fit('advice redacted', width)}</Text> : null
}

const advisorSeat = (kit: Kit, data: AgentsData, actions: AgentsActions, members: readonly OrgNode[], columns: number): RenderElement => {
  const { Box, Button, Text, theme } = kit
  const width = Math.max(12, columns - 2)
  const inner = Math.max(8, width - 4)
  const { consults, isAdvising } = data.advisor
  const last = consults[consults.length - 1]
  const detail = last === undefined ? '' : consultDetail(last)
  const status = isAdvising ? `${pulse(kit, true, kit.icon.advisor)} advising` : 'on call'
  const isSelected = data.selected === 'advisor'

  return (
    <Box key="org-advisor" flexDirection="column" borderStyle="round" borderColor={theme.advisor} paddingX={1} marginLeft={2} width={width}>
      <Box justifyContent="space-between">
        <Button
          key="sel-advisor"
          plain
          label={fit(`${glyph(kit, 'advisor')}Advisor · Board advisor`, Math.max(8, inner - cells(status) - 3))}
          onPress={() => actions.select('advisor')}
        />
        {Chip(kit, status, isAdvising ? theme.advisor : theme.muted)}
      </Box>
      <Text dimColor>{fit(`consults ${consults.length}${last === undefined ? '' : ` · last ${ago(last.at, data.now)}`}`, inner)}</Text>
      {detail !== '' && <Text dimColor>{fit(detail, inner)}</Text>}
      {last !== undefined && consultOutcome(kit, last, inner)}
      {members.flatMap((node, index) => memberRows(kit, data, actions, node, '', index === members.length - 1, inner))}
      {isSelected && <Box flexDirection="row">{actionButton(kit, actions, 'ask', 'advisor', 'ask', 'Ask')}</Box>}
      {isSelected && data.asking === 'advisor' && askInput(kit, actions, 'advisor', 'drafted as a consult in your prompt')}
    </Box>
  )
}

export const agentsTab = (kit: Kit, data: AgentsData, actions: AgentsActions, columns: number): RenderElement => {
  const { Box, Text, theme } = kit
  const org = orgTree(data.agents)
  const status = coordinatorStatus(data)
  const isBusy = status.state !== 'idle' && status.state !== 'waiting-agents'
  const departments = org.departments.filter(department => department.count > 0)
  const staff = departments.reduce((sum, department) => sum + department.count, 0)
  const live = data.agents.filter(isWorking).length
  const gone = alumni(data.agents)
  const comms = [...data.comms].reverse().slice(0, 8)

  return (
    <Box flexDirection="column">
      {youCard(kit, data, columns)}
      {connector(kit, data, isBusy, columns)}
      {coordinatorCard(kit, data, actions, columns)}
      {advisorSeat(kit, data, actions, org.advisors, columns)}
      {Section(kit, `${glyph(kit, 'org')}Organization`, columns, `${live} live · ${staff} on staff`)}
      {departments.length === 0 &&
        Empty(kit, `No one hired yet: ${org.departments.map(department => `${kit.icon[department.icon]} ${department.label}`).join(' · ')}`)}
      {departments.flatMap((department, index) => {
        const isLast = index === departments.length - 1

        return [
          <Text key={`dept-${department.id}`}>
            <Text color={theme.muted}>{isLast ? '└─ ' : '├─ '}</Text>
            <Text bold color={theme.agent}>{`${glyph(kit, department.icon)}${department.label}`}</Text>
            <Text dimColor>{` (${department.count})`}</Text>
          </Text>,
          ...department.members.flatMap((node, memberIndex) =>
            memberRows(kit, data, actions, node, isLast ? '   ' : '│  ', memberIndex === department.members.length - 1, columns),
          ),
        ]
      })}
      {Section(kit, `${glyph(kit, 'message')}Comms`, columns, String(data.comms.length))}
      {comms.length === 0 && Empty(kit, 'Nobody has said anything yet.')}
      {comms.map(comm => CommRow(kit, comm, data.agents, columns))}
      {Section(kit, `${glyph(kit, 'alumni')}Alumni`, columns, String(gone.length))}
      {gone.length === 0 && Empty(kit, 'Nobody fired or reloaded.')}
      {gone.slice(0, 6).map(agent => {
        const successor = data.agents.find(one => one.hiredFrom === agent.agentId && agent.leftHow === 'reloaded')

        return (
          <Box key={`alum-${agent.agentId}`} justifyContent="space-between" width={columns}>
            <Text>
              {fit(
                `${glyph(kit, agent.leftHow === 'fired' ? 'fire' : 'reload')}${agent.nickname} · ${agent.leftHow ?? 'left'}${
                  successor === undefined ? '' : ` → ${successor.nickname}`
                }`,
                Math.max(8, columns - 10),
              )}
            </Text>
            <Text dimColor>{agent.leftAt === undefined ? '' : ago(agent.leftAt, data.now)}</Text>
          </Box>
        )
      })}
      {Section(kit, `${glyph(kit, 'spark')}Skills`, columns, String(data.skills.length))}
      {data.skills.length === 0 && Empty(kit, 'No skill has run.')}
      {[...data.skills]
        .reverse()
        .slice(0, 5)
        .map((skill, index) => (
          <Box key={`skill-${index}`} justifyContent="space-between" width={columns}>
            <Text color={theme.accent}>{fit(skill.skill, columns - 10)}</Text>
            <Text dimColor>{ago(skill.at, data.now)}</Text>
          </Box>
        ))}
    </Box>
  )
}
