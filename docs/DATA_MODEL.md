# Data Model

## Authority and invariants

PostgreSQL is the authority for tenant data, authentication/session state, durable crawl identity, **crawl configuration and market contract**, observations, semantic changes, notification intent, migration history, and materialized listing state. Redis/BullMQ schedules and redelivers work but is not trusted to provide exactly-once business effects or authoritative listing configuration.

## Core entities

- `workspaces`: tenant root.
- `users`: normalized email + password hash.
- `memberships`: `(user_id, workspace_id)` role assignment with `OWNER | MEMBER`.
- `sessions`: opaque login sessions; only token hashes are persisted, with expiration/revocation by deletion.
- `products`: workspace-scoped internal catalog.
- `competitor_listings`: monitored URLs, market contract, and current materialized monitoring state.
- `crawl_runs`: durable identity and status for one logical crawl (`QUEUED | RUNNING | SUCCEEDED | FAILED`).
- `price_observations`: append-oriented verified facts.
- `change_events`: semantic forward changes derived only when a new chronological head is accepted.
- `notification_outbox`: deduplicated external-delivery intent created transactionally with changes.
- `schema_migrations`: immutable applied migration ledger (`version`, `name`, SHA-256 `checksum`, `applied_at`).

## Listing market contract — migration 004

`004_listing_market_context.sql` adds:

- `competitor_listings.expected_currency char(3) NOT NULL`;
- `competitor_listings.market_country char(2) NULL`;
- `competitor_listings.locale text NULL`.

Existing listings are backfilled from their parent product's currency before `expected_currency` becomes non-null.

New API listings default `expected_currency` from `products.currency`, while callers may explicitly configure another valid 3-letter currency. Country and locale are optional explicit market intent.

`expected_currency` is the currently enforced safety invariant. `market_country` / `locale` do not yet guarantee that every retailer request is actively localized; they preserve the intended market so retailer-specific request behavior can be added later without guessing from worker geography.

## Authoritative crawl configuration

BullMQ crawl data is intentionally limited to:

- `workspaceId`;
- `listingId`;
- `crawlRunId`;
- `jobKey`.

It does **not** persist authoritative product ID, URL, currency, country, or locale.

After claiming a crawl run, the worker loads current configuration from `competitor_listings` in PostgreSQL. This means a listing URL or market contract changed after enqueue but before execution is honored at execution time instead of using stale queue data.

## Tenant isolation

Important relationships use `(entity_id, workspace_id)` composite foreign keys. This prevents rows from claiming a product/listing/crawl belonging to another workspace even if application code supplies wrong IDs.

The API also scopes every workspace/entity query through authenticated membership. DB constraints are defense in depth, not a substitute for authZ.

## Migration discipline

Migration files are discovered in ordered version sequence. The runner acquires a PostgreSQL advisory lock, validates every previously applied migration’s name/checksum, applies each pending migration transactionally, and records it in `schema_migrations`.

An applied migration is immutable: editing an already applied migration produces a checksum mismatch and migration failure rather than silently applying changed historical SQL.

Production deployment should run migrations explicitly before API/worker startup. API/worker auto-migration is opt-in for development.

Integration-test `migrate(pool)` now delegates to the same full ledger runner so tests exercise migrations 001 through 004 rather than only the foundation SQL.

## Crawl identity and state machine

Manual crawl requests persist a `crawl_runs` row before queue enqueue so clients can follow a durable database identity without depending on BullMQ job IDs.

The public lifecycle is:

`QUEUED -> RUNNING -> SUCCEEDED | FAILED`

A queue-enqueue failure becomes a durable failed run with `QUEUE_ENQUEUE_FAILED`.

`crawl_runs.job_key` is unique and cannot be rebound to another crawl identity.

## Idempotency

`price_observations.crawl_run_id` is unique, so multiple workers may attempt the same logical crawl but only one verified observation can exist for it.

`change_events` uses `UNIQUE(observation_id, type)` and `notification_outbox` uses `UNIQUE(change_event_id, channel)` so redelivery cannot duplicate derived effects.

## Concurrency and chronological current state

Observation ingestion locks the target listing row with `SELECT ... FOR UPDATE`. Every accepted observation is retained even if its worker finishes late.

After insertion, only the chronological head by `verified_at` (with ID as deterministic equal-time tie-breaker) may:

- update current price/currency/stock;
- advance `last_successful_crawl_at`;
- derive forward `PRICE_CHANGED` / `STOCK_CHANGED` events;
- create notification-outbox intent.

Thus if a `$90` observation from 10:05 commits before a slow `$100` observation from 10:00, history contains both chronologically while materialized current state remains `$90`; no false `$90 -> $100` reverse event is created.

## Market mismatch transaction boundary

Before a candidate may become a verified observation, its currency must match the listing's `expected_currency`.

This is enforced twice:

1. the worker checks the candidate against the PostgreSQL-loaded listing contract before calling persistence;
2. `persistObservationAndEffects()` repeats the check while holding the listing row lock.

On mismatch, persistence rolls back before the observation insert and the worker records a failed crawl with:

- `failure_code = MARKET_MISMATCH`;
- listing `health = NEEDS_REVIEW`;
- `last_crawl_at` updated as an attempted verification;
- `failure_count` incremented.

A mismatch does **not** create or mutate:

- `price_observations`;
- historical verified facts;
- current price/currency/stock;
- `last_successful_crawl_at`;
- `change_events`;
- `notification_outbox`.

The dedicated PostgreSQL/Redis/BullMQ integration regression proves these semantics while also changing the listing URL after enqueue to prove the worker uses execution-time PostgreSQL configuration.

## Attempt/health monotonicity

`last_crawl_at` represents the newest known attempt time, not DB commit order. A late older failure cannot overwrite health/freshness established by a newer attempt, and a late historical success cannot relabel itself as the newest successful verification.

## Failure honesty

A failed crawl appends no verified observation and cannot advance `last_successful_crawl_at`. The UI may display the last verified value after failure, but health and timestamps make clear that it is historical rather than fresh.

`MARKET_MISMATCH` is one explicit form of this failure-honesty rule: an unexpected currency is review-worthy evidence about the attempted crawl, not a verified price observation.

## Extraction/reliability provenance

Runtime extraction candidates already carry adapter ID/version, source method/path, confidence, price/currency/stock/seller data, and bounded attempt metadata. Production and canary use the same `executeExtractionPipeline()`.

The decision-aware reliability truth model distinguishes:

- expected observations;
- expected variant-ambiguity abstentions;
- unavailable pages;
- blocked states.

Durable long-term storage for substantial evidence artifacts remains intentionally open. Raw HTML/screenshots/headers should not be retained by default until redaction, size, and retention policy are explicit.
