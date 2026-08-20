# Verification Log

## 2026-08-20 — Foundation + security hardening

Local and GitHub verification established:

- foundation suite: **17/17 PASS**;
- SSRF/security suite: **6/6 PASS**;
- deterministic vertical suite: **1/1 PASS**.

Independent-audit defects fixed before the persistence phase:

1. DNS validation was not bound to the actual socket -> approved-IP pinning + peer verification added;
2. missing availability became `in stock` -> tri-state stock model added;
3. CI did not run on `work/**` -> branch trigger added;
4. ambiguous comma-decimal values could be misread -> US-first parser now rejects them.

GitHub commit `a3924885758668b113c60347b07382f62cf3240a` published `priceintel/foundation = success`.

## 2026-08-20 — PostgreSQL + durable worker loop

### Implementation

Added:

- PostgreSQL migration/schema;
- durable crawl-run identity;
- DB-enforced observation/change/outbox idempotency;
- listing-row serialization for change derivation;
- BullMQ queue + worker boundary;
- real Postgres/Redis GitHub Actions services;
- worker-death replay integration test.

### First GitHub run — expected loop failure

Commit: `69b8e31c7cf24b4e35455e7f95a7cc9dc5405c4e`

GitHub Actions run: `32329535448`

Result: **FAIL**.

Evidence before failure:

- foundation 17/17 PASS;
- security 6/6 PASS;
- vertical 1/1 PASS;
- PostgreSQL concurrent-idempotency PASS;
- cross-workspace FK rejection PASS;
- job-key identity-collision rejection PASS.

Failure: BullMQ 6.1.1 refused connection-options mode because its optional `ioredis` client was not installed.

Fix: add exact `ioredis@5.10.1`. No test/assertion was removed or weakened.

### Re-run after fix

Commit: `4b120f6b4696cd5d7801f45d581cca066b8c823d`

GitHub Actions run: `32329656498`

Observable status: `priceintel/persistence-worker = success`.

Results:

- foundation: **17/17 PASS**;
- SSRF/security: **6/6 PASS**;
- deterministic vertical: **1/1 PASS**;
- persistence/worker integration: **4/4 PASS**.

The integration suite proves:

1. concurrent insertion of the same crawl observation yields one inserted row and one idempotent duplicate;
2. database composite foreign keys reject cross-workspace listing/product wiring;
3. a stable job key cannot be rebound to a different crawl identity;
4. a real child worker can die after database COMMIT and before queue acknowledgement, then a replacement worker replays the stalled job without duplicate observation, change event, or notification-outbox intent.

### Remaining verification gaps

- real API/auth tenant-isolation path;
- recurring scheduler behavior;
- Redis unavailable / database unavailable failure injection;
- notification delivery retry/dedupe beyond outbox intent;
- browser-worker crash and SSRF isolation;
- clean-room deployment/bootstrap with the eventual production build toolchain.
