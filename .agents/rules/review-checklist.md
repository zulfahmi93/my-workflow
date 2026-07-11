# REVIEW checklist

The categories the `code-reviewer` agent evaluates against during the REVIEW phase of every TDD cycle. Loaded on-demand by the reviewer subagent (and any agent doing review-prep work). Referenced from [`cycle-orchestration.md`](cycle-orchestration.md) §REVIEW checklist.

Findings carry tags per [tdd.md §Reviewer issue tags](tdd.md#reviewer-issue-tags). Categories scoped to a kind of change (UI, API) only apply when relevant. If a category is intentionally skipped, the reviewer notes it + reason in the verdict.

## Correctness + test coverage

- Code does what the cycle spec says (architect verdict + plan §cycle § "CYCLE X.Y").
- Tests cover happy path + boundary + error per [tdd.md §Test quality](tdd.md#test-quality). Missing any branch → `[BLOCKER]`.
- Full pre-cycle suite still green (no regression).
- Bug fixes have a regression test that fails before the fix.
- No skipped / disabled tests added without a tracked follow-up.

## Security

- Untrusted input validated at the boundary (request bodies, query params, file uploads, env vars).
- No secrets / API keys hardcoded; loaded from env / secret store.
- SQL parameterized; no string concatenation in queries; no dynamic identifier interpolation without allow-listing.
- Auth boundaries enforced server-side; client-side checks are UX hints only.
- Cryptographic operations use constant-time compare for secrets; raw tokens never logged.
- If the cycle touches any item in [cycle-orchestration.md §Security tier](cycle-orchestration.md#security-tier), the `security-reviewer` second pass MUST run before COMMIT.

## Error handling

- External calls (DB, HTTP, file I/O, subprocess) have explicit failure paths; no silent swallow.
- User-facing errors are actionable; no stack traces leaking to end users.
- Resources (connections, file handles, transactions) released on the error path (`using` / `with` / `defer` / `try/finally`).
- No empty `catch` blocks.

## Clarity + maintainability

- Names reveal intent; no surviving `data`, `temp`, `result`, `foo`, single-letter outside trivial scopes.
- Functions short + single-responsibility; > 50 lines or > 3 levels of nesting → split or justify.
- No magic numbers / strings; named constants.
- No premature abstraction (interface for a single implementation, factory wrapping a constructor, "just in case" parameters).
- No dead code, no commented-out blocks "for reference".
- Code matches existing codebase conventions (file layout, naming, idioms). Deviations called out + justified.

## Performance

- No obvious N+1 query loops; eager-load with `.Include()` / `select_related` / explicit JOINs where the access pattern demands it.
- Hot paths (request handlers, render passes, tight loops) avoid sync I/O and unnecessary allocations.
- Frontend: no oversize client-side deps for server-only logic; no inline objects/functions causing avoidable re-renders.

## Dependencies

- New package additions justified (vs. writing inline; vs. existing dep). Note in the cycle notes §"Deviations".
- License compatible with the project; maintenance status checked (recent commits, no critical unpatched CVEs).
- Lock file updated in the same commit (e.g. `package-lock.json`, `pnpm-lock.yaml`, `packages.lock.json`, `poetry.lock`, `uv.lock`, `Cargo.lock`, `go.sum`).

## UI cycles only (any commit scoped `(web)` or `(app)` — `feat(web)`, `fix(app)`, `refactor(web)`, etc.)

- Semantic HTML; ARIA labels on non-text interactive controls; full keyboard navigation; focus management on route change.
- Loading, empty, and error states present — not only the happy state.
- Responsive (mobile + desktop breakpoints) verified.
- User-facing copy: clear, no `Lorem ipsum`, no `TODO:` placeholders, no debug strings.
- No layout shift on hydration / initial load (CLS budget respected).
- `(app)` cycles: Flutter semantics labels on interactive widgets, touch targets ≥ 48dp, reduced-motion respected, no jank on the changed flow (profile if in doubt).

## API cycles only (any commit scoped `(api)`)

- DTOs versioned or backward-compatible; field renames carry a deprecation path.
- Endpoints documented (OpenAPI / XML doc comments).
- Status codes match semantics (`409 Conflict` for state collisions, `422 Unprocessable Entity` for validation failures, never `500` for client errors).
- Idempotency where the verb implies it (`PUT`, `DELETE`, idempotency keys on POST when applicable).

## Documentation

- ADR added when the cycle changes architecture (DB driver swap, new external dep, auth flow change, schema migration with policy implications). Project-specific location: typically `<project>/docs/adr/` or `<project>/docs/decisions/`; if neither exists, create the folder.
- Public-API surface documented (exported types, interfaces, OpenAPI / XML doc / JSDoc).
- README updated if local-dev steps changed.
