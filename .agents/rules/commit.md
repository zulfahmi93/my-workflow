# Commit policy

Shared across all projects in this repo.

- Never auto-commit. Only on explicit "commit" / "let's commit".
- One commit per completed TDD cycle (in TDD-disciplined projects).
- Conventional Commits style; subject ≤ 50 chars; body explains the "why". **The subject limit is enforced** by `.agents/scripts/check-commit-command.py`, wired as a pre-Bash hook in both adapters — an over-length subject is rejected before the commit runs.
- `Co-Authored-By` trailer required.
- Provider-local runtime settings stay untracked (for example `.claude/settings.local.json`).

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
- `app` — Flutter / mobile screens, state, platform integrations
- `infra` — docker / Caddy / hosting / scripts
- `plan` — plan / progress edits
- `wiki` — wiki page ingest / lint
- `rules` — `.agents/rules/` edits
- `agents` — `.agents/roles/` edits

Projects may define additional scopes in their own local guide (prefer `AGENTS.md`; honor legacy provider guides). `ocr` above is ballot-counter-specific and grandfathered.

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

Subject is mandatory. Body is optional for trivial commits (typo, log tweak), required for anything that introduces or changes behavior. For TDD-cycle commits the `Why:` line points at the cycle: e.g. `Why: Cycle 002.1 — navigation glue (plan-002.yaml cycle 002.1)`.

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

## What the commit hook enforces

`.agents/scripts/check-commit-command.py` runs before every Bash call (wired via `.claude/hooks/` and `.codex/hooks/`, both execing the same shared script — there is one implementation, not two). It rejects:

- the forbidden flags `--amend`, `--no-verify`, `-n`;
- a commit **subject** longer than 50 characters.

The subject check is deliberately **conservative**: it fires only when the subject is statically readable from the command line, and skips anything it cannot resolve — `-F file`, `-C`/`-c` reuse, `--fixup`/`--squash`, `-t` template, an editor commit with no `-m`, or a message containing shell expansion it cannot evaluate. A false block would stop all work; a missed long subject is only a lint miss. It *does* resolve the `-m "$(cat <<'EOF' … EOF)"` heredoc form, which is the dominant pattern here — without that the gate would be decorative.

The limit is forward-only. It does not rewrite history, and the 31 pre-existing over-length subjects across the two repos stay as they are (`--amend` is forbidden anyway).

## Pre-commit hooks

Never skip hooks (`--no-verify`) or bypass signing unless the user explicitly asks for it. If a hook fails, investigate and fix the underlying issue. If the commit fails due to a pre-commit hook: fix the issue and create a NEW commit (never `--amend` a hook-failed commit).
