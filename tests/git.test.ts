import { describe, expect, test } from 'claude-code/testing'

import {
  headArgs,
  isEditedThisSession,
  isGitChange,
  mergeNumstat,
  numstatArgs,
  parseHead,
  parsePreview,
  parseStatus,
  previewArgs,
  previewText,
  rowLabel,
  shortPath,
  statusArgs,
} from '../hooks/lib/git'
import { cells } from '../hooks/lib/theme'

const PORCELAIN = [
  '# branch.oid 1234567890abcdef1234567890abcdef12345678',
  '# branch.head feature/deck',
  '# branch.upstream origin/feature/deck',
  '# branch.ab +2 -1',
  '1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb hooks/lib/git.ts',
  '1 .M N... 100644 100644 100644 aaaaaaa aaaaaaa docs/my notes.md',
  '1 MM N... 100644 100644 100644 aaaaaaa bbbbbbb hooks/register.tsx',
  '2 R. N... 100644 100644 100644 aaaaaaa aaaaaaa R100 hooks/lib/new name.ts\thooks/lib/old.ts',
  'u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc types/index.d.ts',
  '? new.txt',
  '? "caf\\303\\251 \\"menu\\".txt"',
  '! ignored.log',
  '',
].join('\n')

describe('git argv', () => {
  test('builds read-only commands rooted at the repository', async () => {
    expect(statusArgs('/r')).toEqual(['git', '-C', '/r', 'status', '--porcelain=v2', '--branch', '--untracked-files=normal'])
    expect(numstatArgs('/r', false)).toEqual(['git', '-C', '/r', 'diff', '--numstat'])
    expect(numstatArgs('/r', true)).toEqual(['git', '-C', '/r', 'diff', '--numstat', '--cached'])
    expect(headArgs('/r')).toEqual(['git', '-C', '/r', 'log', '-1', '--format=%h%x09%s%x09%cr'])
  })

  test('previews one file by area, untracked against /dev/null', async () => {
    expect(previewArgs('/r', 'a b.ts', 'staged')).toEqual(['git', '-C', '/r', 'diff', '--cached', '--no-color', '--unified=2', '--', 'a b.ts'])
    expect(previewArgs('/r', 'a.ts', 'unstaged')).toEqual(['git', '-C', '/r', 'diff', '--no-color', '--unified=2', '--', 'a.ts'])
    expect(previewArgs('/r', 'a.ts', 'conflict')).toEqual(['git', '-C', '/r', 'diff', '--no-color', '--unified=2', '--', 'a.ts'])
    expect(previewArgs('/r', 'new.txt', 'untracked')).toEqual(['git', '-C', '/r', 'diff', '--no-index', '--no-color', '/dev/null', 'new.txt'])
  })

  test('no builder ever writes to the repository', async () => {
    const all = [statusArgs('/r'), numstatArgs('/r', true), headArgs('/r'), previewArgs('/r', 'x', 'staged'), previewArgs('/r', 'x', 'untracked')]

    expect(all.map(argv => argv[3])).toEqual(['status', 'diff', 'log', 'diff', 'diff'])
  })
})

describe('parseStatus', () => {
  test('reads branch, upstream and ahead/behind', async () => {
    const status = parseStatus(PORCELAIN)

    expect(status.branch).toBe('feature/deck')
    expect(status.upstream).toBe('origin/feature/deck')
    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(1)
  })

  test('splits index and worktree changes into lazygit groups, in stdout order', async () => {
    expect(parseStatus(PORCELAIN).files).toEqual([
      { area: 'staged', code: 'M', path: 'hooks/lib/git.ts' },
      { area: 'staged', code: 'M', path: 'hooks/register.tsx' },
      { area: 'staged', code: 'R', from: 'hooks/lib/old.ts', path: 'hooks/lib/new name.ts' },
      { area: 'unstaged', code: 'M', path: 'docs/my notes.md' },
      { area: 'unstaged', code: 'M', path: 'hooks/register.tsx' },
      { area: 'untracked', code: '?', path: 'new.txt' },
      { area: 'untracked', code: '?', path: 'café "menu".txt' },
      { area: 'conflict', code: 'U', path: 'types/index.d.ts' },
    ])
  })

  test('a rename modified again keeps `from` on the staged row only', async () => {
    const files = parseStatus('2 RM N... 100644 100644 100644 aaaaaaa aaaaaaa R087 b.ts\ta.ts\n').files

    expect(files).toEqual([
      { area: 'staged', code: 'R', from: 'a.ts', path: 'b.ts' },
      { area: 'unstaged', code: 'M', path: 'b.ts' },
    ])
    expect(files[1]?.from).toBeUndefined()
  })

  test('no upstream leaves ahead/behind unset; a detached head reads literally', async () => {
    const status = parseStatus('# branch.oid abc\n# branch.head (detached)\n')

    expect(status).toEqual({ branch: '(detached)', files: [] })
    expect(status.ahead).toBeUndefined()
    expect(parseStatus('')).toEqual({ files: [] })
  })
})

describe('mergeNumstat', () => {
  const files = [
    { area: 'staged' as const, code: 'M', path: 'hooks/register.tsx' },
    { area: 'staged' as const, code: 'R', from: 'src/lib/a.ts', path: 'src/a.ts' },
    { area: 'staged' as const, code: 'R', from: 'old.txt', path: 'renamed.txt' },
    { area: 'staged' as const, code: 'A', path: 'assets/logo.png' },
    { area: 'unstaged' as const, code: 'M', path: 'hooks/register.tsx' },
    { area: 'unstaged' as const, code: 'M', path: 'docs/my notes.md' },
    { area: 'untracked' as const, code: '?', path: 'new.txt' },
    { area: 'conflict' as const, code: 'U', path: 'types/index.d.ts' },
  ]
  const staged = ['3\t0\thooks/register.tsx', '1\t1\tsrc/{lib => }/a.ts', '0\t0\told.txt => renamed.txt', '-\t-\tassets/logo.png', ''].join('\n')
  const unstaged = ['7\t4\thooks/register.tsx', '2\t2\tdocs/my notes.md', '5\t5\tnew.txt', '9\t9\ttypes/index.d.ts', ''].join('\n')

  test('staged rows take --cached numbers and unstaged rows the plain ones', async () => {
    const merged = mergeNumstat(files, staged, unstaged)

    expect(merged[0]).toEqual({ added: 3, area: 'staged', code: 'M', path: 'hooks/register.tsx', removed: 0 })
    expect(merged[4]).toEqual({ added: 7, area: 'unstaged', code: 'M', path: 'hooks/register.tsx', removed: 4 })
    expect(merged[5]).toMatchObject({ added: 2, removed: 2 })
    expect(merged[7]).toMatchObject({ added: 9, removed: 9 })
  })

  test('matches renames on the final path, brace and arrow forms', async () => {
    const merged = mergeNumstat(files, staged, unstaged)

    expect(merged[1]).toMatchObject({ added: 1, from: 'src/lib/a.ts', path: 'src/a.ts', removed: 1 })
    expect(merged[2]).toMatchObject({ added: 0, path: 'renamed.txt', removed: 0 })
  })

  test('a binary file and an untracked file carry no counts', async () => {
    const merged = mergeNumstat(files, staged, unstaged)

    expect(merged[3]?.added).toBeUndefined()
    expect(merged[3]?.removed).toBeUndefined()
    expect(merged[6]?.added).toBeUndefined()
    expect(mergeNumstat(files, '', '')).toEqual(files)
  })
})

describe('parseHead', () => {
  test('reads sha, subject and a compact age', async () => {
    expect(parseHead('abc1234\tfeat: add the git tab\t3 minutes ago\n')).toEqual({ age: '3m ago', sha: 'abc1234', subject: 'feat: add the git tab' })
    expect(parseHead('abc1234\tx\t2 years, 3 months ago\n')?.age).toBe('2y 3mo ago')
    expect(parseHead('abc1234\tx\t1 hour ago')?.age).toBe('1h ago')
  })

  test('an empty log, a repository with no commit, reads as nothing', async () => {
    expect(parseHead('')).toBeUndefined()
    expect(parseHead('\n')).toBeUndefined()
  })
})

describe('parsePreview', () => {
  const header = ['diff --git a/x.sql b/x.sql', 'index 1111111..2222222 100644', '--- a/x.sql', '+++ b/x.sql']

  test('drops the file header and keeps the hunk, even body lines that look like a header', async () => {
    const stdout = [...header, '@@ -1,4 +1,4 @@', ' select 1;', '--- old comment', '+-- new comment', '+++ counter', '\\ No newline at end of file', ''].join('\n')

    expect(parsePreview(stdout)).toEqual({
      isTruncated: false,
      lines: ['@@ -1,4 +1,4 @@', ' select 1;', '--- old comment', '+-- new comment', '+++ counter', '\\ No newline at end of file'],
    })
  })

  test('an untracked file diffed against /dev/null', async () => {
    const stdout = ['diff --git a/new.txt b/new.txt', 'new file mode 100644', 'index 0000000..e69de29', '--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1,2 @@', '+one', '+two', ''].join('\n')

    expect(parsePreview(stdout).lines).toEqual(['@@ -0,0 +1,2 @@', '+one', '+two'])
  })

  test('a binary file keeps its one line so the preview is not empty', async () => {
    const stdout = ['diff --git a/logo.png b/logo.png', 'new file mode 100644', 'index 0000000..abcdef0', 'Binary files /dev/null and b/logo.png differ', ''].join('\n')

    expect(parsePreview(stdout).lines).toEqual(['Binary files /dev/null and b/logo.png differ'])
  })

  test('truncates past max', async () => {
    const body = Array.from({ length: 30 }, (_, index) => `+line ${index}`)
    const stdout = [...header, '@@ -0,0 +1,30 @@', ...body, ''].join('\n')
    const preview = parsePreview(stdout)

    expect(preview.lines).toHaveLength(24)
    expect(preview.isTruncated).toBe(true)
    expect(parsePreview(stdout, 31)).toMatchObject({ isTruncated: false })
    expect(parsePreview(stdout, 31).lines).toHaveLength(31)
    expect(parsePreview('')).toEqual({ isTruncated: false, lines: [] })
  })
})

describe('isGitChange', () => {
  test('commands that change the working tree or refs', async () => {
    for (const command of [
      'git add -A',
      'git commit -m "x"',
      'cd repo && git checkout -b feat',
      'git -C ../app stash pop',
      'git -c commit.gpgsign=false commit -m x',
      'git --no-pager reset --hard',
      '/usr/bin/git rm x',
      'git status && git add .',
      'git switch main',
      'git restore --staged a.ts',
      'git merge main',
      'git rebase main',
      'git pull --ff-only',
      'git push origin HEAD',
      'git mv a b',
      'git cherry-pick abc',
      'git revert HEAD',
      'git apply p.diff',
    ]) {
      expect([command, isGitChange(command)]).toEqual([command, true])
    }
  })

  test('read-only git and other tools', async () => {
    for (const command of ['git status', 'git diff --cached', 'git log --grep commit', 'git show HEAD:add.ts', 'gh pr merge 12', 'legit add x', 'git commit-tree abc', 'echo add']) {
      expect([command, isGitChange(command)]).toEqual([command, false])
    }
  })
})

describe('changes tab rows', () => {
  test('shortPath keeps the parent and the name when the full path does not fit', async () => {
    expect(shortPath('hooks/lib/git.ts', 40)).toBe('hooks/lib/git.ts')
    expect(shortPath('very/long/nested/path/to/parent/file.ts', 20)).toBe('…/parent/file.ts')
    expect(shortPath('a/really-long-parent-folder-name/file.ts', 14)).toBe('…/file.ts')
    expect(shortPath('a/b/a-file-name-that-is-long.ts', 10)).toBe('a-file-na…')
    expect(shortPath('deep/nested/dir/', 12)).toBe('…/dir/')
  })

  test('a row label right-aligns the counts and never exceeds the width', async () => {
    const file = { added: 12, area: 'unstaged' as const, code: 'M', path: 'hooks/tabs/changes.tsx', removed: 3 }
    const label = rowLabel(file, 40, false)

    expect(label).toBe('M   hooks/tabs/changes.tsx        +12 −3')
    expect(cells(label)).toBe(40)
    expect(rowLabel(file, 40, true).startsWith('M · hooks')).toBe(true)
    expect(rowLabel({ area: 'untracked', code: '?', path: 'new.txt' }, 40, false)).toBe('?   new.txt')
    expect(rowLabel({ area: 'staged', code: 'R', from: 'a.ts', path: 'b.ts' }, 40, false)).toBe('R   a.ts → b.ts')
    expect(cells(rowLabel({ ...file, path: 'x/'.repeat(40) + 'deep.ts' }, 30, true))).toBeLessThanOrEqual(30)
  })

  test('the session marker matches an absolute edit path to a repository-relative path', async () => {
    const edits = [{ path: '/Users/me/app/hooks/lib/git.ts' }]

    expect(isEditedThisSession('hooks/lib/git.ts', edits)).toBe(true)
    expect(isEditedThisSession('lib/git.ts', edits)).toBe(true)
    expect(isEditedThisSession('git.ts.bak', edits)).toBe(false)
    expect(isEditedThisSession('ib/git.ts', edits)).toBe(false)
  })

  test('previewText keeps indentation, expands tabs and clips to the width', async () => {
    expect(previewText('+    indented', 20)).toBe('+    indented')
    expect(previewText('+\tx\r', 20)).toBe('+  x')
    expect(previewText(`+${'y'.repeat(30)}`, 10)).toBe('+yyyyyyyy…')
  })
})
