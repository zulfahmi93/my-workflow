---
name: tdd
description: >
  Strict red-green-review-refactor-commit TDD cycle. Enforces test-first development by gating
  each phase: RED (failing test that fails for the right reason), GREEN (minimal code to pass),
  REVIEW (independent reviewer gate — APPROVED or NEEDS FIX), REFACTOR (apply review notes
  while tests stay green; loops back to REVIEW), COMMIT (terminal state — emit message draft,
  await user confirmation). Delegates to agents — Test Engineer drafts tests, the stack Expert
  writes implementation, Code Reviewer guards the gate. Enforces a strict NO DEFER policy on
  review findings. Use when the user says "tdd this", "red-green", "write a failing test first",
  "test-drive", or invokes /tdd. Auto-trigger when the user asks to add a new function/class/
  endpoint and mentions tests upfront.
---

# TDD Red-Green-Review-Refactor-Commit Skill

Test-first or stop. Implementation without a failing test first is a skill violation. Review is a hard gate — no commit until reviewer says `APPROVED`.

## Persistence

ACTIVE for the duration of one feature/unit. Cycle ends when REVIEW returns `APPROVED` and the user confirms the COMMIT. User can `/tdd next` to begin next cycle, or `/tdd off` to exit.

## The Five Phases (strict order, no skipping)

```
                        ┌───────────────────────┐
                        │                       ▼    APPROVED
                        │  RED ──► GREEN ──► REVIEW ─────────► COMMIT
                        │                       │
                        │            NEEDS FIX  │
                        │                       │
                        │                       ▼
                        └────────────────── REFACTOR
```

### 🔴 RED — Write a failing test that fails for the right reason

1. Detect stack from working dir (see Stack Detection below).
2. Spawn **Test Engineer** subagent. Prompt with:
   - Unit under test (function/class/endpoint/widget).
   - Behavior the user described — one behavior, one test. Smallest slice.
   - Target framework (matches stack).
   - Constraint: test must compile/parse but fail because the code under test is missing or wrong. NOT fail because of a typo.
3. Apply the test file. Run only that test. Confirm:
   - Test runs.
   - Test fails.
   - Failure reason = "expected X but Y" or "method/symbol not found" — NOT syntax error, NOT import error in test infra.
4. If test fails for wrong reason → fix test infra, re-run. Do NOT proceed to GREEN until RED is "right kind of failing."
5. Quote the exact failure line. Required output: ``RED ✓ — <test name> failing because <reason>``.

### 🟢 GREEN — Minimal code to pass. No more.

1. Spawn the **stack Expert** subagent. Prompt with:
   - Failing test code + failure message.
   - Constraint: write the smallest amount of code that flips this single test green. Hardcoded return values are acceptable in GREEN. Premature abstraction is forbidden.
   - Do not touch unrelated files. Do not add features the test does not exercise.
2. Apply implementation. Run the test (and only the affected test suite for speed).
3. Confirm pass. If still failing, return to GREEN — do NOT write a second test yet.
4. Run the full test suite for the affected package to verify no regression.
5. Required output: ``GREEN ✓ — <test name> passes, suite <N> passed``.

**GREEN anti-patterns (block):**
- Adding methods, fields, types not exercised by the test.
- Adding error handling for cases no test covers.
- Adding logging, validation, telemetry "while we're here."
- Refactoring during GREEN. Refactor has its own phase.

### 🔵 REVIEW — Independent gate. APPROVED or NEEDS FIX.

1. Spawn **Code Reviewer** subagent. Prompt with:
   - Files changed in GREEN (or REFACTOR, on subsequent loops).
   - Failing test that motivated the change.
   - Stack conventions to enforce.
   - Constraint: reviewer identifies issues only — never writes code. Reviewer emits exactly one of `APPROVED` or `NEEDS FIX` at the top of its response.
2. Reviewer tags each finding:
   - `[BLOCKER]` — correctness, security, data integrity, or test integrity. Must fix.
   - `[REFACTOR]` — duplication, missed abstraction, structural smell. Must fix.
   - `[NIT]` — style or optional polish. Reviewer may emit `APPROVED` even when nits exist.
3. Routing:
   - Reviewer returns `APPROVED` (zero `[BLOCKER]` + zero `[REFACTOR]`) → proceed to COMMIT.
   - Reviewer returns `NEEDS FIX` → proceed to REFACTOR.
4. Required output: ``REVIEW <APPROVED|NEEDS FIX> — <N blockers / N refactors / N nits>``.

**REVIEW anti-patterns (block):**
- Reviewer writing code. Reviewer flags only.
- Skipping REVIEW because "the change is small." Every cycle goes through REVIEW.
- Approving with open `[BLOCKER]`/`[REFACTOR]` items. Tag-to-verdict mapping is mechanical.

### 🟡 REFACTOR — Apply review notes. Tests stay green. Loop back to REVIEW.

1. Spawn the **stack Expert** subagent that wrote GREEN (continuity matters). Prompt with:
   - Reviewer's `NEEDS FIX` output verbatim.
   - Constraint: address every `[BLOCKER]` and `[REFACTOR]` item. Address `[NIT]` items if trivial. No new behavior. No new public API. If addressing an item requires a new test, that is a new RED — stop the loop and restart a new cycle.
2. Apply refactor edits.
3. Run full affected test suite after every meaningful refactor. If anything breaks → revert that step, try smaller.
4. Return to REVIEW with the updated diff. Loop until reviewer returns `APPROVED`.
5. Required output per loop: ``REFACTOR ✓ — <changes> applied, all tests green, returning to REVIEW``.

**REFACTOR anti-patterns (block):**
- Adding new public API.
- Changing test assertions to make refactor "fit."
- "Refactoring" that requires writing a new test → new RED, new cycle.
- Silently dropping a `[BLOCKER]` or `[REFACTOR]` finding (see NO DEFER policy below).

### 🟣 COMMIT — Terminal phase. Draft message. Await user.

1. Only entered after REVIEW returns `APPROVED`.
2. Draft a commit message:
   - Conventional Commits style: `<type>(<scope>): <subject>`.
   - Subject ≤ 50 chars.
   - Body explains the **why**, not the what. Skip if intent is obvious from subject.
   - Single cycle = single commit.
3. Emit the draft. Do NOT run `git commit` until the user says "commit" / "let's commit" / equivalent.
4. Required output: ``COMMIT-READY — <subject line draft>``.
5. Never auto-push, never open PRs. Those are explicit user actions.

## NO DEFER policy (strict)

Reviewer findings get fixed **this cycle**, period. The cycle does not advance to COMMIT with open `[BLOCKER]` or `[REFACTOR]` items.

- `[BLOCKER]` and `[REFACTOR]`: resolved in the REFACTOR pass of the current cycle. No silent deferral. No "we'll get it next time."
- `[NIT]`: fix if cost is trivial (< 5 min). Otherwise log as a tracked follow-up in whatever follow-up register the project uses (cycle notes, plan doc, issue tracker). Never silently skip.
- Genuine deferral (the item requires its own RED/GREEN — e.g. a retry policy that depends on a not-yet-built failure path) requires **both**:
  1. Explicit user approval in the current session, AND
  2. A new tracked cycle/task entry with a clear gate for when it will be picked up.
- "Scope discipline" is **not** a valid deferral reason. The cost of touching one more file now is almost always lower than the cost of finding the same issue at release time.
- When in doubt: fix now. Cycle wall-time is a soft target, not a gate.

If the skill detects a reviewer finding being dropped without user approval → halt the cycle, surface the finding to the user, refuse to proceed to COMMIT.

## Stack Detection

Before RED, identify stack from files in working dir:

| Marker | Stack | Test framework | Test Engineer + Expert pair |
|--------|-------|---------------|----------------------------|
| `pubspec.yaml` | Flutter | `flutter_test` + `bloc_test` + `mocktail`/`mockito` | Test Engineer + Flutter Expert |
| `package.json` with `react` (no `next`) | React (SPA) | `vitest`/`jest` + `@testing-library/react` + `msw` | Test Engineer + React Expert |
| `package.json` with `next` | Next.js (App Router) | `vitest` + `@testing-library/react` + `msw` for unit; `playwright` for E2E | Test Engineer + React Expert |
| `*.csproj` / `*.sln` | .NET | `xUnit` + `NSubstitute`/`Moq` + `WebApplicationFactory` | Test Engineer + .NET Expert |
| `pyproject.toml` / `requirements.txt` with `fastapi` | Python / FastAPI | `pytest` + `pytest-asyncio` + `httpx.AsyncClient` | Test Engineer + python-expert |
| `pyproject.toml` with `grpcio` | Python / gRPC service | `pytest` + `grpc_testing` or in-process `grpc.aio` channel | Test Engineer + python-expert |
| `*.proto` (cross-language contract) | gRPC contract | Stack-specific client + server tests on both sides | Test Engineer + matching stack Experts on each side |
| `supabase/migrations/` | Supabase | `pgTAP` for RLS, `deno test` for Edge Functions | Test Engineer + Supabase Expert |
| `*.sql` migrations + Postgres | Plain PostgreSQL | `pgTAP` in a transaction with `ROLLBACK` | Test Engineer + Database Engineer |
| Multiple | Polyrepo / Polyglot | Pick stack from file path of unit under test | Pair matching that path |

If unclear, ask user once: "Stack? [flutter|react|next|dotnet|python-fastapi|python-grpc|supabase|postgres]". Don't guess.

## Framework-Specific Test Shape

**Flutter (BLoC):**
```dart
blocTest<MyBloc, MyState>(
  'emits Loading then Success when LoadRequested',
  build: () => MyBloc(repo: mockRepo),
  act: (bloc) => bloc.add(LoadRequested()),
  expect: () => [Loading(), Success(data: tData)],
);
```

**React (Vitest + RTL):**
```ts
it('renders error when API rejects', async () => {
  server.use(http.get('/users', () => HttpResponse.error()));
  render(<UserList />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/failed/i);
});
```

**Next.js — Route Handler (App Router, Vitest):**
```ts
import { GET } from '@/app/api/attendance/route';

it('GET /api/attendance returns 200 with rows', async () => {
  const req = new Request('http://localhost/api/attendance');
  const res = await GET(req);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.rows).toHaveLength(1);
});
```

**Next.js — Server Component (Vitest + RTL, async):**
```ts
import Page from '@/app/dashboard/page';

it('renders attendance table from server data', async () => {
  const ui = await Page();
  render(ui);
  expect(await screen.findByRole('table')).toBeInTheDocument();
});
```

**.NET (xUnit):**
```csharp
[Fact]
public async Task CreateUser_DuplicateEmail_ThrowsConflict()
{
    var handler = new CreateUserCommandHandler(_repo, _hasher, _logger, _mapper);
    await _repo.AddAsync(User.Create("a@b.c", "A", "h"));
    await Assert.ThrowsAsync<DomainException>(() =>
        handler.Handle(new CreateUserCommand("a@b.c", "X", "p"), default));
}
```

**.NET — Minimal API integration (WebApplicationFactory):**
```csharp
public class WebhookTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;
    public WebhookTests(WebApplicationFactory<Program> f) => _client = f.CreateClient();

    [Fact]
    public async Task Post_InvalidSignature_Returns401()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/webhook/whatsapp")
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json"),
        };
        req.Headers.Add("X-Hub-Signature-256", "sha256=deadbeef");
        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }
}
```

**Python / FastAPI (pytest + httpx.AsyncClient):**
```python
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.mark.asyncio
async def test_health_returns_ok():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
```

**Python / gRPC service (pytest + in-process channel):**
```python
import pytest
import grpc
from concurrent import futures
from generated import face_pb2, face_pb2_grpc
from app.face_service import FaceServicer

@pytest.fixture
def grpc_channel():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=1))
    face_pb2_grpc.add_FaceServicer_to_server(FaceServicer(), server)
    port = server.add_insecure_port("[::]:0")
    server.start()
    channel = grpc.insecure_channel(f"localhost:{port}")
    yield channel
    channel.close()
    server.stop(None)

def test_match_returns_similarity_above_threshold(grpc_channel):
    stub = face_pb2_grpc.FaceStub(grpc_channel)
    res = stub.Match(face_pb2.MatchRequest(selfie=b"...", reference_id="ref-1"))
    assert res.matched is True
    assert res.similarity >= 0.6
```

**PostgreSQL (pgTAP — RLS or domain logic, in a transaction):**
```sql
BEGIN;
SELECT plan(1);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"user-other"}';
SELECT throws_ok(
  $$ SELECT * FROM private_notes WHERE owner_id = 'user-mine' $$,
  'permission denied for table private_notes'
);
SELECT * FROM finish();
ROLLBACK;
```

## Cycle Protocol

Each user request that starts a TDD cycle MUST progress through phases in order. Output a phase header before each phase so the user can interject.

```
## 🔴 RED
<test draft + run + failure>

## 🟢 GREEN
<min impl + run + pass>

## 🔵 REVIEW
<reviewer verdict + tagged findings>

## 🟡 REFACTOR   (only if REVIEW = NEEDS FIX; loops back to REVIEW)
<fixes + run + still pass>

## 🟣 COMMIT
<conventional commit draft, awaiting user "commit">
```

If user interrupts mid-phase, treat the interruption as a scope change → restart RED with the revised behavior.

## Cycle Size Guidance

- One behavior per cycle. "User can log in with email + password" is too big — split into "rejects empty email", "rejects invalid email", "calls auth service with credentials", "stores token on success".
- A cycle should typically take <15 minutes wall clock. If RED→GREEN takes longer, the test is too big — abort, split, retry.
- Multiple cycles per feature is normal and desired. Resist the urge to merge them.

## Boundaries

- Skill writes/runs tests and code in the working dir. Does not push, does not open PRs — those are user-initiated.
- Skill does not bypass `Code Reviewer` for the REVIEW phase. Reviewer is the only path to COMMIT.
- Skill never disables a failing test to "make it green." If a test is wrong, delete it openly with reasoning.
- For UI/visual work: golden tests in Flutter and snapshot tests in React/Next.js are valid RED targets, but require explicit user approval of the baseline before locking in.
- For RLS/SQL in any Postgres setup: pgTAP test must run in a transaction and `ROLLBACK` so it does not pollute the dev database.
- COMMIT phase emits a draft only. The skill never runs `git commit` without an explicit user go-ahead.

## Switches

- `/tdd <feature>` — start a new cycle for `<feature>`.
- `/tdd next` — after a cycle completes, start the next slice.
- `/tdd skip-review` — forbidden. There is no skip for REVIEW.
- `/tdd skip-refactor` — only valid when REVIEW returned `APPROVED` and there are no `[BLOCKER]`/`[REFACTOR]` findings. Effectively a no-op (no refactor needed). Never use to bypass open findings.
- `/tdd off` — exit TDD mode for this session.

## Failure Modes & Recovery

| Symptom | Likely cause | Recovery |
|---------|-------------|----------|
| Test passes immediately on first run | Test is wrong (asserts something already true) or unit under test already exists | Strengthen assertion or pick smaller behavior; restart RED |
| Test fails on import/syntax | Test infra broken, not the unit | Fix infra silently, do not count as RED |
| GREEN keeps failing despite "minimal" impl | Test is too big or testing too much | Split test, restart RED with smaller slice |
| REVIEW keeps returning `NEEDS FIX` after multiple REFACTOR loops | REFACTOR scope creeping, or the test itself is wrong | Stop. Surface to user. Consider whether a new RED is needed |
| REFACTOR breaks tests | Refactor introduced behavior change, not just structure | Revert; smaller refactor step; commit between steps |
| Coverage drops after REFACTOR | Test deleted that covered real branch | Restore test or write replacement before continuing |
| Reviewer wrote code instead of flagging | Reviewer prompt drift | Re-spawn reviewer with stricter "flag only, never edit" constraint |
| Finding silently dropped between REFACTOR and COMMIT | NO DEFER policy violation | Halt. Re-open the finding. Either fix it or get explicit user approval to defer with a tracked entry |
