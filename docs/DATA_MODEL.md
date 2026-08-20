# Data Model

## Authority and invariants

PostgreSQL is the authority for tenant data, authentication/session state, durable crawl identity, observations, semantic changes, notification intent, migration history, and materialized listing state. Redis/BullMQ schedules and redelivers work but is not trusted to provide exactly-once business effects.

## Core entities

- `workspaces`: tenant root.
- `users`: normalized email + password hash.
- `memberships`: `(user_id, workspace_id)` role assignment with `OWNER | MEMBER`.
- `sessions`: opaque login sessions; only token hashes are persisted, with expiration/revocation by deletion.
- `products`: workspace-scoped internal catalog.
- `competitor_listings`: monitored URLs plus current materialized monitoring state.
- `crawl_runs`: durable identity and status for one logical crawl (`QUEUED | RUNNING | SUCCEEDED | FAILED`).
- `price_observations`: append-oriented verified facts.
- `change_events`: semantic forward changes derived only when a new chronological head is accepted.
- `notification_outbox`: deduplicated external-delivery intent created transactionally with changes.
- `schema_migrations`: immutable applied migration ledger (`version`, `name`, SHA-256 `checksum`, `applied_at`).

## Tenant isolation

Important relationships use `(entity_id, workspace_id)` composite foreign keys. This prevents rows from claiming a product/listing/crawl belonging to another workspace even if application code supplies wrong IDs.

The API also scopes every workspace/entity query through authenticated membership. DB constraints are defense in depth, not a substitute for authZ.

## Migration discipline

Migration files are discovered in ordered version sequence. The runner acquires a PostgreSQL advisory lock, validates every previously applied migration’s name/checksum, applies each pending migration transactionally, and records it in `schema_migrations`.

An applied migration is immutable: editing `001`, `002`, etc. after application produces a checksum mismatch and migration failure rather than silently applying changed historical SQL.

Production deployment should run migrations explicitly before API/worker startup. API/worker auto-migration is opt-in for development.

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

Observation ingestion locks the target listing row with `SELECT ... FOR UPDATE`. Every valid observation is retained even if its worker finishes late.

After insertion, only the chronological head by `verified_at` (with ID as deterministic equal-time tie-breaker) may:

- update current price/currency/stock;
- advance `last_successful_crawl_at`;
- derive forward `PRICE_CHANGED` / `STOCK_CHANGED` events;
- create notification-outbox intent.

Thus if a `$90` observation from 10:05 commits before a slow `$100` observation from 10:00, history contains both chronologically while materialized current state remains `$90`; no false `$90 -> $100` reverse event is created.

## Attempt/health monotonicity

`last_crawl_at` represents the newest known attempt time, not DB commit order. A late older failure cannot overwrite health/freshness established by a newer attempt, and a late historical success cannot relabel itself as the newest successful verification.

## Failure honesty

A failed crawl appends no verified observation and cannot advance `last_successful_crawl_at`. The UI may display the last verified value after failure, but health and timestamps make clear that it is historical rather than fresh.

## Next data-model extension: extraction/evidence provenance

The retailer-reliability program should add durable/portable representation for candidate provenance before large-scale adapter growth. A candidate/evidence record needs enough information to answer:

- which adapter and adapter version produced the candidate;
- extraction method and selector/source;
- confidence/validation disposition;
- final URL and response metadata;
- optional evidence reference/trace.

Raw HTML/screenshots/headers should not be retained by default until redaction, size, and retention policy are explicit.
