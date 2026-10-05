import { ago, fit } from '../lib/format'
import { COLOR, Empty, Section } from './parts'

import type { RenderElement } from 'claude-code'
import type { Kit } from './parts'
import type { DeckWorkflow } from '../../types'

export type WorkflowData = { workflow: DeckWorkflow | null; now: number }

export type WorkflowActions = { refresh: () => void }

const PHASE_COLOR: Readonly<Record<string, string>> = {
  blocked: COLOR.bad,
  'merge-ready': COLOR.good,
  paused: COLOR.warn,
  planned: COLOR.muted,
}

export const workflowTab = (kit: Kit, data: WorkflowData, actions: WorkflowActions, columns: number): RenderElement => {
  const { Box, Button, Text } = kit
  const { workflow } = data

  if (workflow === null) {
    return (
      <Box flexDirection="column">
        {Empty(kit, 'Reading run state…')}
        <Button key="wf-refresh" label="Refresh" onPress={() => actions.refresh()} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {Section(kit, 'Workspace', columns, ago(workflow.checkedAt, data.now))}
      <Text>{fit(workflow.cwd, columns)}</Text>
      {workflow.repoRoot !== undefined && workflow.repoRoot !== workflow.cwd && (
        <Text dimColor>{fit(`repo ${workflow.repoRoot}`, columns)}</Text>
      )}
      <Text>
        <Text dimColor>branch </Text>
        <Text color={COLOR.accent}>{workflow.branch ?? '-'}</Text>
        <Text dimColor> · realm </Text>
        <Text color={workflow.isInRealm ? COLOR.good : COLOR.warn}>{workflow.isInRealm ? 'in' : 'out'}</Text>
      </Text>
      {workflow.remote !== undefined && <Text dimColor>{fit(workflow.remote, columns)}</Text>}
      {Section(kit, 'viStack runs', columns, String(workflow.runs.length))}
      {workflow.runs.length === 0 && Empty(kit, 'No run state under .claude/state or .codex/vistack/state.')}
      {workflow.runs.map(run => (
        <Box key={run.slug} flexDirection="column" width={columns}>
          <Box justifyContent="space-between">
            <Text bold color={COLOR.agent}>
              {fit(run.slug, columns - 20)}
            </Text>
            <Text dimColor>{fit(`${run.playbook ?? '?'} · ${run.mode ?? '-'}`, 19)}</Text>
          </Box>
          {run.objective !== undefined && <Text dimColor>{fit(run.objective, columns * 2)}</Text>}
          {run.monitor !== undefined && <Text dimColor>monitor {run.monitor}</Text>}
          {run.slices.map(slice => (
            <Box key={`${run.slug}/${slice.id}`} justifyContent="space-between" width={columns}>
              <Text>
                <Text>{'  '}</Text>
                <Text>{fit(slice.id, Math.max(6, columns - 34))}</Text>
                <Text dimColor> {fit(`${slice.agent ?? '-'}/${slice.model ?? '-'}`, 18)}</Text>
              </Text>
              <Text>
                <Text color={PHASE_COLOR[slice.phase ?? ''] ?? COLOR.accent}>{slice.phase ?? '?'}</Text>
                {slice.pr !== undefined && <Text dimColor> PR</Text>}
                {slice.blockers > 0 && <Text color={COLOR.bad}> !{slice.blockers}</Text>}
              </Text>
            </Box>
          ))}
          {run.lastLedger !== undefined && <Text dimColor>{fit(`  last: ${run.lastLedger}`, columns)}</Text>}
        </Box>
      ))}
      {Section(kit, 'Worktrees', columns, String(workflow.worktrees.length))}
      {workflow.worktrees.length === 0 && Empty(kit, 'No slice worktree.')}
      {workflow.worktrees.map(tree => (
        <Box key={tree.path} justifyContent="space-between" width={columns}>
          <Text>{fit(tree.name, columns - 22)}</Text>
          <Text color={COLOR.accent}>{fit(tree.branch ?? '-', 20)}</Text>
        </Box>
      ))}
      <Button key="wf-refresh" label="Refresh" onPress={() => actions.refresh()} />
    </Box>
  )
}
