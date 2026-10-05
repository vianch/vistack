import { duration, fit, percent, tokens, usd } from '../lib/format'
import { addUp, byModel, cacheShare, executions } from '../lib/ledger'
import { modelFamily, modelLabel } from '../lib/pricing'
import { COLOR, Empty, Line, Section } from './parts'

import type { RenderElement } from 'claude-code'
import type { Kit } from './parts'
import type { DeckAgent, DeckPick, DeckStep, DeckTool, DeckTurn, DeckUsage } from '../../types'

export type CostData = {
  steps: DeckStep[]
  turns: DeckTurn[]
  agents: DeckAgent[]
  tools: DeckTool[]
  picks: DeckPick[]
  usage: DeckUsage | null
  now: number
}

const cell = (text: string, width: number): string => fit(text, width).padStart(width)

export const costTab = (kit: Kit, data: CostData, columns: number): RenderElement => {
  const { Box, Text } = kit
  const all = addUp(data.steps)
  const models = byModel(data.steps)
  const runs = executions(data.steps, data.turns, data.agents, data.now).slice(0, 12)
  const toolErrors = data.tools.filter(tool => tool.status === 'error').length
  const engine = data.usage?.usd
  const labelWidth = Math.max(8, columns - 34)

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>engine total </Text>
        <Text bold color={COLOR.cost}>
          {usd(engine)}
        </Text>
        <Text dimColor> · estimate </Text>
        <Text bold>{usd(all.usd)}</Text>
        {all.isPartial && <Text color={COLOR.warn}> (unpriced model seen)</Text>}
      </Text>
      <Text dimColor>
        {all.requests} requests · {tokens(all.input + all.cacheRead + all.cacheWrite)} in · {tokens(all.output)} out · cache{' '}
        {percent(cacheShare(all) * 100, 100)} · failed {all.failed} · tool errors {toolErrors}
      </Text>
      {Section(kit, 'Per model', columns)}
      {models.length === 0 && Empty(kit, 'No model request yet.')}
      {models.length > 0 && (
        <Text dimColor>
          {'model'.padEnd(labelWidth)}
          {cell('req', 5)}
          {cell('in', 7)}
          {cell('out', 7)}
          {cell('cache', 6)}
          {cell('cost', 9)}
        </Text>
      )}
      {models.map(({ model, totals }) => (
        <Text key={model}>
          <Text color={COLOR.model}>{fit(modelLabel(model), labelWidth).padEnd(labelWidth)}</Text>
          {cell(String(totals.requests), 5)}
          {cell(tokens(totals.input + totals.cacheRead + totals.cacheWrite), 7)}
          {cell(tokens(totals.output), 7)}
          {cell(percent(cacheShare(totals) * 100, 100), 6)}
          <Text color={COLOR.cost}>{cell(usd(totals.usd), 9)}</Text>
        </Text>
      ))}
      {Section(kit, 'Per execution', columns, 'newest first')}
      {runs.length === 0 && Empty(kit, 'Nothing has run yet.')}
      {runs.map(run => (
        <Box key={run.id} flexDirection="column" width={columns}>
          {Line(
            kit,
            `${run.kind === 'agent' ? '◆' : '›'} ${run.label}`,
            `${duration(run.ms)} ${usd(run.totals.usd)}`,
            columns,
            run.kind === 'agent' ? COLOR.agent : undefined,
          )}
          <Text dimColor>
            {'  '}
            {run.models.map(modelLabel).join(', ') || '-'} · {run.totals.requests} req ·{' '}
            {tokens(run.totals.input + run.totals.cacheRead + run.totals.cacheWrite + run.totals.output)} tok · cache{' '}
            {percent(cacheShare(run.totals) * 100, 100)} · {run.status}
            {run.totals.failed > 0 ? ` · ${run.totals.failed} failed` : ''}
          </Text>
        </Box>
      ))}
      {Section(kit, 'Jev: recommended → used → result → cost', columns)}
      {data.picks.length === 0 && Empty(kit, 'No suggestion yet. Run /vistack:decisions-on to add Jev.')}
      {[...data.picks]
        .reverse()
        .slice(0, 10)
        .map(pick => {
          const isMatch = pick.actual === undefined || modelFamily(pick.actual) === modelFamily(pick.recommended)

          return (
            <Box key={pick.id} flexDirection="column" width={columns}>
              <Text>{fit(`${pick.scope === 'agent' ? '◆' : '›'} ${pick.subject}`, columns)}</Text>
              <Text>
                {'  '}
                <Text color={COLOR.model}>{modelLabel(pick.recommended)}</Text>
                <Text dimColor> ({pick.tier} {pick.confidence.toFixed(2)} {pick.backend})</Text>
                <Text> → </Text>
                <Text color={isMatch ? COLOR.good : COLOR.warn}>{pick.actual === undefined ? '…' : modelLabel(pick.actual)}</Text>
                <Text> → </Text>
                <Text dimColor>{pick.result ?? 'running'}</Text>
                <Text> → </Text>
                <Text color={COLOR.cost}>{pick.usd === undefined ? '…' : usd(pick.usd)}</Text>
              </Text>
            </Box>
          )
        })}
    </Box>
  )
}
