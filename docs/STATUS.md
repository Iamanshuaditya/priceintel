# Status

## Current milestone

The first browser-backed operator vertical is accepted. PriceIntel now has durable PostgreSQL/BullMQ processing, migration discipline, authenticated tenant-scoped API access, an HttpOnly browser session boundary, a deliberately small operator UI, and a real Playwright browser E2E that proves healthy, price-change, and failure-honesty states.

GitHub Actions run `32334339220` on commit `c8fda2a1fa78da552169848c9bde3a88c7d2f3e3` published `priceintel/hardening = success` and uploaded browser evidence artifact `9394100566` (`sha256:f60680cc5f84209092a58ea4a215e2b92f7ea8b8c14d7342615c2c95861bad78`).

The product question now changes from “can the application behave correctly?” to “can the crawler produce measurably correct ecommerce observations on the real Internet?”

## Completed

- Repository/product thesis and loop-engineering documentation.
- Deterministic commerce fixture server.
- DNS-pinned HTTP(S) transport with per-hop SSRF validation and connected-peer verification.
- Generic JSON-LD Product/Offer extraction.
- Tri-state stock semantics: `IN_STOCK`, `OUT_OF_STOCK`, `UNKNOWN`.
- US-first parser rejects ambiguous comma-decimal prices instead of misreading them.
- PostgreSQL authority for workspaces, products, listings, crawl runs, observations, changes, notification intent, auth sessions, and materialized current state.
- DB-enforced replay/idempotency and composite tenant foreign keys.
- Listing-row serialization and monotonic current-state semantics under out-of-order completion.
- BullMQ at-least-once worker with adversarial process-death replay test.
- Immutable ordered migration ledger with SHA-256 checksums and PostgreSQL advisory locking.
- `API_AUTO_MIGRATE` / `WORKER_AUTO_MIGRATE` are opt-in development conveniences; explicit migration execution is the deployment model.
- `users`, `memberships`, `OWNER` / `MEMBER` authorization, opaque sessions, scrypt password hashing, and session expiration.
- Browser session transport through `priceintel_session` HttpOnly cookie while Bearer auth remains available for API/CLI callers.
- Same-origin CSRF enforcement for cookie-authenticated writes.
- Logout revokes the persisted session.
- Login/register rate limiting before unbounded password-hash work.
- Workspace/product/listing APIs plus DB-backed crawl status (`QUEUED | RUNNING | SUCCEEDED | FAILED`).
- Minimal operator UI: login/account creation, workspace, products, listings, current verified price, stock, freshness, health, source/confidence, Check Now, history, and changes.
- Failure-honest operator state explicitly labels a failed verification while preserving the last successfully verified value.
- Real Chromium Playwright E2E with CI screenshot evidence.
- Locked dependencies (`package-lock.json`), `npm ci`, strict TypeScript typecheck, emitted build, and compiled migration execution in CI.

## Browser acceptance evidence

Successful browser run `32334339220` captured:

1. `01-healthy-100.png` — `$100`, `IN_STOCK`, `HEALTHY`.
2. `02-price-change-90.png` — current `$90`, two historical observations, semantic `$100 -> $90` change.
3. `03-parse-failed-preserves-90.png` — `PARSE_FAILED`, newer attempt timestamp, older successful-verification timestamp, failure count `1`, and last verified `$90` preserved without being represented as fresh.

The artifact was independently visually reviewed after CI and accepted.

## Failed verification history worth preserving

1. `32329535448`: BullMQ required the Redis client dependency; exact `ioredis` dependency added, unchanged replay test passed.
2. `32330894297`: strict TypeScript caught a widened test literal; fixture typing fixed without lowering strictness.
3. `32333430612`: browser/API work first failed strict typing of the retry header; source fixed, assertions unchanged.
4. `32334014925`: first real Playwright run exposed a UI hidden-state bug. CSS `display:grid` made `[hidden]` workspace content interactive before workspace initialization, causing `POST /v1/workspaces/null/products`. The UI was fixed with an explicit `[hidden]{display:none!important}` rule; the unchanged browser E2E then passed in `32334339220`.

## In progress — Retailer Reliability

Next major program:

1. extraction/retailer adapter contract with explicit adapter/version provenance;
2. move generic structured extraction behind that contract;
3. evidence metadata and extraction traces;
4. deterministic Shopify + major-retailer adapter fixtures/contracts;
5. controlled real-URL corpus and a non-blocking live-canary command;
6. reliability metrics/reporting, including manual correctness sampling;
7. browser fallback only when lightweight extraction lacks enough confidence;
8. browser-specific SSRF/network policy before any production `page.goto(userUrl)` path;
9. scheduled live-canary workflow separated from blocking deterministic CI.

## Known risks / intentionally open

- Real-world retailer extraction correctness and block/challenge rate are not measured yet.
- Browser crawler network isolation equivalent to the hardened HTTP transport is not implemented yet.
- Retailer/session/proxy policy is not implemented yet.
- Evidence retention/redaction policy is not implemented yet.
- International price parsing remains intentionally deferred.
- Notification delivery beyond transactional outbox intent remains open.
- Equal `verified_at` observations still use ID ordering as a deterministic tie-breaker.

## Deferred intentionally

- MAP enforcement.
- Billing.
- Automated repricing writes.
- Automatic product matching.
- Consumer browser extension.
- Broad analytics/dashboard polish.
- AI extraction until deterministic reliability measurement exists.
