This repository follows the working agreement in [AGENTS.md](../AGENTS.md) at the
repo root. **Read `AGENTS.md` first** — it defines the source-of-truth documents,
the phased build workflow, and the conventions to keep.

Quick reminders:

- The full-stack "hello world" app already exists. Verify it (`make verify`);
  don't recreate it.
- Build from `functional_spec.md` → `implementation_plan.md` (phased, each phase
  independently testable) → execute one phase at a time with user confirmation.
- Follow [design_doc.md](../design_doc.md) for styling (dark mode, 4px radius,
  semantic tokens) and interaction patterns (toasts, loading, empty states).
- Keep the baked-in conventions: async backend, owned rows + 404 on foreign,
  soft delete, UUID PKs, camelCase wire boundary, thin routers.
- Update `PROGRESS.md` as you work so a dropped session can resume.
- Raise deviations from the plan immediately instead of guessing.
