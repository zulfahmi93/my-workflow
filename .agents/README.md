# Agent configuration

This directory is the provider-neutral source of truth for shared agent behavior.

| Path | Purpose |
|---|---|
| `roles/` | Specialist role definitions with portable `name` and `description` frontmatter |
| `rules/` | Shared lifecycle, TDD, review, commit, and documentation policies |
| `skills/` | Agent Skills-compatible procedures |
| `workflows/` | Vendor-neutral orchestration specifications |
| `scripts/` | Portable policy checks, validators, and adapter maintenance |

Provider-specific directories are adapters, not alternate sources of truth. Claude Code uses `.claude/` for discovery, model/tool metadata, hooks, and executable Workflow DSL files. Codex uses `.codex/` for generated custom-agent TOML files, project settings, and hook wiring; repo skills are discovered directly from `.agents/skills/`.

Portable path-policy scripts accept absolute paths or paths relative to the repository root.

After changing a canonical role or skill, refresh the provider discovery adapters:

```bash
node .agents/scripts/sync-claude-adapters.mjs
node .agents/scripts/sync-codex-adapters.mjs
```

Validate canonical sources, provider adapters, local links, and policy behavior:

```bash
node .agents/scripts/validate-agent-config.mjs
node .agents/scripts/test-agent-config.mjs
```
