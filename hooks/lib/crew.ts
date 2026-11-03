// Nicknames and animated faces for subagents. ASCII only: wide glyphs and emoji break the
// column math of a docked pane.
export type Role = 'advisor' | 'scout' | 'scholar' | 'builder' | 'wizard' | 'critic' | 'captain' | 'helper'

const ROLE_OF: readonly (readonly [RegExp, Role])[] = [
  [/advis/, 'advisor'],
  [/devops|infra|pipeline|deploy/, 'helper'],
  [/research|docs|guide/, 'scholar'],
  [/explore|analyst|scout|search/, 'scout'],
  [/senior|architect|design-runner/, 'wizard'],
  [/implement|builder|code-simplifier|engineer/, 'builder'],
  [/review|health|verif|qa|audit|security|critic/, 'critic'],
  [/plan|coordinat|groom|pr-author|unblock|orchestr/, 'captain'],
]

export const NAMES: Readonly<Record<Role, readonly string[]>> = {
  advisor: [
    'The Oracle', 'Sage', 'Athena', 'Wise Owl', 'Mentor', "Gandalf's Aunt", 'Magic 8-Ball', 'Obi-Wan Kenobi',
    'Fortune Cookie', "Yoda's Cousin", 'Ask Jeeves', 'The Dude', 'Zoltar', 'Hindsight', 'Crystal Ball', 'Delphi',
    'Counsel', 'Sentinel', 'Cipher', 'Axon', 'Quipster', 'Wit-Whiz', 'Pun-Master', 'The Answer Man', 'Sir Talks-a-Lot',
    'Chatterbox', 'Wisecracker', 'Jester', 'Banternaut', 'Bot-ilda', 'AI-Caramba', 'Clever-Clogs', 'Hunch',
    'Second Opinion', 'Fortune Teller', 'Tea Leaves', 'Tarot Terry', 'Palm Reader', 'Armchair Expert', 'Grey Beard',
    'Elder Bot', 'Hot Take', 'Cold Take', 'Think Tank', 'Brain Trust', 'Dear Abby', 'Sage Advice', 'Rubber Duck',
    'Wise Guy', 'Pep Talk', 'Voice of Reason', 'Gut Feeling', 'Mind Reader', 'Guru Gary', 'Napkin Math', 'Bot Marley',
    'Meme Lord', 'Glitches-a-Lot',
  ],
  builder: [
    'Bob the Builder', 'Wrench', 'Hammerhead', 'Tinker', 'Sprocket', 'Duct Tape', 'Lego Larry', 'Rivet', 'Spanner',
    'Allen Key', 'Nailgun', 'Torque', 'Jigsaw', 'Mario', 'Wall-E', 'Scaffold',
    'Build Battle Bob', 'Hardhat Harry', 'Ctrl Alt Delight', 'Jest In Time', 'Works On My Box', 'Legacy Whisperer',
    'Keyboard Warrior', 'Cobot', 'git-revert-man', 'Vector', 'Pascal', 'Welder Wendy', 'Crowbar', 'Plumb Bob',
    'Level Lenny', 'Sawdust', 'Drill Bill', 'Pliers', 'Mortar Mike', 'Bricklayer', 'Blueprint', 'Forklift Fred',
    'Crane Operator', 'Cement Mixer', 'Jackhammer', 'Tape Measure', 'Hot Glue', 'Zip Tie', 'Bolt Cutter', 'Wood Chip',
    'Pipe Wrench', 'Sander Sam', 'Chisel', 'Gear Head', 'Turbo Turtle', 'Cobbler', 'Sledgehammer', 'Stud Finder',
    'Rebar Ray', 'Dovetail', 'Caulk Gun', 'Bulldozer Bill',
  ],
  captain: [
    'Captain Hook', 'Maestro', 'Air Traffic', 'Tetris', 'Skipper', 'Captain Obvious', 'Picard', 'Kirk', 'Gantt Chart',
    'Jira Jim', 'Herding Cats', 'Scrum Lord', 'Drill Sergeant', 'Conductor', 'Jack Sparrow', 'Admiral Ackbar',
    "Cap'n Caps Lock", 'Buffering Betty', 'Deadline Dodger', 'Infinite Loop', 'Navigator', 'Sir Wobblesworth',
    'Sir Fumblefoot', 'Cupcake Commando', 'Clipboard Carl', 'Whistle Blower', 'Traffic Cone', 'Herd Mentality',
    'Sprint Sally', 'Standup Stan', 'Backlog Barry', 'Roadmap Rita', 'Kanban Kev', 'Gavel', 'Baton', 'Compass',
    'First Mate', 'Bosun', 'Quartermaster', "Ship's Cat", "Crow's Nest", 'Sea Legs', 'Anchor Man', 'Foghorn',
    'Pirate Pete', 'Flag Ship', 'Jolly Roger', 'Dock Master', 'Bridge Crew', 'Tugboat', 'Meeting Maven',
    'Calendar Carl', 'Agenda Annie', 'Milestone Mo', 'Ahoy Matey', 'Big Cheese', 'Head Honcho', 'Top Banana',
    'Bossy Boots',
  ],
  critic: [
    'Grumpy Cat', 'Hawkeye', 'Nitpick', 'Judge Dredd', 'Red Pen', 'Statler', 'Waldorf', 'Lint Roller', 'Spellcheck',
    'Comic Book Guy', 'Karen', 'Fact Checker', 'Squidward', 'Eeyore', 'Sour Patch', 'Gargamel',
    'Error 404', 'SegFault', 'Motivation 404', 'Verity', 'Stack Trace', 'Null Pointer', 'Off By One', 'Race Condition',
    'Heisenbug', 'Flaky Test', 'Red Test', 'Green Light', 'Bug Squasher', 'Linter Lou', 'Type Checker', 'Pedant',
    'Sourpuss', 'Skeptic Sam', "Devil's Advocate", 'Doubting Thomas', 'Eagle Eye', 'Fine Comb', 'Magnifier', 'Gotcha',
    'Rubber Stamp', 'Stern Look', 'Raised Eyebrow', 'Tough Crowd', 'Heckler', 'Boo Bird', 'Hard Pass', 'Side Eye',
    'Plot Hole', 'Code Smell', 'Dead Code', 'Spaghetti Code', 'Quality Quinn', 'Test Pilot', 'Smoke Test',
    'Crash Dummy', 'Bug Bounty', 'Audit Trail', 'Red Flag', 'Potato Aim Pete',
  ],
  helper: [
    'Gizmo', 'Noodle', 'Biscuit', 'Pixel', 'Pickles', 'Waffles', 'Clippy', 'Roomba', 'Swiss Army', 'WD-40', 'Jarvis',
    'Alfred', 'Rosie', 'Marvin', 'Baymax', 'Tamagotchi',
    'Buddy', 'Pip', 'Chip', 'Honey', 'Cheerio', 'Cozy', 'Shield', 'Vault', 'Steward', 'Pancake', 'Wobble',
    'Snickerdoodle', 'Fluffernutter', 'Banana Split', 'Grumpy Toast', 'Sock Puppet', 'Jellybean', 'Sneaky Pickle',
    'Chunky Monkey', 'Doodlebug', 'Toe Beans', 'Double Dip', 'Cheddar Chaos', 'Pretzel Panic', 'Stapler Ninja',
    'Printer Jammer', 'Copier Chaos', 'Inbox Invader', 'Waffle Whisperer', 'Nacho Ninja', 'Banana Bandit',
    'Bacon Bandit', 'Cupcake', 'Muffin', 'Peanut', 'Button', 'Dumpling', 'Pudding', 'Cuddles',
  ],
  scholar: [
    'Prof. Hoot', 'Doc Brown', 'Bookworm', 'Encyclo', 'Footnote', 'Wikipedia Wayne', 'Dewey Decimal', 'Citation Needed',
    'Hermione', 'Card Catalog', 'Page Turner', 'Librarian Larry', 'RTFM', 'Appendix', 'Prof. Plum', 'Tl;dr',
    'Ada', 'Turing', 'Syntax', 'Ledger', 'Bibliophile', 'Dusty Tome', 'Index Card', 'Glossary Gus', 'Thesaurus Rex',
    'Dictionary Dan', 'Trivia Tina', 'Quiz Whiz', 'Know-It-All', 'Brainiac', 'Almanac', 'Atlas', 'Codex', 'Scroll',
    'Parchment', 'Bookmark', 'Dog-Ear', 'Margin Notes', 'Prof. Pickle', 'Lorem Ipsum', 'Fine Print', 'Reading Nook',
    'Study Buddy', 'Cheat Sheet', 'Flash Card', 'Pop Quiz', 'Textbook Ted', 'Wiki Wanda', 'Stack Survivor', 'Man Page',
    'Readme Ruth', 'Changelog Chad', 'Docstring', 'Answer Key', 'Quill', 'Inkwell', 'Lexicon',
  ],
  scout: [
    'Sherlock', 'Dora', 'Magellan', 'Columbo', 'Radar', 'Waldo', 'Scooby', 'Bloodhound', 'Marco Polo', 'Periscope',
    'Inspector Gadget', 'Carmen', 'Truffle Pig', 'Ctrl-F', 'Nancy Drew', 'Indiana Jones',
    'Raccoon', 'Donut Detective', 'Disco Ferret', 'Bush Camper', 'Loot Goblin', 'License2Prompt', 'Quantum Syntax',
    'Azure with Love', 'Model Not Enough', 'Another Prompt', 'For Your AI Only', 'Nacho Avg Spy', 'Spy Who Trained',
    'Trench Coat', 'Fake Mustache', 'Spyglass', 'Pathfinder', 'Trailblazer', 'Pigeon Scout', 'Sniffer', 'Tracker',
    'Grep Reaper', 'Haystack', 'Stakeout', 'Gumshoe', 'Dust Bunny', 'Log Digger', 'Night Owl', 'Cloak and Dagger',
    'Nosy Parker', 'Snoop', 'Lurker', 'Ferret', 'Eagle Scout', 'Treasure Map', 'Bushwhacker', 'Lost Tourist',
    'Wrong Turn', 'Pinpoint', 'Drone Ranger', 'Rabbit Hole', 'Burrow',
  ],
  wizard: [
    'Gandalf', 'Yoda', 'Merlin', 'Morpheus', 'Dumbledore', 'Rincewind', 'Doctor Strange', 'Zatanna', 'Harry Potter',
    'Radagast', 'Abracadabra', 'The Architect', 'Houdini', 'Mickey Mage', 'Sorcerer Mickey', 'Prospero',
    'Hex', 'Cygnus', 'Flux', 'Sir Bamboozle', 'Hocus Pocus', 'Presto', 'Alakazam', 'Wand Waver', 'Pointy Hat',
    'Long Beard', 'Spell Slinger', 'Rune Reader', 'Rune Master', 'Cauldron Kate', 'Potion Pete', 'Crystal Cave',
    'Tower Dweller', 'Mana Pool', 'Cantrip', 'Fireball', 'Arcane Al', 'Enchanter', 'Conjurer', 'Sorcerer Sam', 'Genie',
    'Magic Beans', 'Rabbit Hat', 'Top Hat Tom', 'Sleight of Hand', 'Black Box', 'Magic Wand', 'Stardust', 'Spellbinder',
    "Merlin's Cousin", 'Warlock Wally', 'Wizard of Odd', 'Wise Wizard', 'Staff of Fun', 'Sorcery Sue', 'Pixie Dust',
  ],
}

// Every frame of a role has the same width, so a row never jitters.
export const RUNNING: Readonly<Record<Role, readonly string[]>> = {
  advisor: ['(O,O)  ', '(o,O)  ', '(O,o)  ', '(O,O)~ ', '(O,O)? ', '(-,O)  ', '(O,-)  ', '(O,O)! '],
  builder: ['(o_o)/ ', '(o_o)--', '(o_o)\\ ', '(o_o)--', '(o_o)/#', '(>_<)/ ', '(o_o)\\#', '(o_o)=='],
  captain: ['(^_^)> ', '(^_~)> ', '(^_^)> ', '(^o^)> ', '(^_^)>>', '(~_^)> ', '(^_^)/ ', '(^o^)>>'],
  critic: ['(-_o)  ', '(o_-)  ', '(-_o)  ', '(o_o)  ', '(>_<)  ', '(-_-)? ', '(o_o)! ', '(-_o)? '],
  helper: ['(o_o)  ', '(o_o)  ', '(-_-)  ', '(o_o)  ', '(o_o)~ ', '(^_^)  ', '(o_-)  ', '(o_o)* '],
  scholar: ['(o_O)? ', '(O_o)? ', '(o_O)! ', '(O_o)? ', '(o_o)..', '(-_o)? ', '(O_O)! ', '(o_O)..'],
  scout: ['(o_o ) ', '( o_o) ', '(o_o ) ', '( o_o) ', '(o_o)>>', '(O_o ) ', '( o_O) ', '(o_o)? '],
  wizard: ['(o_o)* ', '(o_o)+ ', '(o_o). ', '(o_o)+ ', '(o_o)*+', '(-_-)* ', '(o_o)~*', '(O_O)* '],
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
