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

### First GitHub run

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

The integration suite proved concurrent replay idempotency, tenant FK isolation, crawl job identity immutability, and worker-death replay without duplicate observation/change/outbox effects.

## 2026-08-20 — Persistence ordering + reproducible build hardening

### Audit findings addressed

1. Out-of-order crawl completion could previously make materialized current state move backward and create a misleading reverse change.
2. Dependency resolution was not frozen because `package-lock.json` was absent.
3. Runtime tests did not independently prove the whole TypeScript project typechecked or emitted successfully.

### Implementation

- observation history remains append-oriented;
- listing ingestion still serializes through a row lock;
- after insertion, only the chronological newest verified observation may advance current price/stock/last-successful state;
- late historical observations create no reverse change/outbox events;
- later observations derive changes from their chronological predecessor;
- older crawl failures cannot overwrite health/freshness from a newer attempt;
- added `tsconfig.json` with strict typechecking;
- added `tsconfig.build.json` and emitted-build gate;
- added pinned TypeScript/Node/Postgres type dependencies;
- generated and committed `package-lock.json` (`lockfileVersion: 3`);
- CI switched permanently to read-only repository contents + `npm ci` + npm cache.

### First hardening run

Commit: `a76331d148dcd07086be5e61f6d1c6a12d0bcca7`

GitHub Actions run: `32330894297`

Result: **FAIL**.

The run successfully installed dependencies and generated the lockfile, which was committed by GitHub Actions as:

`fdf43850c50a79380cea3452069fd5a8d6574d9a` — `chore: lock dependency graph`.

The new strict compiler gate then found an existing test fixture whose `stockStatus` literal had widened to plain `string`. Runtime tests had not exposed this.

Fix: explicitly type the fixture as `PriceObservation`. Compiler strictness was not reduced and no test was weakened.

### Final hardening run

Commit: `bf5da5ced8672e71561a80d0aa857fd07137aafa`

GitHub Actions run: `32331047267`

Observable status: `priceintel/hardening = success`.

The job used real PostgreSQL 17 and Redis 7 service containers and installed the committed graph with:

```bash
npm ci --no-audit --no-fund
```

Results, in executed order:

- `npm run typecheck` -> **PASS**;
- foundation suite -> **17/17 PASS**;
- SSRF/security suite -> **6/6 PASS**;
- deterministic vertical suite -> **1/1 PASS**;
- PostgreSQL/BullMQ integration suite -> **6/6 PASS**;
- `npm run build` -> **PASS**.

The six integration cases now prove:

1. PostgreSQL remains the authority under concurrent replay of the same crawl observation;
2. a newer `$90` observation committed before a slow older `$100` observation remains the materialized current state while both are retained chronologically;
3. a late older failure cannot overwrite a newer successful listing health/freshness state;
4. composite workspace foreign keys reject cross-tenant listing/product wiring;
5. a stable job key cannot be rebound to another crawl identity;
6. a child worker can die after DB COMMIT and before BullMQ ACK, then a replacement worker can replay without duplicate observation/change/outbox effects.

The out-of-order test additionally inserts a later `$80` observation and verifies its `PRICE_CHANGED` predecessor is the chronological `$90` observation, not the late-inserted older `$100` row.

### Remaining verification gaps

- real user/membership/API authorization and tenant-isolation path;
- full API-backed fixture -> queue -> worker -> query vertical;
- recurring scheduler behavior;
- Redis unavailable / database unavailable failure injection;
- notification delivery retry/dedupe beyond outbox intent;
- browser-worker crash and SSRF isolation;
- production deployment/bootstrap beyond the current compiler/CI build gate.
