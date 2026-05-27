# Commit policy

Shared across all projects in this repo.

- Never auto-commit. Only on explicit "commit" / "let's commit".
- One commit per completed TDD cycle (in TDD-disciplined projects).
- Conventional Commits style; subject ≤ 50 chars; body explains the "why".
- `Co-Authored-By` trailer required.
- `.claude/settings.local.json` stays untracked (user-specific).

## Conventional Commits prefixes

Format: `<type>(<scope>)`. Type describes the kind of change. Scope describes the area touched.

**Types:**

- `feat` — new behavior visible to a user or caller
- `fix` — bug fix; pair with a regression test (see [tdd.md §Test quality](tdd.md#test-quality))
- `refactor` — internal reshape; no behavior change; tests stay green
- `perf` — performance improvement; numbers in the body
- `test` — test added / strengthened without behavior change
- `docs` — docs / plan / wiki edits without code
- `chore` — tooling, harness, CI, repo hygiene
- `ci` — pipeline / workflow changes
- `style` — formatting only (rare; usually pre-commit hooks handle this)

**Scopes** (match primary area touched):

- `db` — schema, migrations, pgTAP
- `api` — .NET / DbContext / endpoints
- `ocr` — Python / Gemini / FastAPI
- `web` — Next.js / shadcn / React
- `infra` — docker / Caddy / hosting / scripts
- `plan` — plan / progress edits
- `wiki` — wiki page ingest / lint
- `rules` — `.claude/rules/` edits
- `agents` — `.claude/agents/` edits

Examples: `feat(api): add mark_rosak PATCH endpoint`, `fix(web): redirect loop on /elections`, `refactor(ocr): extract cell-cropping helper`, `docs(wiki): ingest plan-002 cycle 002.1`.

## Commit body template

```
<type(scope)>: <subject — imperative, ≤ 50 chars>

Why: <motivation; cycle / plan ref if applicable>
What: <key changes if subject doesn't convey them>
Notes: <breaking changes; follow-ups tracked>

BREAKING CHANGE: <description>   [omit unless applicable]

Co-Authored-By: <name> <email>
```

Subject is mandatory. Body is optional for trivial commits (typo, log tweak), required for anything that introduces or changes behavior. For TDD-cycle commits the `Why:` line points at the cycle: e.g. `Why: Cycle 002.1 — navigation glue (plan-002.md §"CYCLE 002.1")`.

Wrap body lines at ~72 characters.

## What NOT to commit

- `.env`, credential files, API keys, certificates, private keys, signed tokens
- Generated build artifacts (`dist/`, `build/`, `bin/`, `obj/`, `__pycache__/`, `.next/`, `target/`)
- IDE personal config (user-specific `.vscode/`, `.idea/`, language-server caches)
- Large binary assets without Git LFS
- Test fixtures that contain real PII or live customer data
- Debug residue (`console.log`, `Console.WriteLine`, `fmt.Println`, `print()`, stray `debugger;`)
- Commented-out code blocks left "for reference"
- OS metadata (`.DS_Store`, `Thumbs.db`, `desktop.ini`)
- Untracked third-party vendored code without a license + provenance note

If staging includes any of the above, the orchestrator refuses the commit and surfaces the offending paths to the user.

## Pre-commit hooks

Never skip hooks (`--no-verify`) or bypass signing unless the user explicitly asks for it. If a hook fails, investigate and fix the underlying issue. If the commit fails due to a pre-commit hook: fix the issue and create a NEW commit (never `--amend` a hook-failed commit).
