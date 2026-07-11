---
name: wiki-ingest
description: >
  Ingests project raw docs into the Karpathy-style LLM wiki and lints it: refresh the
  project card and concept / people / glossary pages per wiki/SCHEMA.md, cite raw sources
  on every page, update the index catalog and ingest changelog, run the lint sweep, and
  draft (never execute) the docs(wiki) commit message. Use when the user says "ingest to
  wiki", "update wiki for <project>", "sync the wiki", or invokes the wiki-ingest skill.
---

# Claude Code adapter

Read `.agents/skills/wiki-ingest/SKILL.md` in full and follow it as the canonical skill.
