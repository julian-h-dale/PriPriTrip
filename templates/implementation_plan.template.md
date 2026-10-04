# Implementation Plan — <Project Name>

> The agent produces this from `functional_spec.md`. Work progresses through
> **crawl → walk → run** stages. Each stage may contain **one or more phases**
> (e.g. several crawl phases setting up different parts of the app). Every phase
> is independently verifiable and ends with a test section. Phases are not meant
> to be hyper-granular — think meaningful, shippable increments.
>
> **Process:** the user answers the Open Questions below *before* Phase 1 starts.
> After each phase the agent runs `make verify`, updates `PROGRESS.md`, commits,
> and waits for the user to confirm before continuing.

## Summary

> 2–4 sentences: the overall approach and the shape of the phases.

## Architecture Decisions

> Choices that follow from the spec and don't need asking — the design rules
> that hold across all phases (e.g. "routines are day-bound and cannot cross
> midnight"). Put decisions here once so they aren't re-argued in every phase.
> Resolved Open Questions (below) also land here once answered.

-

## Open Questions / Design Decisions

> The agent fills these in. **The user answers them inline before any phase
> work begins.** These are the decisions that would otherwise be guessed.

1. **<Question>?**
   - Options / trade-offs: ...
   - **Answer:** _(user fills in)_
   - **Resolved:** _(one sentence stating the rule that now holds — this is what
     later phases read. Thread it into the Architecture Decisions and the
     affected phase scopes/tests, don't just leave it on this line.)_

---

## Phase 1 — Crawl: <name>

**Goal:** > The smallest end-to-end slice that proves the core loop works.

**Scope:**
-
-

**Out of scope for this phase:**
-

**Tests / verification:**
- [ ] `make verify` passes
- [ ] `make seed` covers this phase's new data, and the result is visible in the app
- [ ] <specific behavior a test asserts>
- [ ] <manual check, if any>

---

## Phase 2 — Crawl: <name>

> Add as many crawl phases as needed to stand up the different parts of the app.

**Goal:** >

**Scope:**
-

**Tests / verification:**
- [ ] `make verify` passes
- [ ] `make seed` covers this phase's new data, and the result is visible in the app
- [ ]

---

## Phase 3 — Walk: <name>

**Goal:** >

**Scope:**
-

**Tests / verification:**
- [ ] `make verify` passes
- [ ] `make seed` covers this phase's new data, and the result is visible in the app
- [ ]

---

## Phase 4 — Run: <name>

**Goal:** >

**Scope:**
-

**Tests / verification:**
- [ ] `make verify` passes
- [ ] `make seed` covers this phase's new data, and the result is visible in the app
- [ ]

---

## Later / Backlog

> Things intentionally deferred beyond the current phases.

-
