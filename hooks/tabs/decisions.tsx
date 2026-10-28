import { ago, clockTime, duration, fit, usd } from '../lib/format'
import { backendLabel, forkTally, pickStatus, pickTrigger } from '../lib/jev'
import { modelFamily, modelLabel } from '../lib/pricing'
import { cells } from '../lib/theme'
import { Empty, PickRows, Section, glyph } from './parts'

import type { RenderElement } from 'claude-code'
import type { Kit } from './parts'
import type { DeckAgent, DeckForkLayer, DeckLadderStep, DeckPick } from '../../types'

export type DecisionsData = {
  picks: readonly DeckPick[]
  forkLayer: DeckForkLayer | null
  agents: readonly DeckAgent[]
  openId: string
  now: number
}

export type DecisionsActions = { toggle: (id: string) => void; refresh: () => void }

type Marks = { good: string; bad: string; step: string; to: string; skip: string }

const INDENT = '   '

const PLAIN = ''

const ROW_CAP = 30

const ASCII_MARKS: Marks = { bad: 'x', good: 'v', skip: '-', step: '>', to: '->' }

const MARKS: Marks = { bad: '✗', good: '✓', skip: '·', step: '▸', to: '→' }

const TRIGGER_TEXT: Readonly<Record<DeckPick['trigger'], string>> = {
  prompt: 'prompt',
  spawn: 'subagent spawn',
  'spawn-apply': 'subagent spawn, before it started (apply)',
}

const share = (value: number): string => value.toFixed(2).replace(/^0\./, '.')

const compact = (value: number): string => (value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(Math.round(value)))

const pack = (prefix: string, parts: readonly string[], sep: string, width: number, nextWidth: number): string[] => {
  const lines: string[] = []
  let current = prefix

  for (const part of parts) {
    const isFirst = current === prefix || current === ''
    const joined = `${current}${isFirst ? '' : sep}${part}`

    if (cells(joined) > (lines.length === 0 ? width : nextWidth) && !isFirst) {
      lines.push(current)
      current = part
    } else {
      current = joined
    }
  }

  return [...lines, current]
}

const shortPath = (path: string): string => {
  const at = path.indexOf('/.claude/')

  return at === -1 ? path : path.slice(at + 1)
}

const rungState = (layer: DeckForkLayer, tier: string, marks: Marks): string => {
  const { cloudflare, jev, ollama } = layer

  if (tier === 'deterministic') {
    return 'policy'
  }
  if (tier === 'jev' && jev !== undefined) {
    if (!jev.enabled) {
      return 'jev off'
    }

    return jev.hasKey && jev.refused === undefined ? `jev ${marks.good}key` : `jev ${marks.bad}${jev.hasKey ? (jev.refused ?? '') : 'key'}`
  }
  if (tier.startsWith('cloudflare') && cloudflare !== undefined) {
    if (!cloudflare.enabled) {
      return 'cloudflare off'
    }
    if (!cloudflare.hasToken || !cloudflare.hasAccount) {
      return `cloudflare ${marks.bad}${cloudflare.hasToken ? 'account' : 'token'}`
    }

    return cloudflare.used === undefined || cloudflare.cap === undefined
      ? `cloudflare ${marks.good}`
      : `cloudflare ${compact(cloudflare.used)}/${compact(cloudflare.cap)}`
  }
  if (tier.startsWith('ollama') && ollama !== undefined) {
    if (ollama.reachable !== true) {
      return `ollama ${marks.bad}down`
    }

    return ollama.missing === true ? `ollama ${marks.bad}not pulled` : `ollama ${marks.good}`
  }

  return backendLabel(tier)
}

const stepMark = (step: DeckLadderStep, marks: Marks): string => {
  if (step.outcome === 'answered' || step.outcome === 'agreed') {
    return marks.good
  }

  return step.outcome === 'skipped' ? marks.skip : marks.bad
}

export const decisionsTab = (kit: Kit, data: DecisionsData, actions: DecisionsActions, columns: number): RenderElement => {
  const { Box, Button, Text, theme } = kit
  const marks = kit.iconSet === 'ascii' ? ASCII_MARKS : MARKS
  const layer = data.forkLayer
  const tally = forkTally(data.picks)
  const isOff = layer?.mode === 'off'
  const isAsking = layer !== null && !isOff && layer.script !== undefined
  const history = [...data.picks].reverse().find(pick => pick.history !== undefined)?.history
  const hints = layer === null ? [] : [layer.cloudflare?.hint, layer.ollama?.hint].filter((hint): hint is string => hint !== undefined)
  const right = layer === null ? 'not read yet' : `${layer.mode}${layer.forks === undefined ? '' : ` · ${layer.forks.forks} in history`}`
  const sessionParts = [
    `${tally.asked} asked`,
    `${tally.sharp} sharp`,
    `${tally.split} split`,
    ...tally.byBackend.map(([label, count]) => `${label} ${count}`),
    ...(tally.failed > 0 ? [`failed ${tally.failed}`] : []),
    ...(tally.deciding > 0 ? [`asking ${tally.deciding}`] : []),
  ]

  // No color draws dim; PLAIN draws in the terminal's own color.
  const line = (key: string, text: string, color?: string, indent = ''): RenderElement => (
    <Text key={key} {...(color === undefined ? { dimColor: true } : color === PLAIN ? {} : { color })}>
      {indent}
      {fit(text, columns - indent.length)}
    </Text>
  )

  const lines = (key: string, prefix: string, parts: readonly string[], sep: string, color?: string, lead = ''): RenderElement[] => {
    const indent = `${lead}${' '.repeat(Math.min(cells(prefix), 12))}`

    return pack(prefix, parts, sep, columns - lead.length, columns - indent.length).map((text, index) =>
      line(`${key}-${index}`, text, color, index === 0 ? lead : indent),
    )
  }

  const detail = (key: string, label: string, value: string, color = PLAIN): RenderElement[] =>
    lines(key, `${label}: `, value.split(' ').filter(word => word !== ''), ' ', color, INDENT)

  const opened = (pick: DeckPick): RenderElement[] => {
    const row = (name: string, label: string, value: string, color?: string): RenderElement[] => detail(`${pick.id}-${name}`, label, value, color)
    const status = pickStatus(pick)
    const took = pick.ms === undefined ? '' : ` · took ${duration(pick.ms)}`
    const request = pick.scope === 'main' ? `${Math.min(pick.subject.length, 2400)} chars` : 'description + prompt, ≤2400 chars'
    const asked = [
      ...row('asked', 'asked', `${clockTime(pick.at)} on ${TRIGGER_TEXT[pickTrigger(pick)]} · ${pick.decisionType ?? 'tier-selection'}${took}`),
      ...row('sent', 'sent', `source=${pick.scope === 'main' ? 'main-turn' : 'agent-spawn'} · request ${request}`),
      ...(pick.command === undefined ? [] : row('cmd', 'cmd', pick.command.replace(/\S*\/(vistack-decision\.py)/, '$1').replace(/\S*\/(\.claude\/)/g, '$1'))),
      ...(pick.history === undefined ? [] : row('history', 'history', shortPath(pick.history))),
    ]

    if (status === 'failed') {
      return [...asked, ...row('error', 'error', pick.error ?? 'no reason given', theme.bad)]
    }
    if (status !== 'decided') {
      return asked
    }

    const ladder = pick.ladder ?? []
    const policy = ladder.find(step => step.tier === 'deterministic')
    const rungs = ladder.filter(step => step.tier !== 'deterministic')
    const odds = [
      ...Object.entries(pick.probabilities ?? {}).map(([name, value]) => `${name} ${share(value)}`),
      ...(pick.contractChange === undefined ? [] : [`contract change ${share(pick.contractChange)}`]),
    ]
    const signals = pick.signals
    const signalParts = [
      ...(signals === undefined || signals.complex.length === 0 ? [] : [`complex ${signals.complex.join(', ')}`]),
      ...(signals === undefined || signals.mechanical.length === 0 ? [] : [`mechanical ${signals.mechanical.join(', ')}`]),
      ...(signals === undefined || signals.flags.length === 0 ? [] : [`flags ${signals.flags.join(', ')}`]),
      ...(signals?.pattern === true ? ['pattern'] : []),
      ...(signals?.tierMismatch === true ? ['tier mismatch'] : []),
    ]
    const isMatch = pick.actual !== undefined && modelFamily(pick.actual) === modelFamily(pick.recommended)
    const ran = pick.actual === undefined ? 'not yet' : `${modelLabel(pick.actual)} ${isMatch ? `${marks.good} match` : `${marks.bad} differs`}`
    const recorded = pick.decisionId === undefined ? '' : ` · ${pick.outcomeRecorded === true ? 'outcome recorded ' : ''}${fit(pick.decisionId, 12)}`
    const needs = pick.requiredEvidence ?? []
    const risks = pick.risks ?? []

    return [
      ...asked,
      ...row('policy', 'policy', `${policy?.note ?? pick.fork ?? 'answered'} "${(pick.rationale ?? '').replace(/\s*\S+ agreed at [\d.]+\.?$/, '')}"`),
      ...row('ladder', 'ladder', ['policy', ...rungs.map(step => `${backendLabel(step.tier)} ${stepMark(step, marks)}`)].join(` ${marks.step} `)),
      ...rungs
        .filter(step => step.note !== undefined || step.tier === pick.backend)
        .flatMap(step =>
          lines(
            `${pick.id}-rung-${step.tier}`,
            `${backendLabel(step.tier)}: `,
            `${step.outcome}${step.note === undefined ? '' : ` ${step.note}`}${step.tier === pick.backend ? ` · ${pick.tier} ${share(pick.confidence)}` : ''}`.split(' '),
            ' ',
            step.outcome === 'rejected' || step.outcome === 'unavailable' ? theme.warn : undefined,
            `${INDENT}  `,
          ),
        ),
      ...(odds.length === 0 ? [] : row('odds', 'P', odds.join(' · '))),
      ...(signalParts.length === 0 ? [] : row('signals', 'signals', signalParts.join(' · '))),
      ...row('final', 'final', `${pick.tier} ${marks.to} ${pick.role ?? '-'} ${marks.to} ${modelLabel(pick.recommended)} · ${pick.isApplied ? 'applied' : 'suggested, not applied'}`, theme.accent),
      ...row('ran', 'ran', `${ran} · ended: ${pick.result ?? 'running'}${pick.usd === undefined ? '' : ` · ${usd(pick.usd)}`}${recorded}`),
      ...(pick.alternatives ?? []).slice(0, 2).flatMap((alternative, index) => row(`else-${index}`, 'else', `${alternative.action}: "${alternative.reason}"`)),
      ...(needs.length === 0 ? [] : row('needs', 'needs', needs.join('; '))),
      ...(risks.length === 0 ? [] : row('risks', 'risks', risks.join('; '), theme.warn)),
    ]
  }

  return (
    <Box flexDirection="column">
      {Section(kit, 'Fork layer', columns, right)}
      {layer === null && Empty(kit, 'Status is read at session start; Refresh reads it now.')}
      {isOff && line('off', `${glyph(kit, 'warn')}model suggestions are off (jevMode)`, theme.warn)}
      {layer !== null && !isOff && layer.script === undefined && line('no-script', 'vistack-decision.py not found: set the vistackRoot option', theme.warn)}
      {layer?.error !== undefined && lines('status-error', 'decisions status failed: ', layer.error.split(' '), ' ', theme.bad)}
      {isAsking && layer.enabled === false && lines('models-off', 'models off here: ', ['the policy answers alone', '/vistack:decisions-on adds them'], ' · ')}
      {isAsking && layer.ladder.length > 0 && lines('ladder', 'ladder: ', layer.ladder.map(tier => rungState(layer, tier, marks)), ` ${marks.step} `, theme.accent)}
      {isAsking && lines('asked-on', 'asked on: ', ['each prompt', 'each subagent spawn', ...(layer.mode === 'apply' ? ['apply: before a built-in spawn'] : [])], ' · ')}
      {isAsking &&
        lines(
          'how',
          'how: ',
          ['vistack-decision.py', 'decision', 'tier-selection', '--backend', 'auto', '· stdin', '{source,', 'request≤2400}', '· history', history === undefined ? 'per call' : shortPath(history)],
          ' ',
        )}
      {isAsking && hints.flatMap((hint, index) => lines(`hint-${index}`, 'hint: ', hint.split(' '), ' ', theme.warn))}
      {lines('session', 'this session: ', sessionParts, ' · ')}
      <Box justifyContent="space-between" width={columns}>
        <Text dimColor>{layer === null ? '' : fit(`read ${ago(layer.readAt, data.now)}`, Math.max(1, columns - 12))}</Text>
        <Button key="fork-refresh" plain label={`${glyph(kit, 'refresh')}Refresh`} onPress={() => actions.refresh()} />
      </Box>
      {Section(kit, 'Forks', columns, 'newest first')}
      {data.picks.length === 0 && Empty(kit, isOff ? 'Nothing asked: suggestions are off.' : 'No fork asked yet: each prompt asks one.')}
      {[...data.picks]
        .reverse()
        .slice(0, ROW_CAP)
        .map(pick => (
          <Box key={pick.id} flexDirection="column" width={columns}>
            {PickRows(kit, pick, columns, { agents: data.agents, onPress: () => actions.toggle(pick.id) })}
            {data.openId === pick.id && opened(pick)}
          </Box>
        ))}
    </Box>
  )
}
