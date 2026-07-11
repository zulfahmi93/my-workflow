---
name: wiki-ingest
description: >
  Ingests project raw docs into the Karpathy-style LLM wiki and lints it: refresh the
  project card and concept / people / glossary pages per wiki/SCHEMA.md, cite raw sources
  on every page, update the index catalog and ingest changelog, run the lint sweep, and
  draft (never execute) the docs(wiki) commit message. Use when the user says "ingest to
  wiki", "update wiki for <project>", "sync the wiki", or invokes /wiki-ingest.
---

# Wiki ingest

Compiles `projects/<group>/<name>/docs/` (raw layer, authoritative) into `/wiki/`
(synthesis cache, never source of truth). Canon: [wiki/SCHEMA.md](../../../wiki/SCHEMA.md)
— authoritative for the frontmatter spec, page templates, ingest triggers, and lint
policy. Read it first; this skill never restates it.

## Procedure

1. **Read [`wiki/SCHEMA.md`](../../../wiki/SCHEMA.md).** Everything below executes per
   that schema.

2. **Identify changed raw sources** under `projects/<group>/<name>/docs/` since the last
   ingest (compare against the latest `wiki/log.md` rows; `git log`/diff helps). Match
   them to the schema's ingest triggers (cycle completed, ADR written, plan revised,
   concept changed, stakeholder fact landed).

3. **Update or create pages**: the `wiki/projects/<name>.md` card (sections + plan-status
   table per the schema's template), plus `wiki/concepts/`, `wiki/people/`, and
   `wiki/glossary.md` entries as the changes dictate. Frontmatter per the schema's spec;
   `[[wikilinks]]` for cross-page refs.

4. **Cite the raw source on every page touched** — the "Authoritative sources" (or
   per-template equivalent) section. The wiki is a synthesis cache, never authoritative
   (root `CLAUDE.md` hard rule). Never assert without citation.

5. **Update catalog + changelog**: keep the `wiki/index.md` catalog current, and append
   the `YYYY-MM-DD | <source path(s)> | <pages touched>` row to `wiki/log.md`.

6. **Lint pass** per the schema's §Lint: orphan pages, stale `[[refs]]`, contradictions
   across concept pages, project cards whose plan-status table is out of sync with the
   plan YAML's per-cycle `status:`, missing frontmatter or citation sections.

7. **Scope guard**: business matters + plans only. Operational rules (how-we-work) NEVER
   enter the wiki — they live in `.claude/rules/`.

8. **Draft the commit** — a `docs(wiki): …` message per
   [commit.md](../../rules/commit.md). Draft only; committing is the user's explicit call.
