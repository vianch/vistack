import { ago, basename, fit, parentHint } from '../lib/format'
import { churnCells } from '../lib/charts'
import { Empty, Section, Tile } from './parts'

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

export const changesTab = (kit: Kit, data: ChangesData, actions: ChangesActions, columns: number): RenderElement => {
  const { Box, Button, Text, theme } = kit
  const added = data.edits.reduce((sum, edit) => sum + edit.added, 0)
  const removed = data.edits.reduce((sum, edit) => sum + edit.removed, 0)
  const touches = data.edits.reduce((sum, edit) => sum + edit.count, 0)
  const biggest = Math.max(0, ...data.edits.map(edit => edit.added + edit.removed))
  const statsWidth = BAR + 14
  const tileWidth = Math.max(12, Math.floor((columns - 3) / 4))

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {Tile(kit, { color: theme.accent, icon: 'file', key: 'tile-files', label: 'files', value: `${data.edits.length} files` }, tileWidth)}
        {Tile(kit, { color: theme.good, icon: 'new', key: 'tile-added', label: 'added', value: `+${added}` }, tileWidth)}
        {Tile(kit, { color: theme.bad, icon: 'fire', key: 'tile-removed', label: 'removed', value: `−${removed}` }, tileWidth)}
        {Tile(kit, { color: theme.tool, icon: 'tool', key: 'tile-edits', label: 'edits', value: String(touches) }, tileWidth)}
      </Box>
      <Box justifyContent="flex-end" width={columns}>
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
      {data.lazygit.error !== undefined && <Text color={theme.bad}>{fit(data.lazygit.error, columns)}</Text>}
      {Section(kit, 'Edits', columns, 'this session, from tool calls')}
      {data.edits.length === 0 && Empty(kit, 'No file edited yet.')}
      {data.edits.slice(0, 40).map(edit => {
        const churn = churnCells(edit, biggest, BAR)

        return (
          <Box key={edit.path} flexDirection="column" width={columns}>
            <Box justifyContent="space-between">
              <Text>
                <Text>{edit.isNew ? kit.icon.new : kit.icon.file} </Text>
                <Text bold color={edit.isNew ? theme.good : undefined}>
                  {fit(basename(edit.path), Math.max(4, columns - statsWidth - 6))}
                </Text>
              </Text>
              <Text>
                <Text color={theme.good}>{'█'.repeat(churn.add)}</Text>
                <Text color={theme.bad}>{'█'.repeat(churn.del)}</Text>
                <Text color={theme.muted}>{'·'.repeat(churn.rest)}</Text>
                <Text color={theme.good}> +{edit.added}</Text>
                <Text color={theme.bad}> −{edit.removed}</Text>
              </Text>
            </Box>
            <Box justifyContent="space-between">
              <Text dimColor>{fit(`   ${parentHint(edit.path, data.home)}`, Math.max(4, columns - 22))}</Text>
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
