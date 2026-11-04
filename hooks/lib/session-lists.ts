import { field } from './ledger'

import type { DeckSkill, DeckTodo } from '../../types'

export const SKILL_CAP = 60

export const recordSkill = (list: readonly DeckSkill[], entry: DeckSkill): DeckSkill[] => [...list, entry].slice(-SKILL_CAP)

/**
 * The row a finished TaskCreate call adds. The engine assigns the task id, so it is read from
 * the call's result; a result without one yields null rather than a guessed id.
 * @param input The TaskCreate call's arguments.
 * @param result The TaskCreate call's result, `{ task: { id, subject } }`.
 * @returns The pending row, or null when the result carries no id.
 */
export const createdTask = (input: unknown, result: unknown): DeckTodo | null => {
  const task = field(result, 'task')
  const id = field(task, 'id')

  if (typeof id !== 'string' || id === '') {
    return null
  }

  const subject = field(task, 'subject') ?? field(input, 'subject')

  return { content: typeof subject === 'string' ? subject : '', id, status: 'pending' }
}

export const withTask = (list: readonly DeckTodo[], task: DeckTodo): DeckTodo[] => [...list.filter(todo => todo.id !== task.id), task]
