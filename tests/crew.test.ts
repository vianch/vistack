import { describe, expect, test } from 'claude-code/testing'

import { face, nickname, NAMES, roleOf, RUNNING } from '../hooks/lib/crew'
import type { Role } from '../hooks/lib/crew'

const MIN_POOL = 50
const MIN_FRAMES = 6
const MAX_CELLS = 16
const TYPE_OF: Readonly<Record<Role, string>> = {
  advisor: 'vistack:advisor',
  builder: 'vistack:implementer',
  captain: 'vistack:coordinator',
  critic: 'vistack:qa-verifier',
  helper: 'vistack:devops',
  scholar: 'vistack:docs-writer',
  scout: 'Explore',
  wizard: 'vistack:senior-implementer',
}
const ROLES = Object.keys(NAMES) as Role[] // keys of a Record<Role, _> are exactly the roles

describe('crew name pools', () => {
  test('there are eight roles and each sample type maps back to its role', async () => {
    expect(ROLES.length).toBe(8)

    for (const role of ROLES) {
      expect(roleOf(TYPE_OF[role])).toBe(role)
    }
  })

  test('each pool holds at least 50 unique, ASCII names of at most 16 cells', async () => {
    for (const role of ROLES) {
      const pool = NAMES[role]

      expect(pool.length).toBeGreaterThanOrEqual(MIN_POOL)
      expect(new Set(pool).size).toBe(pool.length)

      for (const name of pool) {
        expect(/^[\x20-\x7e]+$/.test(name)).toBe(true)
        expect(name.length).toBeLessThanOrEqual(MAX_CELLS)
      }
    }
  })
})

describe('crew name catalogue', () => {
  test('names are unique across every role, ignoring case', async () => {
    const everyName = ROLES.flatMap(role => [...NAMES[role]])
    const lowered = everyName.map(name => name.toLowerCase())

    expect(new Set(lowered).size).toBe(everyName.length)
  })

  test('every name is printable ASCII of 1 to 16 characters with no edge spaces', async () => {
    for (const role of ROLES) {
      for (const name of NAMES[role]) {
        expect(/^[\x20-\x7e]{1,16}$/.test(name)).toBe(true)
        expect(name).toBe(name.trim())
      }
    }
  })
})

describe('nickname', () => {
  test('returns a name from the role pool and never a taken one', async () => {
    for (const role of ROLES) {
      const pool = NAMES[role]
      const taken: string[] = []

      for (let count = 0; count < pool.length; count += 1) {
        const name = nickname(TYPE_OF[role], 'agent-1', taken)

        expect(pool).toContain(name)
        expect(taken).not.toContain(name)
        taken.push(name)
      }

      expect(new Set(taken).size).toBe(pool.length)
    }
  })

  test('skips a taken name and still lands in the pool', async () => {
    for (const role of ROLES) {
      const first = nickname(TYPE_OF[role], 'agent-7', [])
      const second = nickname(TYPE_OF[role], 'agent-7', [first])

      expect(NAMES[role]).toContain(first)
      expect(NAMES[role]).toContain(second)
      expect(second).not.toBe(first)
    }
  })

  test('suffixes a number once the pool is exhausted', async () => {
    const pool = NAMES.scout
    const name = nickname('Explore', 'agent-1', [...pool])

    expect(pool.some(base => name.startsWith(base))).toBe(true)
    expect(pool).not.toContain(name)
    expect(name).toMatch(/ \d+$/)
  })
})

describe('roleOf', () => {
  test('maps agent types to roles', async () => {
    expect(roleOf('vistack:advisor')).toBe('advisor')
    expect(roleOf('Explore')).toBe('scout')
    expect(roleOf('vistack:researcher')).toBe('scholar')
    expect(roleOf('vistack:implementer')).toBe('builder')
    expect(roleOf('vistack:devops')).toBe('helper')
    expect(roleOf('something-unknown')).toBe('helper')
  })
})

describe('face', () => {
  test('every running frame of a role has one width, and there are at least six', async () => {
    for (const role of ROLES) {
      const frames = RUNNING[role]

      expect(frames.length).toBeGreaterThanOrEqual(MIN_FRAMES)
      expect(new Set(frames.map(frame => frame.length)).size).toBe(1)
    }
  })

  test('face walks the frames of its role and wraps around', async () => {
    for (const role of ROLES) {
      const frames = RUNNING[role]
      const seen = frames.map((_frame, tick) => face(TYPE_OF[role], 'running', tick))

      expect(seen).toEqual([...frames])
      expect(face(TYPE_OF[role], 'running', frames.length)).toBe(frames[0])
    }
  })

  test('failed agents show x_x', async () => {
    expect(face('x', 'failed', 0)).toContain('x_x')
  })

  test('every still status keeps the running width', async () => {
    const width = RUNNING.scout[0]?.length

    for (const status of ['completed', 'failed', 'idle', 'killed', 'pending', 'waiting', 'unknown']) {
      expect(face('Explore', status, 0).length).toBe(width)
    }
  })
})
