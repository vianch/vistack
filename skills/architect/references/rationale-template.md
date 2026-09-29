# Rationale template

The prose that ships beside the type sketch. One page, sentence-case headings, no
boilerplate. Replace each note with the real content.

## Problem

One paragraph: what the change must do, and what about the existing system makes the shape
non-obvious. Name every constraint the grounding phase surfaced — types to interoperate with,
callers that cannot break, invariants that cross the boundary — so the reader sees what you
saw.

## Usage (caller's view)

Write this first. Show the quickstart the consumer reads and two or three realistic call
sites in their own code: what they import, what they call, what comes back. The shape below
is derived from this section. When the two disagree, change the shape, not the usage.

## Shape

Data structures first, then how data flows through the signatures. Name the load-bearing
decisions: which invariants live in types, where validation happens, and what the system
deliberately does not do. Judge interface depth explicitly: what the public surface hides,
what stays exposed, and why it is no larger than it needs to be. Cite the principle behind a
decision by name; do not restate it.

## Synthesis decision

Which candidate became the base and why, what was grafted from each other candidate, and what
was rejected and why. Name any dropout.

## Tradeoffs accepted

One bullet per tradeoff, in the form "we accept X in exchange for Y." Name anything a later
reader could mistake for an oversight.

## Alternatives considered

At least one concrete alternative shape, with one line on why it lost, judged on interface
depth rather than implementation ease. Two or three when the space had real contenders. One
is enough when the constraints forced the answer; say "this was the only viable shape
because…". This section is about shapes the design rejected, not the other candidates.

## Open questions and risks

What the human should weigh in on and what could go wrong before implementation starts.
Phrase each as a question, so the answer is the resolution. A question that changes
acceptance criteria or a public contract is FENCE 2.

## Next implementation step

One sentence: the first thing to build against the sketch.
