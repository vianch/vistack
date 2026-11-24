# grill: interview until no branch is open

The user brings a plan, design, or decision. The answer is a shared understanding of it,
reached by questions, because a plan's weak points are the decisions nobody made out loud.

## Method

1. **Map the design tree.** Every decision branches into the decisions that hang off it.
2. **Ask the frontier in rounds.** The frontier is every decision whose prerequisites are
   settled: the questions you can ask now without guessing at answers you have not heard.
   Ask the whole frontier in one round, number every question, give each your recommended
   answer, and wait for the user's answers.
3. **Word each question so "yes" accepts your recommendation.**
4. **Recompute the frontier after every round.** Settled decisions push it outward and
   unblock the questions that waited on them. A question whose answer depends on another
   question still open in this round waits for a later round.
5. **Facts are your job; decisions are the user's.** Never ask the user for a fact you can
   look up in the repository, its history, or its tools. On Claude Code, a fact that needs a
   code trace goes to an `analyst` lane with a fresh context
   (`skills/guard-the-context-window/SKILL.md`); other hosts read narrowly in the thread. A
   lookup still running is an unsettled prerequisite: only the questions downstream of it
   wait, and the rest of the frontier is asked now. Every decision goes to the user.
6. **Done when the frontier is empty**: every branch visited, nothing assumed in silence, and
   the user confirms the shared understanding.

## Round format

```
Q1. <question title>
<the question; several paragraphs and the choices when it has them>
Recommended: <your answer>

Q2. <question title>
<the question>
Recommended: <your answer>
```

## A person must answer

Grill needs someone to answer, so an agent never starts one with nobody to answer
(`skills/never-block-on-the-human/SKILL.md`, Nobody to answer). Asked for a grill with nobody
to answer, return the first frontier round in the round format, every question with its
recommended answer, for a person to answer later; wait for nothing and write no file. A user
who asks for a grill while a run is open gets it: the interview holds the thread until the
user confirms or says stop. Lanes keep draining, and the thread returns to the playbook when
the grill closes.

## Close

```
Settled
1. <decision, in the user's words>
2. <decision, in the user's words>
Open: <the branches still open when the user said stop, or none>
```

No plan or code change acts on a settled decision until the user confirms the list. The one
exception is `understanding-with-docs`, which writes each glossary term as it settles.

Adapted from skills/productivity/grilling/SKILL.md in mattpocock/skills (MIT License, Copyright (c) 2026 Matt Pocock).
