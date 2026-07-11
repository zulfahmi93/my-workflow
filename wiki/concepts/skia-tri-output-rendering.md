---
name: skia-tri-output-rendering
description: Render receipts once with SkiaSharp; export to PDF + PNG + SVG by swapping the canvas backend. Same sections, same fonts, same theme — three outputs.
metadata:
  type: concept
  used_by: [ai-receipt-maker]
---

# SkiaSharp tri-output rendering

Domain concept used by [[ai-receipt-maker]]. One render path; three output formats. The renderer measures + draws into an abstract `SKCanvas`, and the canvas backend determines the output format — no per-format layout duplication.

## Model

```
ReceiptData
    │
    ▼
Validate + Calculate (Core)
    │
    ▼
For each IReceiptSection:
    Measure(SKFont)  →  height
    Draw(SKCanvas)   →  output
    │
    ├── SKDocument (PDF backend)  → multi-page PDF
    ├── SKBitmap   (raster)       → PNG @ 2x scale, with shadow
    └── SKSvgCanvas (vector)      → SVG, no shadow
```

| Output | Canvas backend | Notes |
|---|---|---|
| PDF | `SKDocument` (paginated) | Multi-page output; section break on overflow |
| PNG | `SKBitmap` raster | 2× scale; drop-shadow enabled by default |
| SVG | `SKSvgCanvas` (vector) | No shadow (SVG filters are inconsistent across viewers) |

Linux-only golden byte tests gate the PDF + PNG outputs (`archive/divergences-001.md#div-23`). macOS local runs skip them; CI on Linux is the source of truth.

## Why this shape

- **No layout duplication.** Stitching three libraries (a PDF library + a raster library + a vector library) means three different layout engines, three font fallbacks, and three sets of "looks fine in PDF but wrong in PNG" bugs. One Skia path with three canvas backends keeps layout + measurement behaviorally identical.
- **Deterministic fonts.** `FontProvider.GetTypeface` returns the embedded Inter VF; no system fallback. The same glyph metrics drive every output, so wrap-line counts + cell widths match across formats.
- **`IClock` injected.** Render is deterministic — same input + same clock → byte-identical PDF + PNG (modulo Linux/macOS Skia builds, hence Linux-only golden gate).

## Constraints carried by the renderer

- **Logo source: file path or `data:` base64 only.** No HTTP fetch in renderer — keeps rendering deterministic + SSRF-safe.
- **Fonts: `FontProvider.GetTypeface` only.** No `SKTypeface.Default`, no system fallback. No `SKFont.MeasureText` in section code — sections call `TextMeasurer.Measure` / `TextMeasurer.WrapLines`.
- **Theme colours: `ThemeColors.ResolveOrDefault` only.** No per-section `ResolveColor` helpers, no raw `SKColor.Parse` outside theme code.
- **Sections READ from `ReceiptData`.** Zero hardcoded user-visible strings, zero hardcoded theme colours. Layout numerics from `data.Layout` where the contract carries them; otherwise local consts.
- **Omitted-section contract:** toggle off → `Measure` returns `0f`, `Draw` paints nothing.

## Authoritative spec

- ADR 0001 — SkiaSharp as render engine: `projects/personal/ai-receipt-maker/docs/adr/0001-skiasharp-as-render-engine.md`
- ADR 0004 — Font embedding: `projects/personal/ai-receipt-maker/docs/adr/0004-font-embedding.md`
- Plan-001 (frozen): `projects/personal/ai-receipt-maker/docs/archive/plan-001-receipt-toolkit-tdd.md`
- Divergence #16 (SkiaSharp 4 preview pin for VF axis API): `projects/personal/ai-receipt-maker/docs/archive/divergences-001.md#div-16`
- Divergence #23 (Linux-only golden gate): `projects/personal/ai-receipt-maker/docs/archive/divergences-001.md#div-23`

## Implementation refs

- Core render entrypoint + exporter trio: `projects/personal/ai-receipt-maker/src/ReceiptToolkit.Core/`
- Section interface: `IReceiptSection` (file-scoped namespace `ReceiptToolkit.Core.Rendering.Sections`)
- Font provider: `projects/personal/ai-receipt-maker/src/ReceiptToolkit.Core/` → `FontProvider`
- Theme colours: `ThemeColors.ResolveOrDefault`
- Text measurement helpers: `TextMeasurer.Measure`, `TextMeasurer.WrapLines`
- Golden bytes (Linux CI gate): `projects/personal/ai-receipt-maker/examples/golden/sample_receipt_data.golden.{pdf,png}`
