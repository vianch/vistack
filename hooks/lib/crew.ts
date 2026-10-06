// Nicknames and animated faces for subagents. ASCII only: wide glyphs and emoji break the
// column math of a docked pane.
export type Role = 'advisor' | 'scout' | 'scholar' | 'builder' | 'wizard' | 'critic' | 'captain' | 'helper'

const ROLE_OF: readonly (readonly [RegExp, Role])[] = [
  [/advis/, 'advisor'],
  [/devops|infra|pipeline|deploy/, 'helper'],
  [/explore|analyst|scout|search/, 'scout'],
  [/research|docs|guide/, 'scholar'],
  [/senior|architect|design-runner/, 'wizard'],
  [/implement|builder|code-simplifier|engineer/, 'builder'],
  [/review|health|verif|qa|audit|security|critic/, 'critic'],
  [/plan|coordinat|groom|pr-author|unblock|orchestr/, 'captain'],
]

const NAMES: Readonly<Record<Role, readonly string[]>> = {
  advisor: ['The Oracle', 'Sage', 'Athena', 'Wise Owl', 'Mentor'],
  builder: ['Bob the Builder', 'Wrench', 'Hammerhead', 'Tinker', 'Sprocket'],
  captain: ['Captain Hook', 'Maestro', 'Air Traffic', 'Tetris', 'Skipper'],
  critic: ['Grumpy Cat', 'Hawkeye', 'Nitpick', 'Judge Dredd', 'Red Pen'],
  helper: ['Gizmo', 'Noodle', 'Biscuit', 'Pixel', 'Pickles'],
  scholar: ['Prof. Hoot', 'Doc Brown', 'Bookworm', 'Encyclo', 'Footnote'],
  scout: ['Sherlock', 'Dora', 'Magellan', 'Columbo', 'Radar'],
  wizard: ['Gandalf', 'Yoda', 'Merlin', 'Morpheus', 'Dumbledore'],
}

// Every frame of a role has the same width, so a row never jitters.
const RUNNING: Readonly<Record<Role, readonly string[]>> = {
  advisor: ['(O,O)  ', '(o,O)  ', '(O,o)  ', '(O,O)~ '],
  builder: ['(o_o)/ ', '(o_o)--', '(o_o)\\ ', '(o_o)--'],
  captain: ['(^_^)> ', '(^_~)> ', '(^_^)> ', '(^o^)> '],
  critic: ['(-_o)  ', '(o_-)  ', '(-_o)  ', '(o_o)  '],
  helper: ['(o_o)  ', '(o_o)  ', '(-_-)  ', '(o_o)  '],
  scholar: ['(o_O)? ', '(O_o)? ', '(o_O)! ', '(O_o)? '],
  scout: ['(o_o ) ', '( o_o) ', '(o_o ) ', '( o_o) '],
  wizard: ['(o_o)* ', '(o_o)+ ', '(o_o). ', '(o_o)+ '],
}

const STILL: Readonly<Record<string, string>> = {
  completed: '(^_^)  ',
  failed: '(x_x)  ',
  idle: '(-_-)z ',
  killed: '(x_x)  ',
  pending: '(._.)  ',
  waiting: '(o_o)? ',
}

const hash = (text: string): number => {
  let value = 0

  for (const char of text) {
    value = (value * 31 + char.charCodeAt(0)) >>> 0
  }

  return value
}

export const roleOf = (type: string): Role => {
  const lower = type.toLowerCase()
  const found = ROLE_OF.find(([pattern]) => pattern.test(lower))

  return found ? found[1] : 'helper'
}

export const nickname = (type: string, agentId: string, taken: readonly string[]): string => {
  const pool = NAMES[roleOf(type)]
  const start = hash(agentId) % pool.length

  for (let offset = 0; offset < pool.length; offset += 1) {
    const name = pool[(start + offset) % pool.length] ?? 'Gizmo'

    if (!taken.includes(name)) {
      return name
    }
  }

  const base = pool[start] ?? 'Gizmo'
  const count = taken.filter(name => name.startsWith(base)).length

  return `${base} ${count + 1}`
}

export const isLive = (status: string): boolean => status === 'running' || status === 'pending'

export const face = (type: string, status: string, tick: number): string => {
  if (status === 'running') {
    const frames = RUNNING[roleOf(type)]

    return frames[tick % frames.length] ?? '(o_o)  '
  }

  return STILL[status] ?? '(-_-)  '
}
