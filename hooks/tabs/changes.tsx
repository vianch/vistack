import { ago, basename, fit, parentHint } from '../lib/format'
import { isEditedThisSession, previewText, rowLabel } from '../lib/git'
import { cells } from '../lib/theme'
import { Empty, Section } from './parts'

import type { RenderElement } from 'claude-code'
import type { Kit } from './parts'
import type { DeckEdit, DeckGit, DeckGitFile, DeckLazygit } from '../../types'

export type ChangesData = {
  edits: DeckEdit[]
  lazygit: DeckLazygit
  isGitAllowed: boolean
  home: string | undefined
  now: number
  git: DeckGit | null
}

export type ChangesActions = {
  toggleLazygit: () => void
  refreshGit: () => void
  preview: (path: string, area: DeckGitFile['area']) => void
}

type Tone = 'good' | 'warn' | 'bad' | 'dim'

const GROUPS: readonly { area: DeckGitFile['area']; title: string; tone: Tone }[] = [
  { area: 'staged', title: 'Staged', tone: 'good' },
  { area: 'unstaged', title: 'Unstaged', tone: 'warn' },
  { area: 'untracked', title: 'Untracked', tone: 'dim' },
  { area: 'conflict', title: 'Conflicts', tone: 'bad' },
]

const SESSION_ROWS = 20

const PREVIEW_INDENT = '   '

const dim = (kit: Kit, key: string, text: string): RenderElement => {
  const { Text } = kit

  return (
    <Text key={key} dimColor>
      {text}
    </Text>
  )
}

const toned = (kit: Kit, tone: Tone, text: string, key: string): RenderElement => {
  const { Text, theme } = kit

  return tone === 'dim' ? (
    <Text key={key} bold dimColor>
      {text}
    </Text>
  ) : (
    <Text key={key} bold color={theme[tone]}>
      {text}
    </Text>
  )
}

const notice = (git: DeckGit | null, isGitAllowed: boolean): string | undefined => {
  if (git === null) {
    return isGitAllowed ? 'Reading the working tree…' : 'git off: outside the realm — set the realm in Settings (9)'
  }
  if (git.state === 'off') {
    return 'git off: set your Git realm in Settings (9)'
  }

  return git.state === 'out-of-realm' ? 'git off: origin is outside the realm' : undefined
}

const Summary = (kit: Kit, edits: readonly DeckEdit[], columns: number): RenderElement => {
  const { Text, theme } = kit
  const added = edits.reduce((sum, edit) => sum + edit.added, 0)
  const removed = edits.reduce((sum, edit) => sum + edit.removed, 0)
  const touches = edits.reduce((sum, edit) => sum + edit.count, 0)
  const files = `${edits.length} files edited this session`
  const churn = `+${added} −${removed}`
  const count = `${touches} edits`
  const whole = `${files} · ${churn} · ${count}`

  if (cells(whole) > columns) {
    return <Text>{fit(whole, columns)}</Text>
  }

  return (
    <Text>
      <Text bold color={theme.accent}>
        {files}
      </Text>
      <Text dimColor> · </Text>
      <Text color={theme.good}>+{added}</Text>
      <Text color={theme.bad}> −{removed}</Text>
      <Text dimColor> · {count}</Text>
    </Text>
  )
}

const GitHeader = (kit: Kit, git: DeckGit, columns: number): RenderElement | null => {
  const { Text, theme } = kit

  if (git.branch === undefined && git.head === undefined) {
    return null
  }

  const branch = fit(`${kit.icon.branch} ${git.branch ?? 'HEAD'}`, Math.max(8, Math.floor(columns / 2)))
  const room = columns - cells(branch)
  const aheadBehind = git.ahead === undefined ? '' : ` ↑${git.ahead} ↓${git.behind ?? 0}`
  const sha = git.head === undefined ? '' : ` · ${git.head.sha}`
  const age = git.head?.age === undefined ? '' : ` · ${git.head.age}`
  const shownAheadBehind = cells(aheadBehind) <= room ? aheadBehind : ''
  const shownSha = cells(shownAheadBehind) + cells(sha) <= room ? sha : ''
  const shownAge = cells(shownAheadBehind) + cells(shownSha) + cells(age) <= room ? age : ''
  const subjectRoom = room - cells(shownAheadBehind) - cells(shownSha) - cells(shownAge) - 3
  const subject = git.head === undefined || shownSha === '' || subjectRoom < 4 ? '' : ` "${fit(git.head.subject, subjectRoom)}"`

  return (
    <Text key="git-head">
      <Text bold color={theme.good}>
        {branch}
      </Text>
      <Text color={theme.accent}>{shownAheadBehind}</Text>
      <Text dimColor>{shownSha}</Text>
      <Text>{subject}</Text>
      <Text dimColor>{shownAge}</Text>
    </Text>
  )
}

const Preview = (kit: Kit, preview: NonNullable<DeckGit['preview']>, columns: number): RenderElement[] => {
  const { Text, theme } = kit
  const width = Math.max(4, columns - PREVIEW_INDENT.length)
  const lines = preview.lines.map((line, index) => {
    const text = `${PREVIEW_INDENT}${previewText(line, width)}`
    const key = `git-preview-${index}`

    if (line.startsWith('@@')) {
      return (
        <Text key={key} color={theme.muted}>
          {text}
        </Text>
      )
    }
    if (line.startsWith('+') || line.startsWith('-')) {
      return (
        <Text key={key} color={line.startsWith('+') ? theme.good : theme.bad}>
          {text}
        </Text>
      )
    }

    return dim(kit, key, text)
  })

  return [
    ...(preview.lines.length === 0 ? [dim(kit, 'git-preview-empty', `${PREVIEW_INDENT}no textual change`)] : []),
    ...lines,
    ...(preview.isTruncated ? [dim(kit, 'git-preview-more', `${PREVIEW_INDENT}… more`)] : []),
  ]
}

const FileRow = (kit: Kit, file: DeckGitFile, index: number, data: ChangesData, actions: ChangesActions, columns: number): RenderElement => {
  const { Box, Button, Text } = kit
  const preview = data.git?.preview
  const openPreview = preview !== undefined && preview.path === file.path && preview.area === file.area ? preview : undefined
  const label = rowLabel(file, columns, isEditedThisSession(file.path, data.edits))
  const key = `git-${file.area}-${index}`

  return (
    <Box key={`row-${key}`} flexDirection="column" width={columns}>
      {file.path.endsWith('/') ? (
        <Text dimColor>{label}</Text>
      ) : (
        <Button key={key} plain label={label} onPress={() => actions.preview(file.path, file.area)} />
      )}
      {openPreview !== undefined && Preview(kit, openPreview, columns)}
    </Box>
  )
}

const Tree = (kit: Kit, git: DeckGit, data: ChangesData, actions: ChangesActions, columns: number): RenderElement[] => {
  const { Text, theme } = kit
  const groups = GROUPS.map(group => ({ ...group, files: git.files.filter(file => file.area === group.area) })).filter(
    group => group.files.length > 0,
  )
  const header = GitHeader(kit, git, columns)
  const state =
    git.state === 'loading'
      ? [dim(kit, 'git-loading', 'loading…')]
      : git.state === 'error'
        ? [
            <Text key="git-error" color={theme.bad}>
              {fit(git.reason ?? 'git failed', columns)}
            </Text>,
          ]
        : []
  const isClean = git.state === 'ok' && git.files.length === 0

  return [
    ...(header === null ? [] : [header]),
    ...state,
    ...(isClean ? [dim(kit, 'git-clean', 'Working tree clean.')] : []),
    ...groups.flatMap(group => [
      toned(kit, group.tone, fit(`${group.title} (${group.files.length})`, columns), `git-group-${group.area}`),
      ...group.files.map((file, index) => FileRow(kit, file, index, data, actions, columns)),
    ]),
  ]
}

const SessionRow = (kit: Kit, edit: DeckEdit, data: ChangesData, columns: number): RenderElement => {
  const { Box, Text, theme } = kit
  const plus = `+${edit.added}`
  const minus = ` −${edit.removed}`
  const when = `  ${edit.count}× · ${ago(edit.lastAt, data.now)}`
  const room = Math.max(4, columns - cells(plus) - cells(minus) - cells(when) - 1)
  const icon = `${edit.isNew ? kit.icon.new : kit.icon.file} `
  const name = fit(basename(edit.path), Math.max(1, room - cells(icon)))
  const hintRoom = room - cells(icon) - cells(name) - 2
  const hint = hintRoom < 4 ? '' : `  ${fit(parentHint(edit.path, data.home), hintRoom)}`

  return (
    <Box key={`edit-${edit.path}`} justifyContent="space-between" width={columns}>
      <Text>
        <Text>{icon}</Text>
        <Text bold color={edit.isNew ? theme.good : undefined}>
          {name}
        </Text>
        <Text dimColor>{hint}</Text>
      </Text>
      <Text>
        <Text color={theme.good}>{plus}</Text>
        <Text color={theme.bad}>{minus}</Text>
        <Text dimColor>{when}</Text>
      </Text>
    </Box>
  )
}

export const changesTab = (kit: Kit, data: ChangesData, actions: ChangesActions, columns: number): RenderElement => {
  const { Box, Button, Text, theme } = kit
  const gitNotice = notice(data.git, data.isGitAllowed)
  const readAgo = data.git === null || data.git.readAt <= 0 ? '' : `read ${ago(data.git.readAt, data.now)}`
  const hidden = data.edits.length - SESSION_ROWS

  return (
    <Box flexDirection="column">
      {Summary(kit, data.edits, columns)}
      <Box justifyContent="flex-end" columnGap={2} width={columns}>
        {data.isGitAllowed && <Button key="git-refresh" plain label={`${kit.icon.refresh} Refresh`} onPress={() => actions.refreshGit()} />}
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
      {data.lazygit.isOpen && <Text dimColor>{fit(`lazygit is open (${data.lazygit.how}); press g or the button to close it.`, columns)}</Text>}
      {data.lazygit.error !== undefined && <Text color={theme.bad}>{fit(data.lazygit.error, columns)}</Text>}
      {Section(kit, 'Working tree', columns, readAgo)}
      {gitNotice !== undefined || data.git === null ? Empty(kit, fit(gitNotice ?? '', columns)) : Tree(kit, data.git, data, actions, columns)}
      {Section(kit, 'This session', columns, 'from tool calls')}
      {data.edits.length === 0 && Empty(kit, 'No file edited yet.')}
      {data.edits.slice(0, SESSION_ROWS).map(edit => SessionRow(kit, edit, data, columns))}
      {hidden > 0 && Empty(kit, `… ${hidden} more`)}
    </Box>
  )
}
