---
name: design-system-pivot
description: Rintis Tech landing's token-locked editorial design system, and the 2026-05-17 pivot from the Mistral-inspired sunset/cream look to the dark forest-green + lime system that ships v1. Used by [[rintis-landing]].
metadata:
  type: concept
  used_by:
    - rintis-landing
  last_ingested: 2026-05-17
---

# Design system + brand pivot — Rintis Tech landing

Token-locked design system for `rintis.tech`. Source of truth: `projects/rintis-landing/DESIGN.md` (alpha, `@google/design.md` grammar). Used by [[rintis-landing]].

## Model — the rules that ship v1

**System identity (post-pivot):** dark editorial forest-green with a lime accent. Atmospheric WebGL `waterPlane` shader hero in three greens, grain, soft waveforms. Editorial typography pairing — heavy uppercase Inter (geometric, brutal-elegant) for display + Fraunces italic for body ledes. Cards = charcoal-green with hairline borders. Primary CTAs = lime-on-`ink-0`. **NO pill buttons.**

| Token family | Values (selected) |
|---|---|
| Ink scale (backgrounds) | `ink-0` `#06120c` (canvas) → `ink-1`…`ink-4` `#234d35`, `mid` `#2e6243` |
| Lime accent | `lime` `#c5e86c` (= `primary`), `lime-deep` `#a8cc4a`, `lime-soft` `#d8f088`, `lime-glow`, `lime-line` |
| On-dark text | `on-dark` `#fff`, `-mute` 72%, `-dim` 52%, `-faint` 28% |
| Hairlines | `hairline` 8%, `hairline-2` 14% |
| WhatsApp-demo tokens | `wa-header`, `wa-bg`, `wa-bubble-them`, `wa-bubble-me` (powers the WhatsApp Bot demo component) |
| Cream | `cream` `#f4ead2` — retained ONLY as the lime-stripe terminus, no longer a surface |

**Typography pairing (non-negotiable):**

- Display = **Inter** uppercase, heavy weights (`hero-display` 132/0.96/-3px, `section-title` 64/1.02/-1.5px, `hero-secondary` 84/0.96/+4px tracking).
- Editorial voice = **Fraunces** italic light (`display-italic` 30, `lede` 26, `numeric-display` 80).
- UI/body = **Inter** regular (`body` 15, `body-sm` 13.5, `eyebrow` 11 uppercase 2.4px tracking).
- **JetBrains Mono** only inside `code` blocks. Never sub the editorial face with a generic serif fallback in production — it carries the brand voice.

**Geometry (the most-violated rule):** `rounded.md` 8px on buttons, `rounded.lg` 12px on cards. `rounded.full` is reserved for **badges + the rare pill tab** — **no pill buttons**, ever. This was the single most violated Mistral-style rule on first attempts and survives the pivot unchanged.

**Lime-stripe band (continuity element):** every page MUST close with the `lime-stripe` band directly above the footer. Gradient: `ink-0` 0% → `mid` 18% → `ink-4` 32% → `lime-deep` 56% → `lime` 74% → `lime-soft` 90% → `cream` 100%. Dropping it breaks brand continuity (formerly the sunset-stripe; the rule survives the pivot, only the colors changed).

**Lime is rationed.** Reserved for primary CTAs, active nav state, accents, eyebrow rules, and the lime-stripe band. Do NOT bleed into decorative chrome.

**Token bridge:** CSS variables use `--rt-*` prefix (`--rt-ink-0`, `--rt-lime`, `--rt-lime-line`), defined once in `app/globals.css :root`. Tailwind 4 utilities consume via `@theme` — **never hardcode color values in component classes**. If a component needs a value not in `DESIGN.md`, add the token first, then consume.

## Brand-vs-company naming (load-bearing)

- **Company:** Rintis AI (legal + long-term identity, internal repo + org name).
- **Brand on this domain:** **Rintis Tech**. Public copy — page titles, meta tags, hero headlines, footer wordmarks, OG tags — ships as "Rintis Tech", NOT "Rintis AI", until `rintis.ai` becomes affordable.
- The split is intentional and lives until the user explicitly flips it.

## The 2026-05-17 pivot

Original `DESIGN.md` documented a **Mistral-inspired sunset/cream system**: orange `#fa520f` primary, PP Editorial Old (near-serif display), Inter UI, cream-yellow surfaces (`{colors.cream}`, `{colors.surface-cream-soft}`), warm mountain-sunset hero photography brief, sunset-stripe band (`primary` → `sunshine-700` → `sunshine-500` → `yellow-saturated` → `cream`).

After the company-profile-deck content review confirmed the green direction better matches Rintis Tech's positioning, the system pivoted to **dark forest-green + lime**. Historical Mistral system is preserved in git history; do not resurrect without owner approval.

**What survived the pivot:**

- NO pill buttons rule.
- A stripe band must close every page above the footer (now `lime-stripe`, was `sunset-stripe`).
- Editorial typography pairing (display face + Inter UI) — the *faces* changed (Fraunces replaces PP Editorial Old; Inter is now ALSO the display face in heavy weights), but the editorial-vs-UI split discipline survived.
- Token-locked discipline (every CSS variable + Tailwind token resolves to a `DESIGN.md` token; lint via `@google/design.md`).
- Brand naming split (Rintis Tech on this domain, Rintis AI internally).

**Known lag:** `projects/rintis-landing/CLAUDE.md` "Design system guardrails" section still documents the Mistral sunset system as of 2026-05-17 — `DESIGN.md` v-alpha is authoritative. CLAUDE.md needs a follow-up edit.

## Why this shape

- **Editorial-grade typography (magazine-tight leading) + sober geometry** is the brand voice — small AI consultancy presenting as a serious editorial publisher, not a generic SaaS landing.
- **Token-locked via `@google/design.md`** so visual drift is structurally impossible: a component reaching for an off-token magnitude fails the design-doc lint, not just code review.
- **Lime rationing + stripe band** are continuity gestures — a single saturated color is the brand's identity hook across an otherwise sober palette; the stripe is the visual signature every page carries.
- **Dark canvas (`ink-0` `#06120c`)** matches the company-profile-deck direction and reads more credible for the AI/automation positioning than the warmer Mistral cream surfaces did.
- **NO pill buttons** is the Mistral-inheritance discipline — pill CTAs read as generic-marketing-template, which is the trap this brand is trying to avoid.

## Authoritative spec

- `projects/rintis-landing/DESIGN.md` (alpha — token-locked, `@google/design.md` grammar)
- `projects/rintis-landing/CLAUDE.md` §"Design system guardrails" (lags the pivot as of 2026-05-17)

## Implementation refs

- `projects/rintis-landing/app/globals.css` — `--rt-*` CSS variable definitions
- `projects/rintis-landing/app/_components/hero-shader.tsx` — WebGL `waterPlane` shader (three greens)
- `projects/rintis-landing/app/_components/sections.tsx` — 11 stacked landing sections
- `projects/rintis-landing/app/_components/nav.tsx` — fixed top nav with lime-underline scroll-spy
- `projects/rintis-landing/app/_components/whatsapp-demo.tsx` — consumes `wa-*` tokens
- `projects/rintis-landing/public/assets/logo-black.png` + `logo-white.png` — derived from canonical `docs/branding/logo.png`
