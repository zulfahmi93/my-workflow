# Wiki schema

Maintenance reference for the Karpathy-style LLM wiki at `/wiki/`. Loaded on-demand during wiki ingest / lint operations. Daily project work does NOT need this file. The high-level wiki concept is summarized in `/CLAUDE.md` §Wiki; this file is the detailed schema.

`projects/<name>/docs/` = raw layer (authoritative, mutable). `/wiki/` = compiled synthesis (Claude-maintained read-cache, never source of truth). The wiki holds **business matters + plans**. Operational rules (how-we-work) live in `.claude/rules/`, not in the wiki.

## File conventions

- All markdown. Obsidian-style `[[wikilinks]]` for cross-page refs (target = the page's `name:` frontmatter slug).
- Frontmatter required:

  ```
  ---
  name: <kebab-case slug>
  description: <one-line summary>
  metadata:
    type: index | project | concept | person | log
    # plus type-specific fields (status, last_ingested, used_by, ...)
  ---
  ```

- One concept per file in `wiki/concepts/`. One card per project in `wiki/projects/`. One file per person in `wiki/people/`.
- Every wiki page cites its raw source(s) under an "Authoritative spec" or "Implementation refs" or "Authoritative sources" section. Never assert without citation.

## Page templates

**`wiki/projects/<name>.md`** sections (in order):

1. Status (one line + date)
2. What (1–3 sentences)
3. Why (motivation + key constraints)
4. Core domain concept (link to `[[concept-slug]]`)
5. Stack (table)
6. Layout (tree + local-dev one-liner)
7. Plan status (table mirroring the project's `progress.md`)
8. Authoritative sources (links to raw docs)

**`wiki/concepts/<topic>.md`** sections:

1. One-line summary + which project(s) use it
2. Model (the rules)
3. Why this shape (motivation)
4. Authoritative spec (raw doc link)
5. Implementation refs (file paths)

## Ingest triggers

Update wiki when:

- A TDD cycle completes → re-sync project card's plan status table
- An ADR is written → add or update affected concept page
- A plan is revised → re-sync project card
- A domain concept changes → update concept page
- A stakeholder/customer/partner fact lands in conversation → create or update people page

Every ingest appends a row to `wiki/log.md`: `YYYY-MM-DD | <source path(s)> | <pages touched>`.

## Lint pass (weekly or on request)

Sweep for:

- Orphan pages (no inbound `[[link]]`)
- Stale `[[refs]]` (target page no longer exists)
- Contradictions across concept pages
- Project cards whose plan-status table is out of sync with the project's `docs/progress.md`
- Missing frontmatter or missing "Authoritative spec / sources" section
