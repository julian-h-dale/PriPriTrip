# Functional Spec — <Project Name>

> Fill this in before asking an agent to build. Keep it focused: this is the
> "what and why", not the "how". The agent turns this into a phased
> `implementation_plan.md`. Delete the guidance blockquotes as you go.

## 1. Goal

> One or two sentences: what does this app do and for whom? What's the core
> value?

## 2. Non-Goals

> What this app explicitly will **not** do (at least for now). This prevents
> scope creep and stops the agent from over-building.

-
-

## 3. Domain Model / Glossary

> The core entities and the terms you'll use throughout. For each entity: what
> it is, who owns it, and its key fields. (Remember: every domain row is owned
> by a user and uses UUID keys + soft delete — see AGENTS.md.)

| Entity | Description | Key fields | Owned by |
|---|---|---|---|
| Example | ... | ... | user |

## 4. Core User Flows

> The main things a user does, as short numbered flows. Focus on the happy path;
> note important edge cases inline.

1. **<Flow name>** — As a <role>, I can <do something> so that <outcome>.
   1. ...
   2. ...

## 5. Roles & Permissions

> Who can do what. The template ships with a general user and an admin
> (`is_superuser`). Note anything beyond that.

- **User:** ...
- **Admin:** ...

## 6. Time & Locale

> Even "not time-sensitive" is a useful answer to record here — it stops a
> whole class of decisions being guessed later (they are painful to retrofit
> once dated rows exist). See AGENTS.md on instants vs. wall-clock values.

- **Does the app have a notion of "today"?** (daily reset, deadlines, "3 days
  ago" labels, digests?) ...
- **Whose clock is authoritative?** the user's timezone / the server's / UTC ...
- **Any wall-clock times** ("ends at 09:00") as opposed to instants (a specific
  moment)? ...

## 7. Acceptance Criteria

> Concrete, testable statements of "done" for the whole spec. These become the
> per-phase test sections in the implementation plan.

- [ ] ...
- [ ] ...

## 8. Notes / Open Questions

> Anything undecided or context the agent should know. The agent will also add
> its own open questions to the implementation plan for you to answer.

-
