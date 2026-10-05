import { fit } from '../lib/format'
import { COLOR, Empty, Section } from './parts'

import type { RenderElement } from 'claude-code'
import type { RecallHit } from '../lib/recall'
import type { Kit } from './parts'

export type RecallData = { query: string; hits: RecallHit[]; openId: string; total: number }

export type RecallActions = { search: (query: string) => void; open: (id: string) => void }

export const recallTab = (kit: Kit, data: RecallData, actions: RecallActions, columns: number): RenderElement => {
  const { Box, Button, Input, Text } = kit
  const picked = data.hits.find(hit => hit.id === data.openId)

  return (
    <Box flexDirection="column">
      <Input
        key="recall-query"
        label="Search"
        placeholder='keywords or "a phrase"'
        value={data.query}
        submitLabel="find"
        onSubmit={value => actions.search(value)}
      />
      <Text dimColor>
        {data.query === '' ? `latest of ${data.total} asks` : `${data.hits.length} of ${data.total} asks match`}
      </Text>
      {picked !== undefined && Section(kit, 'You asked', columns)}
      {picked !== undefined && <Text>{picked.ask}</Text>}
      {picked !== undefined && Section(kit, 'Answer', columns)}
      {picked !== undefined && <Text>{picked.answer === '' ? '(no answer recorded)' : picked.answer}</Text>}
      {picked !== undefined && <Button key="recall-back" plain label="back to results" onPress={() => actions.open('')} />}
      {picked === undefined && Section(kit, 'Results', columns)}
      {picked === undefined && data.hits.length === 0 && Empty(kit, 'No ask matches.')}
      {picked === undefined &&
        data.hits.map(hit => (
          <Box key={hit.id} flexDirection="column" width={columns}>
            <Button key={`open-${hit.id}`} plain label={fit(`› ${hit.ask}`, columns)} onPress={() => actions.open(hit.id)} />
            <Text color={COLOR.muted}>{fit(`  ${hit.snippet}`, columns)}</Text>
          </Box>
        ))}
    </Box>
  )
}
