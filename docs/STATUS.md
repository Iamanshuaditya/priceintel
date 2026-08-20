# Status

## Current milestone

PostgreSQL + durable-worker correctness gate passed in GitHub Actions. Next node: API/auth/workspace boundary backed by the real persistence layer.

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
- Failure-honest crawl state: failed attempts do not advance last successful verification.
- Real GitHub Actions Postgres + Redis service-container gate.
- Adversarial child-process worker-death test: process exits after DB commit and before queue acknowledgement; stalled replay produces no duplicate observation/change/outbox entry.

## Verified gates

- Foundation suite: **17/17 PASS** in GitHub Actions.
- SSRF/security suite: **6/6 PASS** in GitHub Actions.
- Deterministic vertical suite: **1/1 PASS** in GitHub Actions.
- PostgreSQL/BullMQ integration suite: **4/4 PASS** in GitHub Actions.
- Observable commit status: `priceintel/persistence-worker = success` for commit `4b120f6b4696cd5d7801f45d581cca066b8c823d`.

## In progress

- Complete OSS/license review of all required references.
- Replace bootstrap repository helpers with the API/auth/workspace application boundary.
- Plan first production crawler adapter/browser-worker integration behind the durable worker.

## Blocked

None for the current persistence/worker gate.

## Failed verification history

The first GitHub persistence run failed because BullMQ 6.1.1 requires an installed Redis client when using connection-options mode. No test was weakened. `ioredis@5.10.1` was added and the unchanged full gate passed on the next commit.

## Next actions

1. Add `User` + `Membership` persistence and owner/member authorization rules.
2. Add API boundary for workspace/product/listing CRUD and crawl enqueue.
3. Add API integration tests proving tenant isolation is enforced server-side.
4. Move the fixture-backed end-to-end path through API -> Postgres -> BullMQ -> worker -> observation query.
5. Add first operator UI showing current value, freshness, and monitoring health.
6. Add retailer adapter contract and browser fallback only after the API-backed vertical path is green.
7. Add actual notification delivery worker; the current outbox proves deduplicated notification intent, not external delivery.

## Known risks

- Node native type stripping remains a bootstrap execution mechanism, not the final compiler/build strategy.
- No committed npm lockfile yet; direct dependencies are pinned but transitive resolution is not frozen.
- The pinned HTTP transport buffers response bodies with a configured cap; streaming/parsing policy needs review before large-scale crawling.
- Browser fallback and retailer-specific transport/session policies are not implemented yet.
- International price parsing is intentionally deferred; ambiguous formats are rejected.
- Notification outbox delivery, retry, signing, and provider failure behavior are not implemented yet.

## Deferred intentionally

- Consumer tracker/browser extension.
- Automated repricing writes.
- Automatic product matching.
- Billing.
- AI extraction.
