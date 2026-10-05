export const tokens = (count: number | undefined): string => {
  if (count === undefined) {
    return '-'
  }
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`
  }
  if (count >= 10_000) {
    return `${Math.round(count / 1000)}k`
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`
  }

  return String(count)
}

export const usd = (amount: number | null | undefined): string => {
  if (amount === null || amount === undefined) {
    return '≈?'
  }
  if (amount > 0 && amount < 0.01) {
    return '<$0.01'
  }

  return `$${amount.toFixed(2)}`
}

export const duration = (ms: number | undefined): string => {
  if (ms === undefined) {
    return '-'
  }
  if (ms < 1000) {
    return `${(ms / 1000).toFixed(1)}s`
  }

  const seconds = Math.round(ms / 1000)

  if (seconds < 60) {
    return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) {
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  }

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export const ago = (then: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - then) / 1000))

  if (seconds < 60) {
    return `${seconds}s ago`
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`
  }

  return `${Math.floor(seconds / 86_400)}d ago`
}

export const until = (iso: string | undefined, now: number): string => {
  if (iso === undefined) {
    return ''
  }

  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000))

  if (Number.isNaN(minutes)) {
    return ''
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  if (minutes < 1440) {
    return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
  }

  return `${Math.floor(minutes / 1440)}d${Math.floor((minutes % 1440) / 60)}h`
}

export const percent = (part: number, whole: number): string =>
  whole <= 0 ? '0%' : `${Math.round((part / whole) * 100)}%`

export const bar = (fraction: number, width: number): { full: string; empty: string } => {
  const size = Math.max(1, width)
  const filled = Math.min(size, Math.max(0, Math.round(fraction * size)))

  return { full: '█'.repeat(filled), empty: '░'.repeat(size - filled) }
}

export const fit = (text: string, width: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  if (width <= 1) {
    return flat.slice(0, Math.max(0, width))
  }

  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`
}

export const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

// "~/…/parent/" for a path, so two files of one name stay apart.
export const parentHint = (path: string, home: string | undefined): string => {
  const parts = path.split('/').filter(Boolean)
  const parent = parts.slice(-2, -1)[0]

  if (parent === undefined) {
    return '/'
  }

  return home !== undefined && path.startsWith(home) ? `~/…/${parent}/` : `…/${parent}/`
}
