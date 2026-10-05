// Session recall: pair each prompt with the answer that followed it, then search the pairs.
export type RecallPair = { id: string; ask: string; answer: string; position: number }

export type RecallHit = RecallPair & { score: number; snippet: string }

type Row = { role: string; text: string }

export const pairs = (rows: readonly Row[]): RecallPair[] => {
  const found: RecallPair[] = []
  let current: RecallPair | null = null

  rows.forEach((row, position) => {
    const text = row.text.trim()

    if (row.role === 'user') {
      if (text === '' || text.startsWith('<')) {
        return
      }
      if (current !== null) {
        found.push(current)
      }
      current = { answer: '', ask: text, id: `ask-${position}`, position }

      return
    }
    if (row.role === 'assistant' && current !== null && text !== '') {
      current = { ...current, answer: current.answer === '' ? text : `${current.answer}\n\n${text}` }
    }
  })

  if (current !== null) {
    found.push(current)
  }

  return found
}

// Words, with "quoted phrases" kept whole.
export const terms = (query: string): string[] => {
  const found: string[] = []
  const pattern = /"([^"]+)"|(\S+)/g
  let match = pattern.exec(query)

  while (match !== null) {
    const term = (match[1] ?? match[2] ?? '').trim().toLowerCase()

    if (term !== '') {
      found.push(term)
    }
    match = pattern.exec(query)
  }

  return found
}

const count = (haystack: string, needle: string): number => {
  let total = 0
  let from = haystack.indexOf(needle)

  while (from !== -1) {
    total += 1
    from = haystack.indexOf(needle, from + needle.length)
  }

  return total
}

const snippetOf = (text: string, needle: string, width: number): string => {
  const at = text.toLowerCase().indexOf(needle)

  if (at === -1) {
    return text.slice(0, width)
  }

  const start = Math.max(0, at - Math.floor(width / 3))
  const slice = text.slice(start, start + width)

  return `${start > 0 ? '…' : ''}${slice}${start + width < text.length ? '…' : ''}`
}

// Every term must appear in the ask or the answer; a hit in the ask weighs double.
export const search = (list: readonly RecallPair[], query: string, limit = 20): RecallHit[] => {
  const wanted = terms(query)

  if (wanted.length === 0) {
    return list
      .slice(-limit)
      .reverse()
      .map(pair => ({ ...pair, score: 0, snippet: pair.answer.slice(0, 120) }))
  }

  return list
    .map(pair => {
      const ask = pair.ask.toLowerCase()
      const answer = pair.answer.toLowerCase()
      const isMatch = wanted.every(term => ask.includes(term) || answer.includes(term))
      const score = wanted.reduce((sum, term) => sum + 2 * count(ask, term) + count(answer, term), 0)
      const first = wanted[0] ?? ''

      return { ...pair, isMatch, score, snippet: snippetOf(pair.answer, first, 120) }
    })
    .filter(hit => hit.isMatch)
    .sort((left, right) => right.score - left.score || right.position - left.position)
    .slice(0, limit)
    .map(({ isMatch: _unused, ...hit }) => hit)
}
