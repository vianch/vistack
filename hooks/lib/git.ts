import { fit } from './format'
import { cells, clip, padEnd } from './theme'

import type { DeckEdit, DeckGitFile } from '../../types'

type Area = DeckGitFile['area']

type Counts = { added?: number; removed?: number }

const PREVIEW_MAX_LINES = 24

const ROW_PREFIX_CELLS = 4

const COUNTS_GAP = '  '

const TAB_AS_SPACES = '  '

const GIT_CHANGE =
  /\bgit(?:\s+-{1,2}[\w-]+(?:=\S+|\s+(?!-)\S+)?)*\s+(?:add|commit|checkout|switch|stash|reset|restore|merge|rebase|pull|push|rm|mv|cherry-pick|revert|apply)(?=$|[\s;&|)])/

const ORDINARY = /^1 (\S)(\S) \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/

const RENAMED = /^2 (\S)(\S) \S+ \S+ \S+ \S+ \S+ \S+ \S+ ([^\t]+)\t(.+)$/

const UNMERGED = /^u \S\S \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/

const C_ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }

const AGE_UNITS: Readonly<Record<string, string>> = { day: 'd', hour: 'h', minute: 'm', month: 'mo', second: 's', week: 'w', year: 'y' }

export const statusArgs = (repoRoot: string): string[] => [
  'git',
  '-C',
  repoRoot,
  'status',
  '--porcelain=v2',
  '--branch',
  '--untracked-files=normal',
]

export const numstatArgs = (repoRoot: string, isStaged: boolean): string[] => [
  'git',
  '-C',
  repoRoot,
  'diff',
  '--numstat',
  ...(isStaged ? ['--cached'] : []),
]

export const headArgs = (repoRoot: string): string[] => ['git', '-C', repoRoot, 'log', '-1', '--format=%h%x09%s%x09%cr']

// `diff --no-index` exits 1 whenever the two sides differ, which is always for an untracked
// file: for that argv exit 0 and 1 are both success.
export const previewArgs = (repoRoot: string, path: string, area: Area): string[] =>
  area === 'untracked'
    ? ['git', '-C', repoRoot, 'diff', '--no-index', '--no-color', '/dev/null', path]
    : ['git', '-C', repoRoot, 'diff', ...(area === 'staged' ? ['--cached'] : []), '--no-color', '--unified=2', '--', path]

// Without -z, git C-quotes a path holding a quote, backslash, control or non-ASCII byte; spaces stay bare.
const unquote = (text: string): string => {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) {
    return text
  }

  const percentEncoded = text
    .slice(1, -1)
    .replace(/\\([0-7]{3}|[abfnrtv"\\])|[^\\]+/gu, (segment: string, escape: string | undefined) => {
      if (escape === undefined) {
        return encodeURIComponent(segment)
      }

      return /^[0-7]{3}$/.test(escape)
        ? `%${Number.parseInt(escape, 8).toString(16).padStart(2, '0')}`
        : encodeURIComponent(C_ESCAPES[escape] ?? escape)
    })

  try {
    return decodeURIComponent(percentEncoded)
  } catch {
    return text.slice(1, -1)
  }
}

const isRenameCode = (code: string): boolean => code === 'R' || code === 'C'

const changedRows = (indexCode: string, worktreeCode: string, path: string, from?: string): DeckGitFile[] => {
  const row = (area: Area, code: string): DeckGitFile => ({
    area,
    code,
    path,
    ...(from !== undefined && isRenameCode(code) ? { from } : {}),
  })

  return [...(indexCode === '.' ? [] : [row('staged', indexCode)]), ...(worktreeCode === '.' ? [] : [row('unstaged', worktreeCode)])]
}

export const parseStatus = (
  stdout: string,
): { branch?: string; upstream?: string; ahead?: number; behind?: number; files: DeckGitFile[] } => {
  const branch: { branch?: string; upstream?: string; ahead?: number; behind?: number } = {}
  const rows: DeckGitFile[] = []
  const conflicts: DeckGitFile[] = []
  const untracked: DeckGitFile[] = []

  for (const line of stdout.split('\n')) {
    const ordinary = ORDINARY.exec(line)
    const renamed = RENAMED.exec(line)
    const unmerged = UNMERGED.exec(line)
    const aheadBehind = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line)

    if (line.startsWith('# branch.head ')) {
      branch.branch = line.slice('# branch.head '.length)
    } else if (line.startsWith('# branch.upstream ')) {
      branch.upstream = line.slice('# branch.upstream '.length)
    } else if (aheadBehind !== null) {
      branch.ahead = Number(aheadBehind[1])
      branch.behind = Number(aheadBehind[2])
    } else if (ordinary !== null) {
      rows.push(...changedRows(ordinary[1] ?? '.', ordinary[2] ?? '.', unquote(ordinary[3] ?? '')))
    } else if (renamed !== null) {
      rows.push(...changedRows(renamed[1] ?? '.', renamed[2] ?? '.', unquote(renamed[3] ?? ''), unquote(renamed[4] ?? '')))
    } else if (unmerged !== null) {
      conflicts.push({ area: 'conflict', code: 'U', path: unquote(unmerged[1] ?? '') })
    } else if (line.startsWith('? ')) {
      untracked.push({ area: 'untracked', code: '?', path: unquote(line.slice(2)) })
    }
  }

  return {
    ...branch,
    files: [...rows.filter(row => row.area === 'staged'), ...rows.filter(row => row.area === 'unstaged'), ...untracked, ...conflicts],
  }
}

// numstat renames read "old => new" or "pre/{old => new}/post", and an empty side leaves "//".
const finalPath = (field: string): string => {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(field)

  if (brace !== null) {
    return unquote(`${brace[1] ?? ''}${brace[3] ?? ''}${brace[4] ?? ''}`.replace(/\/{2,}/g, '/'))
  }

  const arrow = field.split(' => ')

  return unquote(arrow.length === 2 ? (arrow[1] ?? field) : field)
}

const countOf = (field: string | undefined): number | undefined => {
  const count = Number(field)

  return field === undefined || field === '-' || field === '' || Number.isNaN(count) ? undefined : count
}

const countsByPath = (stdout: string): Map<string, Counts> => {
  const counts = new Map<string, Counts>()

  for (const line of stdout.split('\n')) {
    const [added, removed, ...path] = line.split('\t')

    if (path.length === 0) {
      continue
    }

    const addedCount = countOf(added)
    const removedCount = countOf(removed)

    counts.set(finalPath(path.join('\t')), {
      ...(addedCount === undefined ? {} : { added: addedCount }),
      ...(removedCount === undefined ? {} : { removed: removedCount }),
    })
  }

  return counts
}

export const mergeNumstat = (files: DeckGitFile[], stagedStdout: string, unstagedStdout: string): DeckGitFile[] => {
  const staged = countsByPath(stagedStdout)
  const unstaged = countsByPath(unstagedStdout)

  return files.map(file => {
    const source = file.area === 'staged' ? staged : file.area === 'untracked' ? undefined : unstaged
    const counts = source?.get(file.path)

    return counts === undefined ? file : { ...file, ...counts }
  })
}

const compactAge = (age: string): string =>
  age.replace(/(\d+) (second|minute|hour|day|week|month|year)s?/g, (_, count: string, unit: string) => `${count}${AGE_UNITS[unit] ?? unit}`).replace(/,/g, '')

export const parseHead = (stdout: string): { sha: string; subject: string; age?: string } | undefined => {
  const fields = stdout.replace(/\n+$/, '').split('\t')
  const sha = fields[0] ?? ''

  if (sha === '') {
    return undefined
  }

  const age = fields.length > 2 ? fields[fields.length - 1] : undefined
  const subject = fields.slice(1, age === undefined ? undefined : -1).join(' ')

  return { sha, subject, ...(age === undefined || age === '' ? {} : { age: compactAge(age) }) }
}

// Body lines never start with 'd', so "diff " always opens a header; "--- "/"+++ " are header only before "@@".
export const parsePreview = (stdout: string, max = PREVIEW_MAX_LINES): { lines: string[]; isTruncated: boolean } => {
  const lines: string[] = []
  let isBody = false

  for (const line of stdout === '' ? [] : stdout.replace(/\n$/, '').split('\n')) {
    if (line.startsWith('diff ')) {
      isBody = false
      continue
    }
    if (line.startsWith('@@')) {
      isBody = true
    }
    if (isBody || line.startsWith('Binary files ')) {
      lines.push(line)
    }
  }

  return { isTruncated: lines.length > max, lines: lines.slice(0, max) }
}

export const isGitChange = (command: string): boolean => GIT_CHANGE.test(command)

export const shortPath = (path: string, width: number): string => {
  const isDirectory = path.endsWith('/')
  const parts = path.split('/').filter(Boolean)
  const name = `${parts[parts.length - 1] ?? path}${isDirectory ? '/' : ''}`
  const parent = parts[parts.length - 2]
  const candidates = [path, ...(parent === undefined ? [] : [`…/${parent}/${name}`]), `…/${name}`]

  return candidates.find(candidate => cells(candidate) <= width) ?? fit(name, width)
}

export const rowLabel = (file: DeckGitFile, width: number, isEdited: boolean): string => {
  const prefix = `${file.code.slice(0, 1)} ${isEdited ? '·' : ' '} `
  const counts = file.added === undefined && file.removed === undefined ? '' : `+${file.added ?? 0} −${file.removed ?? 0}`
  const room = Math.max(4, width - ROW_PREFIX_CELLS - (counts === '' ? 0 : cells(counts) + COUNTS_GAP.length))
  const named = file.from === undefined ? file.path : `${file.from} → ${file.path}`
  const shown = cells(named) <= room ? named : shortPath(file.path, room)

  return counts === '' ? `${prefix}${shown}` : `${prefix}${padEnd(shown, room)}${COUNTS_GAP}${counts}`
}

export const isEditedThisSession = (gitPath: string, edits: readonly Pick<DeckEdit, 'path'>[]): boolean =>
  edits.some(edit => edit.path === gitPath || edit.path.endsWith(`/${gitPath}`))

export const previewText = (line: string, width: number): string => {
  const text = line.replace(/\t/g, TAB_AS_SPACES).replace(/[\r\n]/g, '')

  return cells(text) <= width ? text : `${clip(text, Math.max(0, width - 1))}…`
}
