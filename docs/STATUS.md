# Status

## Current milestone

Persistence/worker hardening gate passed in GitHub Actions, including out-of-order completion correctness, locked dependency installation, strict TypeScript typecheck, and a real build. Next node: `User` + `Membership` -> owner/member authorization -> API-backed product/listing/crawl vertical.

## Completed

- Repository initialized and product direction encoded in docs.
- Loop state and verification log established.
- Deterministic fixture commerce server.
- DNS-pinned HTTP(S) transport with per-hop SSRF validation and connected-peer verification.
- Generic JSON-LD Product/Offer extraction.
- Tri-state stock semantics: `IN_STOCK`, `OUT_OF_STOCK`, `UNKNOWN`.
- US-first price parser rejects ambiguous non-US comma-decimal values instead of misreading them.
- PostgreSQL schema for workspace-scoped products, listings, crawl runs, append-only observations, change events, and notification outbox.
- Database-level crawl idempotency through `UNIQUE(crawl_run_id)` and stable `UNIQUE(job_key)` identity.
- Composite workspace foreign keys prevent cross-tenant product/listing/observation wiring.
- Listing-row locking serializes observation/change derivation for a listing.
- Redis/BullMQ crawl queue and worker boundary.
- BullMQ custom job IDs derived from stable job keys; PostgreSQL remains the correctness authority on replay.
- Transactional observation + change-event + notification-outbox creation.
- Failure-honest crawl state: failed attempts do not fabricate successful observations.
- Materialized listing state is monotonic by verified observation time: a late older success is retained in history but cannot roll current price/stock/last-success backward or create a reverse alert.
- Late older failures cannot overwrite health/freshness established by a newer crawl attempt.
- Real GitHub Actions PostgreSQL + Redis service-container gate.
- Adversarial child-process worker-death test: process exits after DB commit and before queue acknowledgement; stalled replay produces no duplicate observation/change/outbox entry.
- Committed npm lockfile (`lockfileVersion: 3`) freezes the dependency graph used by CI.
- CI installs with `npm ci`, runs in read-only repository-content mode, and caches npm artifacts.
- Strict TypeScript compiler gate (`npm run typecheck`) and emitted build gate (`npm run build`) are active.

## Verified gates

GitHub Actions run `32331047267` on commit `bf5da5ced8672e71561a80d0aa857fd07137aafa` published `priceintel/hardening = success`.

- TypeScript strict typecheck: **PASS**.
- Foundation suite: **17/17 PASS**.
- SSRF/security suite: **6/6 PASS**.
- Deterministic vertical suite: **1/1 PASS**.
- PostgreSQL/BullMQ integration suite: **6/6 PASS**.
- TypeScript build: **PASS**.

The integration gate now includes explicit regressions for out-of-order successful completion and for an older failure arriving after a newer successful crawl.

## In progress

- Complete OSS/license review of all required references.
- Add real user/membership persistence and the API authorization boundary.
- Plan first production retailer/browser worker integration behind the durable worker.

## Blocked

None for the current persistence-hardening gate.

## Failed verification history

1. Initial persistence run `32329535448` failed because BullMQ 6.1.1 needed its Redis client dependency. `ioredis@5.10.1` was added; the unchanged worker-replay test then passed.
2. First TypeScript hardening run `32330894297` generated the lockfile successfully but failed strict typecheck because an existing test fixture widened `stockStatus` to plain `string`. The fixture was typed as `PriceObservation`; strictness was not reduced. The next full run passed.

## Next actions

1. Add `users` + `memberships` persistence with `OWNER` / `MEMBER` roles.
2. Implement authenticated workspace authorization at the server/API boundary.
3. Add workspace/product/listing CRUD and crawl-enqueue API endpoints.
4. Add API integration tests proving User A cannot access Workspace B even with guessed entity IDs.
5. Move the fixture-backed path through API -> PostgreSQL -> BullMQ -> worker -> observation/history API query.
6. Verify `$100 -> $90 -> malformed page` through that real API path, preserving `$90` as current while health becomes `PARSE_FAILED`.
7. Only after that gate is green, add the first small operator UI: login, workspace, products, listings, current price, freshness, health, trigger crawl, basic history.
8. Add actual notification delivery worker later; the current outbox proves deduplicated notification intent, not external delivery.

## Known risks

- Tests still use Node's TypeScript stripping for direct test execution, but the repository now has independent strict `tsc` typecheck and emitted-build gates.
- The pinned HTTP transport buffers response bodies with a configured cap; streaming/parsing policy needs review before large-scale crawling.
- Browser fallback and retailer-specific transport/session policies are not implemented yet.
- International price parsing is intentionally deferred; ambiguous formats are rejected.
- Notification outbox delivery, retry, signing, and provider failure behavior are not implemented yet.
- Equal `verified_at` observations currently use ID ordering as a deterministic tie-breaker; future source/event identity may justify a stronger sequence key.

## Deferred intentionally

- Consumer tracker/browser extension.
- Automated repricing writes.
- Automatic product matching.
- Billing.
- AI extraction.
