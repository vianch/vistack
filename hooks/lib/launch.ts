// lazygit needs a terminal of its own: a mod cannot hand the session's terminal to a child.
// So the deck opens it beside the session (a tmux split, or a new terminal window) and
// closes it the same way. Pure argv builders; register.tsx runs them.
export type Launcher = 'auto' | 'tmux' | 'ghostty' | 'terminal' | 'iterm'

export type LaunchPlan = { how: Exclude<Launcher, 'auto'>; open: string[]; close: (handle: string) => string[] }

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`

// The pattern `lazygit -p <cwd>`, anchored, names this session's lazygit and nothing else's:
// /a/repo never matches a lazygit open in /a/repo-2.
export const lazygitMarker = (cwd: string): string => `lazygit -p ${escapeRegex(cwd)}$`

const closeByMarker = (cwd: string) => (): string[] => ['pkill', '-f', lazygitMarker(cwd)]

export const pickLauncher = (wanted: Launcher, env: { tmux?: string; termProgram?: string }): Exclude<Launcher, 'auto'> => {
  if (wanted !== 'auto') {
    return wanted
  }
  if (env.tmux !== undefined && env.tmux !== '') {
    return 'tmux'
  }
  if (env.termProgram === 'ghostty') {
    return 'ghostty'
  }
  if (env.termProgram === 'iTerm.app') {
    return 'iterm'
  }

  return 'terminal'
}

export const launchPlan = (how: Exclude<Launcher, 'auto'>, cwd: string): LaunchPlan => {
  const command = `cd ${shellQuote(cwd)} && exec lazygit -p ${shellQuote(cwd)}`

  switch (how) {
    case 'tmux':
      return {
        close: handle => ['tmux', 'kill-pane', '-t', handle],
        how,
        open: ['tmux', 'split-window', '-h', '-P', '-F', '#{pane_id}', '-c', cwd, 'lazygit', '-p', cwd],
      }
    case 'ghostty':
      return {
        close: closeByMarker(cwd),
        how,
        open: ['open', '-na', 'Ghostty.app', '--args', `--working-directory=${cwd}`, '-e', 'lazygit', '-p', cwd],
      }
    case 'iterm':
      return {
        close: closeByMarker(cwd),
        how,
        open: [
          'osascript',
          '-e',
          `tell application "iTerm" to create window with default profile command ${JSON.stringify(`sh -c ${shellQuote(command)}`)}`,
        ],
      }
    case 'terminal':
      return {
        close: closeByMarker(cwd),
        how,
        open: ['osascript', '-e', `tell application "Terminal" to do script ${JSON.stringify(command)}`],
      }
  }
}
