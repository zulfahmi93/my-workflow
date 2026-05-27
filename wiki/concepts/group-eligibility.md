---
name: group-eligibility
description: Free-text candidate group tags + per-category required group + per-election strict/permissive policy. Used by ballot-counter; no hardcoded gender.
metadata:
  type: concept
  used_by: [ballot-counter]
---

# Group eligibility

Domain concept used by [[ballot-counter]]. No hardcoded gender — purely free-text tags plus a per-election policy.

## Model

- **Candidates** have `groups text[]` — free-text tags (e.g. `{M}`, `{Sedan}`, `{}` = unrestricted).
- **Categories** have `required_group text` — `null` = any candidate valid; value = candidate must carry that tag.
- **Elections** have `group_policy: strict | permissive`.

## Policy behavior

| Policy | OCR input filtering | Group mismatch outcome |
|---|---|---|
| `strict` | API pre-filters candidates to eligible only before sending to OCR | mismatch impossible (filtered upstream) |
| `permissive` | all candidates sent to OCR | result flagged `NeedsReview` |

## Why this shape

Hardcoded gender (M/F) failed early. Malaysian school elections often use car-name groupings (Sedan, Hatchback, SUV) or other arbitrary tags. Free-text tags + per-election policy generalize to any voting form without schema changes.

## Authoritative spec

`projects/ballot-counter/docs/archive/plan-001/plan-001.md` §"Core concept: Group eligibility" — full rule set (frozen with plan-001 MVP).

## Implementation refs

- Schema: `projects/ballot-counter/supabase/migrations/001_init.sql` — `candidates.groups`, `categories.required_group`, `elections.group_policy`
- API layer: strict-policy pre-filter before OCR dispatch (ballot-counter .NET API)
- OCR service: `services/ocr/` returns `NeedsReview` flag on permissive mismatch
