import { ago, fit } from '../lib/format'
import { cells, padEnd } from '../lib/theme'
import { Chip, Empty, Section, glyph } from './parts'

import type { RenderElement } from 'claude-code'
import type { Kit } from './parts'
import type { DeckWorkflow } from '../../types'

export type WorkflowData = { workflow: DeckWorkflow | null; now: number }

export type WorkflowActions = { refresh: () => void }

export const workflowTab = (kit: Kit, data: WorkflowData, actions: WorkflowActions, columns: number): RenderElement => {
  const { Box, Button, Text, theme } = kit
  const { workflow } = data
  const PHASE_COLOR: Readonly<Record<string, string>> = {
    blocked: theme.bad,
    'merge-ready': theme.good,
    paused: theme.warn,
    planned: theme.muted,
  }

  if (workflow === null) {
    return (
      <Box flexDirection="column">
        {Empty(kit, 'Reading run state…')}
        <Button key="wf-refresh" label="Refresh" onPress={() => actions.refresh()} />
      </Box>
    )
  }

  const repoName = (workflow.repoRoot ?? workflow.cwd).split('/').filter(Boolean).pop() ?? workflow.cwd

  return (
    <Box flexDirection="column">
      {Section(kit, 'Workspace', columns, ago(workflow.checkedAt, data.now))}
      <Box columnGap={2} width={columns}>
        <Text bold color={theme.accent}>
          {glyph(kit, 'project')}
          {fit(repoName, Math.max(6, columns - 32))}
        </Text>
        <Text color={theme.good}>
          {glyph(kit, 'branch')}
          {fit(workflow.branch ?? '-', 20)}
        </Text>
        {Chip(kit, `realm ${workflow.isInRealm ? 'in' : 'out'}`, workflow.isInRealm ? theme.good : theme.warn)}
      </Box>
      <Text dimColor>{fit(workflow.cwd, columns)}</Text>
      {workflow.repoRoot !== undefined && workflow.repoRoot !== workflow.cwd && (
        <Text dimColor>{fit(`repo ${workflow.repoRoot}`, columns)}</Text>
      )}
      {workflow.remote !== undefined && <Text dimColor>{fit(workflow.remote, columns)}</Text>}
      {Section(kit, 'viStack runs', columns, String(workflow.runs.length))}
      {workflow.runs.length === 0 && Empty(kit, 'No run state under .claude/state or .codex/vistack/state.')}
      {workflow.runs.map(run => (
        <Box key={run.slug} flexDirection="column" borderStyle="round" borderColor={theme.agent} paddingX={1} width={columns}>
          <Box justifyContent="space-between">
            <Text bold color={theme.agent}>
              {glyph(kit, 'captain')}
              {fit(run.slug, Math.max(6, columns - 34))}
            </Text>
            <Box columnGap={1}>
              {Chip(kit, run.playbook ?? '?', theme.accent)}
              {Chip(kit, run.mode ?? '-', theme.accent2)}
            </Box>
          </Box>
          {run.objective !== undefined && <Text dimColor>{fit(run.objective, columns * 2)}</Text>}
          {run.monitor !== undefined && <Text dimColor>monitor {run.monitor}</Text>}
          {run.slices.map(slice => {
            const phase = slice.phase ?? '?'
            const who = fit(`${slice.agent ?? '-'}/${slice.model ?? '-'}`, 18)
            const room = Math.max(6, columns - 4 - cells(who) - cells(phase) - 16)

            return (
              <Box key={`${run.slug}/${slice.id}`} justifyContent="space-between" width={columns - 4}>
                <Text wrap="truncate-end">
                  <Text>{padEnd(fit(slice.id, room), room)}</Text>
                  <Text dimColor> {who}</Text>
                </Text>
                <Box columnGap={1}>
                  {Chip(kit, phase, PHASE_COLOR[slice.phase ?? ''] ?? theme.accent)}
                  {slice.pr !== undefined && <Text color={theme.accent2}>{kit.icon.pr} PR</Text>}
                  {slice.blockers > 0 && (
                    <Text color={theme.bad}>
                      {kit.icon.warn} {slice.blockers}
                    </Text>
                  )}
                </Box>
              </Box>
            )
          })}
          {run.lastLedger !== undefined && <Text dimColor>{fit(`last: ${run.lastLedger}`, columns - 4)}</Text>}
        </Box>
      ))}
      {Section(kit, 'Worktrees', columns, String(workflow.worktrees.length))}
      {workflow.worktrees.length === 0 && Empty(kit, 'No slice worktree.')}
      {workflow.worktrees.map(tree => (
        <Box key={tree.path} justifyContent="space-between" width={columns}>
          <Text>{fit(tree.name, Math.max(6, columns - 24))}</Text>
          <Text color={theme.good}>
            {glyph(kit, 'branch')}
            {fit(tree.branch ?? '-', 20)}
          </Text>
        </Box>
      ))}
      <Button key="wf-refresh" label="Refresh" onPress={() => actions.refresh()} />
    </Box>
  )
}
