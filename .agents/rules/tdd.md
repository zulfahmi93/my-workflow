# TDD workflow

Shared across all TDD-disciplined projects in this repo. Project-specific extensions (cycle agent assignments, model rules) live in the project's plan file.

Every cycle: `RED → GREEN → REVIEW → (REFACTOR → REVIEW)* → COMMIT`.

```
                        ┌───────────────────────┐
                        │                       ▼    ALL GOOD
                        │  RED ──► GREEN ──► REVIEW ─────────► COMMIT
                        │                       │
                        │            ISSUES     │
                        │                       │
                        │                       ▼
                        └────────────────── REFACTOR
```

REVIEW is the gate. If reviewer returns `APPROVED` (no BLOCKERs, no REFACTOR items), cycle goes straight to COMMIT. If reviewer returns `NEEDS FIX`, run REFACTOR then loop back to REVIEW. Repeat until APPROVED.

| Phase | Who | What |
|---|---|---|
| RED | test author per cycle | failing test that fails for the right reason; meets [Test quality](#test-quality) |
| GREEN | implementer per cycle | minimal code to pass; satisfies [GREEN gate](#green-gate-before-claiming-green-done) before REVIEW |
| REVIEW | `code-reviewer` agent | applies the [REVIEW checklist](review-checklist.md); emits `APPROVED` or `NEEDS FIX`; never writes code |
| REFACTOR | implementer per cycle | applies review; tests stay green; loops back to REVIEW |

## Test quality

Every test must:

- **Name reveals behavior**, not implementation. `test_unauthenticated_root_redirects_to_login`, not `test_redirect_function_works`.
- **Test one concept**. Multiple assertions OK when they describe the same behavior; multiple unrelated behaviors → split into separate tests.
- **Cover the triangle**: happy path + boundary (empty, max, min, null, unicode, off-by-one) + error (invalid input, dependency failure, permission denial). Missing any → `[BLOCKER]` in REVIEW.
- **Fail visibly in RED**. The failing assertion message must name what's wrong, not just "assertion failed". `expected redirect to /login, got 200 OK`.
- **Run fast**. Unit < 1 s; integration < 30 s. Slow tests get skipped over time.
- **Never flaky**. Quarantine + root-cause; never retry-loop. Common causes: shared state, clock/time dependence, hidden test-order coupling, network nondeterminism.

When fixing a bug: **regression test first**. The test exercises the bug, fails before the fix, passes after. No fix without a regression test.

When adding code: **no code without a failing test demanding it**. The implementer in GREEN cannot author untested branches "for completeness". If a branch is needed but not yet under test, RED must add the test first.

## GREEN gate (before claiming GREEN done)

- **Full test suite green** — not only the new test. Code that breaks an unrelated test is a regression and blocks GREEN.
- **Zero new compiler / linter / type-check warnings** vs. the pre-cycle baseline. Suppress only with a per-line comment citing the reason.
- **Zero new `TODO` / `FIXME` without a tracked follow-up** in the plan or an issue. Bare TODOs are deferred bugs.
- **Zero new skipped / disabled tests** without an entry in the plan §"Cycle follow-ups".
- **No debug residue** — `console.log`, `Console.WriteLine`, `fmt.Println`, `print()`, stray `debugger;` calls.
- **UI cycles** (`feat(web)` / `feat(app)`): implementer manually exercises the feature in a browser (web) or on a device/emulator (app) before claiming GREEN. Tests pass ≠ feature works. Verify the golden path + edge cases + visible loading / error / empty states.
- **API cycles** (`feat(api)`): implementer hits the endpoint(s) with a real request (curl, `.http` file) to confirm wire-level behavior end-to-end, including status codes + error envelopes.

If any gate fails, GREEN is not done. Loop back to fix before invoking REVIEW.

## Reviewer issue tags

- `[BLOCKER]` — must fix in next REFACTOR pass; blocks COMMIT
- `[REFACTOR]` — must fix in next REFACTOR pass; blocks COMMIT
- `[NIT]` — style/optional; reviewer may mark `APPROVED` even if present

## Deferral policy — fix now, don't pile up

- `[BLOCKER]` and `[REFACTOR]` items are resolved in this cycle's REFACTOR pass, full stop. No silent deferral.
- `[NIT]` items: fix now if the fix is trivial — bounded as **< 1 hour AI-assisted wall-clock** (≈ **< 4 hours of unaided human work**). The cycle is agent-executed, so the ceiling is measured against agent effort, not hand-coding time. Otherwise log in the project's plan §"Open questions" as a tracked follow-up — never silently skip.
- Genuine deferral (item requires its own RED/GREEN — e.g. RLS policies, indexes that need access patterns from a later phase) requires:
  1. Explicit user approval in the current session, AND
  2. A new cycle entry added to the project's plan with a clear gate.
- "Scope discipline" is NOT a valid reason to defer an in-scope review finding. The cost of touching one more file now is almost always lower than the cost of finding the same issue six cycles later when seed data, migrations, or live tests depend on the current shape.
- When in doubt, fix now. Cycle wall-time is a soft target, not a gate.

## Roles and delegation

Role + capability-tier assignments for each cycle live in the project's plan file. Use the runtime's delegation primitive with the matching definition under `.agents/roles/`.

The `tdd` skill is available through any runtime that supports Agent Skills. Provider adapters may additionally expose it as a slash command.

## Test harness conventions (generic)

DB-backed tests:

- Use Testcontainers (.NET, Python) or docker + `pg_prove` (pgTAP) for a real database. No mocks against ORM / SQL.
- Reset between tests: Respawn (.NET) or `BEGIN; ... ROLLBACK` (SQL).
- Project-specific image versions, schema bootstrap quirks (e.g. `auth.users` stub), and fixture-path conventions live in the project's local guide, not here.

LLM / external-API-backed tests:

- Unit tests mock the client (`unittest.mock`, test double, or `Moq`). Zero real API calls in the unit suite.
- Integration tests mark with `@pytest.mark.integration` (Python) or a `Trait` (.NET). MUST skip cleanly when the API key env var or the required fixture file is absent — CI must stay green.
- API keys live in `.env` (git-ignored), auto-mounted into docker.
