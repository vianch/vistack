// The git realm: the one host and owner whose repositories the deck may run git or gh
// against, e.g. "github.com/your-org". Set in the deck's Settings tab (kept in $.store, so it
// stays out of settings files) or by the userConfig `realm` option; unset, the deck runs no
// git or gh at all.

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

export type RealmSource = 'deck' | 'plugin option' | 'unset'

// The realm set in the deck wins over the plugin option.
export const effectiveRealm = (deck: string, option: string): { realm: string; source: RealmSource } => {
  if (normalizeRealm(deck) !== '') {
    return { realm: normalizeRealm(deck), source: 'deck' }
  }

  return normalizeRealm(option) === '' ? { realm: '', source: 'unset' } : { realm: normalizeRealm(option), source: 'plugin option' }
}

// "github.com/acme" → host and owner; null unless the realm names both.
export const realmParts = (realm: string): { host: string; owner: string } | null => {
  const [host, owner, ...rest] = normalizeRealm(realm).split('/')

  return host === undefined || host === '' || owner === undefined || owner === '' || rest.length > 0 ? null : { host, owner }
}
