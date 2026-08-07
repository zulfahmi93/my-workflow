#!/bin/bash
set -u

file_path=${1:-}
[ -z "$file_path" ] && exit 0

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
generator="$repo_root/tools/docs-gen"
[ -d "$generator" ] || exit 0

absolute_path=$(python3 -c 'import os, sys; root, item = sys.argv[1:]; print(os.path.normpath(item if os.path.isabs(item) else os.path.join(root, item)))' "$repo_root" "$file_path") || exit 2

case "$absolute_path" in
  "$repo_root"/*) ;;
  *) exit 0 ;;
esac

case "$absolute_path" in
  */docs/plan-*.yaml)   kind=plan ;;
  */docs/cycles/*.yaml) kind=cycle ;;
  *) exit 0 ;;
esac

# A fresh clone has tools/docs-gen but no node_modules until someone runs `npm i` there. Every
# validator below imports ajv/yaml, so without it they exit non-zero for a missing dependency —
# which this hook would report as a failed edit. Skip loudly instead: a missing toolchain is an
# environment state, never a defect in the file just written.
if [ ! -d "$generator/node_modules" ]; then
  echo "docs-yaml validator: $generator/node_modules missing — validation SKIPPED (run: cd tools/docs-gen && npm i)" >&2
  exit 0
fi

if [ "$kind" = plan ]; then
  # Validate THE FILE THAT CHANGED. This branch used to run a bare `npm run validate`, which
  # walks projects.config.json and re-checks every registered plan — so it never opened the
  # edited file at all unless that file was already registered, and it reported errors belonging
  # to other plans as if the edit had caused them. The blind window is exactly the authoring
  # session: docs-site.md §Onboarding checklist puts "author plan-NNN.yaml" at step 1 and
  # "add { id } to projects.config.json" at step 2, so a NEW plan is unregistered for its whole
  # first session — hundreds of lines written against a green hook, every violation surfacing at
  # once at registration. The cycle-note branch below always passed its own path; this one now does too.
  #
  # Registered → generate.mjs already accepts positional `[project] [plan]` (see its header), so
  # narrow the existing entry point rather than inventing a second one; node directly, not
  # `npm run`, because npm adds ~90ms of startup to a hook that fires on every save.
  project=""
  plan_id=""
  coords=$(python3 -c '
import json, os, sys
generator, root, target = sys.argv[1:4]
try:
    registry = json.load(open(os.path.join(generator, "projects.config.json")))
except Exception:
    sys.exit(0)  # unreadable registry: print nothing, let the caller fall back
name = os.path.basename(target)
parent = os.path.dirname(target)
for project in registry.get("projects", []):
    if os.path.normpath(os.path.join(root, project.get("docsRoot") or "")) != parent:
        continue
    for plan in project.get("plans", []):
        plan_id = str(plan.get("id", ""))
        if (plan.get("yaml") or "plan-" + plan_id + ".yaml") == name:
            print(project.get("name", ""))
            print(plan_id)
            sys.exit(0)
' "$generator" "$repo_root" "$absolute_path") || coords=""
  if [ -n "$coords" ]; then
    project=${coords%%$'\n'*}
    plan_id=${coords#*$'\n'}
    # The lookup prints two lines or nothing. A one-line reply leaves both halves holding the
    # same string, and `--validate <name> <name>` filters the registry to an empty set and exits
    # 0 — valid by vacuum, the exact failure mode this whole fix exists to remove. Fall back.
    [ "$plan_id" = "$project" ] && { project=""; plan_id=""; }
  fi

  if [ -n "$project" ] && [ -n "$plan_id" ]; then
    output=$(cd "$generator" && node generate.mjs --validate "$project" "$plan_id" 2>&1)
    status=$?
  else
    # Not in the registry (yet). `generate.mjs --validate <project>` filters the registry, so an
    # unknown project matches nothing and exits 0 — silently "valid". Go straight to the same
    # schema + referential-integrity check the generator uses (schema/plan.schema.json via
    # validate-source.mjs), so a brand-new plan is covered from its first save.
    #
    # Absent file → nothing to validate. This fires PostToolUse(Edit|Write), so the target
    # normally exists; when it does not the write never landed, and reporting ENOENT as
    # "validation failed" would fail the tool call for an environment state. The registered
    # route deliberately keeps its own loud behaviour here — a plan listed in
    # projects.config.json with no source file is a registry error, not a missing input.
    [ -f "$absolute_path" ] || exit 0
    output=$(cd "$generator" && node -e '
const [modulePath, target] = process.argv.slice(1);
import(require("node:url").pathToFileURL(modulePath).href)
  .then((mod) => mod.validateFile(target, target))
  .catch((err) => { console.error(err.message || err); process.exitCode = 1; });
' "$generator/lib/validate-source.mjs" "$absolute_path" 2>&1)
    status=$?
    [ "$status" -ne 0 ] && output="$output
  (not in tools/docs-gen/projects.config.json — schema + integrity only; register it per .agents/rules/docs-site.md to get the build check too)"
  fi
else
  output=$(cd "$generator" && npm run --silent validate-cycle-note -- "$absolute_path" 2>&1)
  status=$?
fi

if [ "$status" -ne 0 ]; then
  echo "documentation YAML validation failed:" >&2
  echo "$output" >&2
  exit 2
fi
