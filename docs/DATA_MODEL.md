# Data Model

## Authority and invariants

PostgreSQL is the authority for durable crawl identity, observations, change events, notification intent, and the materialized current state of a competitor listing. Redis/BullMQ schedules and redelivers work but is not trusted to provide exactly-once business effects.

### Core entities

- `workspaces`: tenant root.
- `products`: workspace-scoped internal catalog records.
- `competitor_listings`: monitored URLs tied to a product and workspace, plus current materialized monitoring state.
- `crawl_runs`: durable identity/status for one logical crawl job.
- `price_observations`: append-oriented verified facts.
- `change_events`: semantic forward changes derived when a new chronological head is accepted.
- `notification_outbox`: deduplicated delivery intent created in the same database transaction as a change event.

## Tenant isolation

Important relationships use `(entity_id, workspace_id)` composite foreign keys. This prevents a row from claiming a product/listing/crawl run from another workspace even if application code passes the wrong IDs.

The API layer must still scope every query by workspace and test authorization independently; database constraints are defense in depth, not a replacement for authZ.

## Idempotency

`crawl_runs.job_key` is unique and cannot be rebound to a different crawl identity.

`price_observations.crawl_run_id` is unique. Therefore multiple workers may attempt the same logical crawl, but only one observation can exist for that crawl run.

`change_events` uses `UNIQUE(observation_id, type)` and `notification_outbox` uses `UNIQUE(change_event_id, channel)` so replay cannot create duplicate derived effects.

## Concurrency and chronological current state

Observation ingestion locks the target `competitor_listings` row with `SELECT ... FOR UPDATE`. This serializes state/change derivation per listing while allowing unrelated listings to proceed concurrently.

Every validated observation is retained as historical fact even if its worker finishes late. After insertion, the transaction determines the newest observation by `verified_at` (with observation ID as a deterministic equal-time tie-breaker).

Only the chronological head may:

- update `current_price`, `current_currency`, or `current_stock_status`;
- advance `last_successful_crawl_at`;
- derive forward `PRICE_CHANGED` / `STOCK_CHANGED` events;
- create notification-outbox intent for those changes.

Therefore this completion order is safe:

```text
10:00 crawl observes $100 but is slow
10:05 crawl observes $90 and commits first
10:08 old 10:00 crawl commits
```

The database keeps both observations in chronological history (`$100 -> $90`) while materialized current state remains `$90`. The late `$100` insert does not create a false `$90 -> $100` change.

When a later 10:10 observation arrives, its change predecessor is the chronological 10:05 observation, not whichever row happened to be inserted last.

## Attempt/health monotonicity

`last_crawl_at` represents the newest known crawl attempt, not commit order. It is advanced monotonically.

A failure older than an already-recorded newer attempt cannot replace newer health/failure state. Similarly, a successful historical observation may be retained without resetting health established by a newer attempt.

## Failure honesty

`last_successful_crawl_at` advances only when an observation becomes the newest verified state. A failed crawl creates no successful observation. A late historical success is truthful history, but it is not relabeled as the latest verification and cannot make the UI move backward.
