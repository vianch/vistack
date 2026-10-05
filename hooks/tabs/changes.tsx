import { ago, basename, fit, parentHint } from '../lib/format'
import { COLOR, Empty, Section } from './parts'

import type { RenderElement } from 'claude-code'
import type { Kit } from './parts'
import type { DeckEdit, DeckLazygit } from '../../types'

export type ChangesData = {
  edits: DeckEdit[]
  lazygit: DeckLazygit
  isGitAllowed: boolean
  home: string | undefined
  now: number
}

export type ChangesActions = { toggleLazygit: () => void }

const BAR = 8

const churn = (edit: DeckEdit, biggest: number): { add: string; del: string; rest: string } => {
  const total = edit.added + edit.removed
  const filled = biggest === 0 ? 0 : Math.max(1, Math.round((total / biggest) * BAR))
  const add = total === 0 ? 0 : Math.round((edit.added / total) * filled)

  return { add: '█'.repeat(add), del: '█'.repeat(filled - add), rest: '·'.repeat(BAR - filled) }
}

export const changesTab = (kit: Kit, data: ChangesData, actions: ChangesActions, columns: number): RenderElement => {
  const { Box, Button, Text } = kit
  const added = data.edits.reduce((sum, edit) => sum + edit.added, 0)
  const removed = data.edits.reduce((sum, edit) => sum + edit.removed, 0)
  const biggest = Math.max(0, ...data.edits.map(edit => edit.added + edit.removed))
  const statsWidth = BAR + 14

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" width={columns}>
        <Text>
          <Text bold>{data.edits.length} files </Text>
          <Text color={COLOR.good}>+{added} </Text>
          <Text color={COLOR.bad}>-{removed}</Text>
        </Text>
        {data.isGitAllowed ? (
          <Button
            key="lazygit"
            hotkey="g"
            variant={data.lazygit.isOpen ? 'secondary' : 'primary'}
            label={data.lazygit.isOpen ? 'close lazygit' : 'lazygit'}
            onPress={() => actions.toggleLazygit()}
          />
        ) : (
          <Text dimColor>lazygit off: outside the realm</Text>
        )}
      </Box>
      {data.lazygit.isOpen && (
        <Text dimColor>lazygit is open ({data.lazygit.how}); press g or the button to close it.</Text>
      )}
      {data.lazygit.error !== undefined && <Text color={COLOR.bad}>{fit(data.lazygit.error, columns)}</Text>}
      {Section(kit, 'Edits', columns, 'this session, from tool calls')}
      {data.edits.length === 0 && Empty(kit, 'No file edited yet.')}
      {data.edits.slice(0, 40).map(edit => {
        const cells = churn(edit, biggest)

        return (
          <Box key={edit.path} flexDirection="column" width={columns}>
            <Box justifyContent="space-between">
              <Text>
                <Text bold>{fit(basename(edit.path), Math.max(4, columns - statsWidth - 6))}</Text>
                {edit.isNew && <Text color={COLOR.good}> new</Text>}
              </Text>
              <Text>
                <Text color={COLOR.good}>{cells.add}</Text>
                <Text color={COLOR.bad}>{cells.del}</Text>
                <Text dimColor>{cells.rest}</Text>
                <Text color={COLOR.good}> +{edit.added}</Text>
                <Text color={COLOR.bad}> -{edit.removed}</Text>
              </Text>
            </Box>
            <Box justifyContent="space-between">
              <Text dimColor>{fit(parentHint(edit.path, data.home), Math.max(4, columns - 22))}</Text>
              <Text dimColor>
                {edit.count}× · {ago(edit.lastAt, data.now)}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
