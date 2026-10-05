// The git realm: the one host and owner whose repositories the deck may run git or gh
// against. Configured per machine (userConfig `realm`, e.g. "github.com/your-org"); unset,
// the deck runs no git or gh at all.

// git@host:owner/repo.git, ssh://git@host/owner/repo, https://host/owner/repo(.git)
export const normalizeRemote = (remote: string): string | null => {
  const trimmed = remote.trim()
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(trimmed)
  const url = /^[a-z+]+:\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+)$/i.exec(trimmed)
  const match = scp ?? url

  if (match === null) {
    return null
  }

  const host = (match[1] ?? '').toLowerCase()
  const path = (match[2] ?? '').replace(/\.git$/, '').replace(/\/+$/, '')

  return `${host}/${path}`
}

export const normalizeRealm = (realm: string): string =>
  realm
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/\*?$/, '')
    .toLowerCase()

export const isInRealm = (remote: string | null | undefined, realm: string): boolean => {
  const wanted = normalizeRealm(realm)

  if (wanted === '' || remote === null || remote === undefined) {
    return false
  }

  const origin = normalizeRemote(remote)

  return origin !== null && origin.toLowerCase().startsWith(`${wanted}/`)
}
