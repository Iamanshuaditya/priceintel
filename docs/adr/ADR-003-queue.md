# ADR-003 — Durable Queue and Idempotency

## Status

Accepted and integration-verified for the current slice.

## Decision

Use Redis + BullMQ for durable crawl delivery and PostgreSQL for business-effect idempotency.

A stable application `jobKey` is hashed into BullMQ's custom job ID to reduce duplicate queue entries. That is an optimization, not the correctness boundary.

Every worker execution claims the logical crawl in PostgreSQL. `crawl_runs.job_key` is unique and may not be rebound to another crawl identity. A successful observation is protected by `UNIQUE(crawl_run_id)`.

Observation persistence, semantic change creation, listing current-state update, crawl-run success, and notification-outbox creation are transactionally coordinated. Listing-row locking serializes concurrent change derivation for the same listing.

## Why

Worker execution is at-least-once. A process can die after committing its database transaction but before acknowledging the queue job. Correctness therefore must survive replay.

## Verification evidence

GitHub Actions run `32329656498` used real PostgreSQL and Redis service containers. The integration test intentionally killed a child worker after DB commit and before BullMQ acknowledgement. A replacement worker processed the stalled job and the final database contained exactly:

- two observations total: baseline + changed observation;
- one `PRICE_CHANGED` event;
- one notification-outbox row;
- two succeeded logical crawl runs;
- replay attempt count >= 2 for the changed crawl.

The suite passed 4/4 integration tests.

## Not yet covered

- scheduler persistence and recurring crawl generation;
- per-domain concurrency/throttling;
- dead-letter/operator replay UX;
- external notification delivery retries;
- Redis outage injection;
- DB outage injection;
- graceful shutdown under active browser crawls.
