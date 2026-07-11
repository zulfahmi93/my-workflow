---
name: clock-in-flow
description: Six-step WhatsApp clock-in orchestration with two independent pass flags (face match, geofence). No auto-rejection — both signals surfaced to the boss dashboard.
metadata:
  type: concept
  used_by: [tunas-lite]
---

# Clock-in flow

Domain concept used by [[tunas-lite]]. Employees clock in by sending a selfie + location pin via WhatsApp; the .NET orchestrator runs two independent checks (face match, geofence) and persists both pass flags. The dashboard surfaces both — humans, not the system, decide what counts as a valid clock-in.

## Flow

```
[Employee phone WhatsApp]
    │  selfie + location pin
    ▼
Meta Cloud API webhook (HTTPS POST, X-Hub-Signature-256)
    │
    ▼
[.NET 10 Minimal API]
    │  1. verify HMAC SHA-256 (raw body, constant-time compare)
    │  2. parse media_id + lat/lng + sender phone
    │  3. fetch selfie via Graph API media URL
    │  4. call gRPC FaceMatch(selfie_bytes, reference_embedding) → (similarity, matched)
    │  5. haversine(lat,lng, worksite) ≤ radius_m → geofence_pass
    │  6. write attendance row
    ▼
[Postgres 16]
    │
    ▼
[Next.js 16 dashboard] ← GET /api/attendance
```

## Pass-flag model

Two boolean columns persisted per `attendance` row:

| Column | Semantic | Failure behavior |
|---|---|---|
| `face_match_pass` | Cosine similarity ≥ threshold against stored reference embedding | Row still written; flag = false |
| `geofence_pass` | Haversine distance ≤ worksite radius | Row still written; flag = false |

Either flag can be false independently. **The orchestrator never auto-rejects** — every successful webhook produces a row. Demo dashboard renders both flags as badges so the boss decides whether to count it.

Unknown sender phone (not in `employees`) → silent drop, NO row created. This is the only path that doesn't persist.

## Why this shape

- **No auto-reject** keeps demo honest: face-match thresholds + geofence radii are tunable per worksite; baking the gate into the system would hide signal the partner needs to see to trust the model.
- **Both flags independent** mirrors how real attendance disputes happen: "I was on-site but the selfie failed" and "the selfie matched but GPS placed me at home" are different failure modes with different remediations.
- **Silent drop on unknown sender** prevents the system being weaponized as an unauthenticated public write endpoint via the Meta webhook surface.

## Security tier

Both [[tunas-lite]] cycles that touch this flow shipped under opus architect + `Security Reviewer` second-pass:

- **Cycle 3.1 — HMAC verification.** Raw body buffering (not deserialized JSON; signature verifies bytes-as-sent), constant-time hex compare via `CryptographicOperations.FixedTimeEquals`, GET verify-token + POST signature paths separately tested.
- **Cycle 3.5 — Orchestrator.** Unknown sender → silent drop; face/geofence failure persists row with respective pass flag false.

Threat models filed at `projects/rintis/tunas-lite/docs/cycles/3.1.md` + `projects/rintis/tunas-lite/docs/cycles/3.5.md`.

## Authoritative spec

`projects/rintis/tunas-lite/docs/plan-001.md` §"Core concept: clock-in flow" — full flow + per-phase contract decisions (gRPC `.proto`, HMAC verifier, orchestrator failure modes).

## Implementation refs

- Webhook + HMAC: `projects/rintis/tunas-lite/apps/api/Security/WhatsAppWebhookVerifier.cs`, `Security/WebhookSignatureMiddleware.cs`
- Payload parser: `projects/rintis/tunas-lite/apps/api/Webhook/WhatsAppPayloadParser.cs`
- Geofence: `projects/rintis/tunas-lite/apps/api/Geofencing/Geofence.cs` (haversine)
- Face-match gRPC contract: `projects/rintis/tunas-lite/proto/face.proto`
- Face-match server: `projects/rintis/tunas-lite/services/face/server.py`
- Face-match client: `projects/rintis/tunas-lite/apps/api/FaceClient/FaceMatchClient.cs`
- Orchestrator: `projects/rintis/tunas-lite/apps/api/Orchestration/ClockInOrchestrator.cs`
- Dashboard read endpoint: `projects/rintis/tunas-lite/apps/api/Endpoints/AttendanceEndpoint.cs`
- Schema: `projects/rintis/tunas-lite/supabase/migrations/001_init.sql`
