// Reads viStack run state as written by skills/coordinate: <state-root>/<slug>.json is where
// the run is, <slug>.tsv the append-only ledger (ts phase slice decision reason evidence result).
import type { DeckPr, DeckRun, DeckSlice } from '../../types'

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

export const parseRun = (slug: string, root: string, source: string): DeckRun | null => {
  let value: unknown

  try {
    value = JSON.parse(source)
  } catch {
    return null
  }

  const run = record(value)
  const slices: DeckSlice[] = Object.entries(record(run.slices)).map(([id, raw]) => {
    const slice = record(raw)
    const blockers = Array.isArray(slice.blockers) ? slice.blockers.length : 0
    const pr = slice.pr === null || slice.pr === undefined ? undefined : String(slice.pr)
    const fields = {
      agent: str(slice.agent),
      branch: str(slice.branch),
      model: str(slice.model),
      phase: str(slice.phase),
      pr,
      worktree: str(slice.worktree),
    }

    return {
      blockers,
      id,
      ...Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== undefined)),
    }
  })
  const monitor = record(run.monitor)
  const fields = {
    mode: str(run.mode),
    monitor: str(monitor.status),
    objective: str(run.objective),
    playbook: str(run.playbook),
  }

  return {
    root,
    slices,
    slug: str(run.slug) ?? slug,
    ...Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== undefined)),
  }
}

// "phase · decision · result" of the ledger's last row.
export const lastLedgerRow = (source: string): string | undefined => {
  const rows = source.split('\n').filter(row => row.trim() !== '')
  const last = rows[rows.length - 1]

  if (last === undefined) {
    return undefined
  }

  const [ts, phase, slice, decision, , , result] = last.split('\t')

  return [ts?.slice(11, 16), phase, slice, decision, result].filter(part => part !== undefined && part !== '').join(' · ')
}

// The branch a HEAD file names, or a short commit when detached.
export const headBranch = (head: string): string | undefined => {
  const ref = /^ref:\s*refs\/heads\/(.+)$/m.exec(head)

  if (ref?.[1] !== undefined) {
    return ref[1].trim()
  }

  const sha = head.trim()

  return /^[0-9a-f]{7,}$/.test(sha) ? sha.slice(0, 7) : undefined
}

// A worktree's `.git` file: "gitdir: /repo/.git/worktrees/<name>".
export const gitdirOf = (dotGit: string): string | undefined => /^gitdir:\s*(.+)$/m.exec(dotGit)?.[1]?.trim()

type GhCheck = { conclusion?: string; status?: string; state?: string; name?: string; context?: string }

export const checksSummary = (rollup: readonly GhCheck[]): { checks: string; failing: string[] } => {
  if (rollup.length === 0) {
    return { checks: 'none', failing: [] }
  }

  const failing = rollup
    .filter(check => /FAIL|ERROR|CANCEL|TIMED_OUT|ACTION_REQUIRED/.test(`${check.conclusion ?? ''}${check.state ?? ''}`))
    .map(check => check.name ?? check.context ?? 'check')
  const pending = rollup.filter(
    check => check.status !== undefined && check.status !== 'COMPLETED' && check.conclusion === undefined,
  ).length

  if (failing.length > 0) {
    return { checks: 'failing', failing }
  }

  return { checks: pending > 0 ? 'pending' : 'passing', failing }
}

const PR_SEARCH_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 30) {
    nodes {
      ... on PullRequest {
        number title url isDraft headRefName reviewDecision
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 50) { nodes {
          __typename
          ... on CheckRun { name conclusion status }
          ... on StatusContext { context state }
        } } } } } }
      }
    }
  }
}`

// One GraphQL search for the person's open PRs across the realm owner's repositories only.
export const prSearchArgs = (realm: { host: string; owner: string }, qualifier: 'user' | 'org'): string[] => [
  'gh',
  'api',
  'graphql',
  ...(realm.host === 'github.com' ? [] : ['--hostname', realm.host]),
  '-f',
  `query=${PR_SEARCH_QUERY}`,
  '-f',
  `q=is:pr is:open author:@me ${qualifier}:${realm.owner} archived:false`,
]

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

// A check-run or status context with GraphQL's nulls dropped; a pending status counts as running.
const checkOf = (raw: unknown): GhCheck => {
  const node = record(raw)
  const state = str(node.state)

  return {
    ...(str(node.name) === undefined ? {} : { name: str(node.name) }),
    ...(str(node.context) === undefined ? {} : { context: str(node.context) }),
    ...(str(node.conclusion) === undefined ? {} : { conclusion: str(node.conclusion) }),
    ...(str(node.status) === undefined ? {} : { status: str(node.status) }),
    ...(state === undefined ? {} : { state }),
    ...(state === 'PENDING' || state === 'EXPECTED' ? { status: 'IN_PROGRESS' } : {}),
  }
}

export const parsePrSearch = (stdout: string): DeckPr[] => {
  let value: unknown

  try {
    value = JSON.parse(stdout)
  } catch {
    return []
  }

  return list(record(record(record(value).data).search).nodes)
    .map(record)
    .filter(pr => typeof pr.number === 'number')
    .map(pr => {
      const commit = record(record(list(record(pr.commits).nodes)[0]).commit)
      const contexts = list(record(record(commit.statusCheckRollup).contexts).nodes).map(checkOf)

      return {
        branch: str(pr.headRefName) ?? '',
        isDraft: pr.isDraft === true,
        number: pr.number as number,
        repo: str(record(pr.repository).nameWithOwner) ?? '',
        review: str(pr.reviewDecision) ?? 'NONE',
        title: str(pr.title) ?? '',
        url: str(pr.url) ?? '',
        ...checksSummary(contexts),
      }
    })
}

// A shell command that opens, closes or changes a PR, after which the PR list is stale.
export const isPrChange = (command: string): boolean =>
  /\bgh\s+pr\s+(create|ready|reopen|close|merge)\b/.test(command) || /\bgh\s+api\b.*\/pulls\b/.test(command)
