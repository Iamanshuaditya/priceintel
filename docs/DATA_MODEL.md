# Data Model

## Authority and invariants

PostgreSQL is the authority for durable crawl identity, observations, change events, and notification intent. Redis/BullMQ schedules and redelivers work but is not trusted to provide exactly-once business effects.

### Core entities

- `workspaces`: tenant root.
- `products`: workspace-scoped internal catalog records.
- `competitor_listings`: monitored URLs tied to a product and workspace, plus current materialized monitoring state.
- `crawl_runs`: durable identity/status for one logical crawl job.
- `price_observations`: append-oriented verified facts.
- `change_events`: semantic differences derived from consecutive verified observations.
- `notification_outbox`: deduplicated delivery intent created in the same database transaction as a change event.

## Tenant isolation

Important relationships use `(entity_id, workspace_id)` composite foreign keys. This prevents a row from claiming a product/listing/crawl run from another workspace even if application code passes the wrong IDs.

The API layer must still scope every query by workspace and test authorization independently; database constraints are defense in depth, not a replacement for authZ.

## Idempotency

`crawl_runs.job_key` is unique and cannot be rebound to a different crawl identity.

`price_observations.crawl_run_id` is unique. Therefore multiple workers may attempt the same logical crawl, but only one observation can exist for that crawl run.

`change_events` uses `UNIQUE(observation_id, type)` and `notification_outbox` uses `UNIQUE(change_event_id, channel)` so replay cannot create duplicate derived effects.

## Concurrency

Observation ingestion locks the target `competitor_listings` row with `SELECT ... FOR UPDATE` before inserting and comparing history. This serializes change derivation per listing while allowing unrelated listings to proceed concurrently.

## Failure honesty

`last_crawl_at` represents an attempt. `last_successful_crawl_at` advances only after a validated observation is durably persisted. A failed crawl may update health/failure fields, but it does not create a successful observation or relabel a prior value as fresh.
