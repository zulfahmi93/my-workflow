---
name: ai-receipt-maker
description: Multi-output receipt renderer (PDF + PNG + SVG via SkiaSharp). .NET SDK + API + CLI + Telegram bot + Flutter macOS demo. Plan 001 shipped 2026-05-11; no active milestone.
metadata:
  type: project
  status: plan-001-landed
  last_ingested: 2026-05-16
---

# Receipt Toolkit

**Status:** Plan 001 landed in full 2026-05-11 (frozen at `docs/archive/progress-001-phases-0-through-3c-polish.md`). No active milestone. Candidates pending user direction (car-workshop pivot, operational re-verification, worktree harness fix).

## What

Turns structured `ReceiptData` JSON into validated PDF + PNG + SVG receipts. Shipped as a .NET SDK plus four consuming surfaces: ASP.NET Core API (Minimal API + OpenAPI), System.CommandLine CLI, Telegram long-polling bot (JSON message handler), and Flutter macOS demo client.

Last-known green (2026-05-11): **184 .NET tests on macOS** / **186 on Linux CI** (build 0/0), **30 Flutter tests** (`flutter analyze` clean). Golden bytes regenerated post-workshop-fixture: PDF 165286 B, PNG 165768 B.

## Why

Receipt rendering across multiple consuming surfaces (API, CLI, bot, mobile) is normally tackled by stitching three different libraries (one for PDF, one for raster, one for vector) — which means three sets of layout bugs and three font fallbacks. Plan 001 proves a single SkiaSharp render path can drive all three output formats via different canvas backends ([[skia-tri-output-rendering]]), keeping layout + fonts + theme colours behaviorally identical across PDF, PNG, and SVG.

Money handling is deliberately strict — decimal end-to-end with JSON **string** serialization (ADR 0002) and `MidpointRounding.AwayFromZero` for consumer round-half-up — because float-driven receipts are a chronic source of complaint disputes downstream.

## Core domain concept

[[skia-tri-output-rendering]] — render once with SkiaSharp, export through three canvas backends (SKDocument for PDF, SKBitmap for PNG, SKSvgCanvas for SVG). Same `IReceiptSection` implementations, same `FontProvider` typefaces, same `ThemeColors` palette.

## Stack (pinned in `Directory.Packages.props`)

| Component | Version |
|---|---|
| .NET SDK | 10.0.105 (LTS, EOL 2028-11-14) |
| Flutter | 3.41.9 stable |
| SkiaSharp | 4.147.0-preview.1.1 (preview pinned — Inter VF weight-axis API; see `archive/divergences-001.md#div-16`) |
| QRCoder | 1.8.0 |
| Telegram.Bot | 22.9.6.2 |
| xUnit v3 | 3.2.2 (FluentAssertions NOT used — v8+ moved to commercial license) |
| Microsoft.NET.Test.Sdk | 17.14.1 |
| PdfPig | 0.1.10 |
| NSubstitute | 5.3.0 |
| System.CommandLine | 2.0.7 GA |
| Inter Variable Font | v4.1, OFL-1.1, embedded |

Verify live versions before quoting — user upgrades mid-project.

## Layout

```
projects/personal/ai-receipt-maker/
├── receipt-toolkit.sln                10 .NET projects
├── Directory.{Build,Packages}.props   analyzers + CPM pins
├── docs/                              PROGRESS.md, adr/, archive/, plans/, api/openapi.json
├── mockups/receipt.png                design source of truth
├── examples/                          fixture + golden bytes (Linux-only golden gate)
├── src/
│   ├── ReceiptToolkit.Contracts/      JSON + validation + time
│   ├── ReceiptToolkit.Core/           validate → calculate → Skia render-export
│   ├── ReceiptToolkit.Cli/            System.CommandLine
│   ├── ReceiptToolkit.Api/            Minimal API + ProblemDetails + OpenAPI
│   └── ReceiptToolkit.TelegramBot/    long-polling worker
├── tests/                             5 xUnit v3 projects
└── apps/receipt_demo_flutter/         Flutter macOS demo
```

Resume: `dotnet build receipt-toolkit.sln` (NOT `dotnet test --no-build` — masks analyzer-as-error regressions). Code Reviewer has no Bash, so orchestrator-side build is the only authoritative gate.

## Plan-001 status

**Plan:** archived at `projects/personal/ai-receipt-maker/docs/archive/plan-001-receipt-toolkit-tdd.md`. Phase 9 V9.7 execution report at `docs/TDD-EXECUTION-REPORT.md`.

| Phase | Description | Status |
|---|---|---|
| 0–3c | Full SDK + API + CLI + bot + Flutter demo + polish | ✅ Shipped 2026-05-11 |

**Active follow-ups:** none (no milestone scoped). Candidates blocked on user direction — see `docs/PROGRESS.md` "Current milestone" block.

**ADRs filed:**

| ADR | Decision |
|---|---|
| 0001 | SkiaSharp as render engine ([[skia-tri-output-rendering]]) |
| 0002 | Decimal money + JSON string serialization |
| 0003 | Bot polling vs webhook (long-polling now; webhook deferred) |
| 0004 | Font embedding (Inter VF, OFL-1.1) |

## Authoritative sources

- Current state: `projects/personal/ai-receipt-maker/docs/PROGRESS.md`
- Plan-001 (frozen): `projects/personal/ai-receipt-maker/docs/archive/plan-001-receipt-toolkit-tdd.md`
- Phase history: `projects/personal/ai-receipt-maker/docs/archive/progress-001-phases-0-through-3c-polish.md`
- Divergences (numbered, anchored): `projects/personal/ai-receipt-maker/docs/archive/divergences-001.md`
- ADRs: `projects/personal/ai-receipt-maker/docs/adr/0001..0004`
- Forward plans: `projects/personal/ai-receipt-maker/docs/plans/` (e.g. `001-car-workshop-jobcard.md`)
- README (architecture overview + setup): `projects/personal/ai-receipt-maker/README.md`
- Project operational rules: `projects/personal/ai-receipt-maker/CLAUDE.md`
