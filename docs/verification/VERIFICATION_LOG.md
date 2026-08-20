# Verification Log

## 2026-08-20 — Foundation + security hardening

- Foundation suite: **17/17 PASS**.
- SSRF/security suite: **6/6 PASS**.
- Deterministic vertical suite: **1/1 PASS**.
- DNS validation was bound to socket connection through approved-IP pinning + peer verification.
- Missing availability became tri-state stock rather than inferred in-stock.
- Ambiguous comma-decimal formats are rejected by the US-first parser.
- Work-branch CI trigger added.

Commit `a3924885758668b113c60347b07382f62cf3240a` published `priceintel/foundation = success`.

## 2026-08-20 — PostgreSQL + durable worker

Initial persistence run `32329535448` failed because BullMQ 6.1.1 required its Redis client dependency. Exact `ioredis@5.10.1` was added; no assertion was weakened.

Run `32329656498` on commit `4b120f6b4696cd5d7801f45d581cca066b8c823d` passed real PostgreSQL + Redis integration, including child-process death after DB COMMIT and before BullMQ ACK with no duplicate observation/change/outbox on stalled replay.

## 2026-08-20 — Ordering + reproducible build

Audit findings addressed:

- out-of-order crawl completion could roll current state backward;
- no committed npm lockfile;
- runtime tests did not prove strict TypeScript/build health.

The persistence layer was changed so only the chronological verified head may advance current state or derive forward changes. Late old failures likewise cannot overwrite newer attempt health.

Run `32330894297` initially failed strict typecheck because an existing test fixture widened `stockStatus` to `string`. The fixture was typed rather than reducing compiler strictness.

Run `32331047267` on `bf5da5ced8672e71561a80d0aa857fd07137aafa` passed strict typecheck, deterministic/security suites, six integration cases, and emitted build under `npm ci`.

## 2026-08-20 — AuthZ + API-backed product vertical

Implemented persisted users/memberships (`OWNER | MEMBER`), salted scrypt passwords, opaque sessions whose raw tokens are never stored, workspace authorization, product/listing CRUD, crawl enqueue, listing/current/history queries, and production worker startup through the hardened HTTP transport.

The API integration path exercises:

`register/login -> workspace -> product -> listing -> BullMQ -> worker -> $100 -> $90 -> PRICE_CHANGED -> malformed crawl -> PARSE_FAILED -> last verified $90 preserved`.

Two failures were preserved rather than hidden:

1. Node strip-only runtime rejected TypeScript parameter-property syntax in `HttpError`; source was rewritten without weakening tests.
2. BullMQ `failedReason` preserved the Error message but not arbitrary `.code`; the worker boundary now serializes stable failure code into the queue-visible message while Postgres separately records `failure_code`.

The resulting `b9d155981467d97fc7586f4ec91ab56f5fa50db7` hardening run was green.

## 2026-08-20 — Migration ledger + browser session boundary

### Migration discipline

Commit `025f2c822a07db51f5891c6bdb3fd322c8ecbcac` added:

- `schema_migrations` ledger;
- ordered migration discovery;
- SHA-256 checksum verification;
- PostgreSQL advisory locking;
- transactional pending migration application;
- regression proving concurrent runner idempotency and checksum-mismatch refusal;
- opt-in API/worker auto-migration instead of unconditional production startup mutation.

Its hardening gate passed against PostgreSQL 17.

### Browser auth/API boundary

Added:

- HttpOnly `priceintel_session` cookie transport for browsers;
- `SameSite=Lax` and production `Secure` behavior;
- no raw token in browser auth JSON;
- Bearer compatibility for API/CLI;
- same-origin CSRF check for cookie-authenticated unsafe requests;
- persisted logout revocation;
- login/register rate limiting before unbounded scrypt work;
- listing collection/filter route;
- DB-backed crawl status route and durable `QUEUED` crawl creation before BullMQ enqueue;
- minimal operator console.

First run `32333430612` failed strict TypeScript inference for the optional `Retry-After` response header. The source typing was fixed; behavioral assertions were unchanged.

Run `32333615080` on `898a38e8b182b5b87846b215d025e86faa672653` passed the full backend hardening gate including the new cookie/CSRF/rate-limit integration test.

## 2026-08-20 — Real Chromium operator E2E

Pinned/locked `@playwright/test` and added a real browser acceptance path plus CI screenshot artifacts.

The test drives Chromium through:

1. create account through cookie session;
2. create workspace;
3. create product;
4. add deterministic fixture listing;
5. Check Now -> `$100`, `IN_STOCK`, `HEALTHY`;
6. fixture `$100 -> $90` -> Check Now -> `$90`, two observations, one `PRICE_CHANGED` event `$100 -> $90`;
7. malformed fixture -> Check Now -> `PARSE_FAILED`, last verified `$90` and prior successful timestamp preserved;
8. DB assertion remains exactly two observations and one price change;
9. browser assertion confirms the session cookie is not readable through `document.cookie` and no token exists in `localStorage`.

### First Playwright run — intentional failure retained

Commit `07c96fdb61ec0b14489b8e8bd430fd083b8f3cfb`.

Run `32334014925`: **FAIL**.

The browser exposed a real UI race/visibility bug. Elements carrying `hidden` also had layout CSS (`display:grid`), so the product form was interactive before workspace initialization finished. Chromium submitted to:

`POST /v1/workspaces/null/products -> 403`

The Playwright assertion was not relaxed. UI CSS was fixed with an explicit `[hidden]{display:none!important}` rule.

### Final browser acceptance

Commit `c8fda2a1fa78da552169848c9bde3a88c7d2f3e3`.

GitHub Actions run `32334339220`: **PASS**.

Observable status: `priceintel/hardening = success`.

The job independently passed:

- locked `npm ci` install;
- strict TypeScript typecheck;
- foundation/security/vertical tests;
- PostgreSQL/Redis/BullMQ integration suite (**10/10**);
- emitted build + compiled migration execution;
- Chromium installation;
- Playwright operator E2E;
- browser evidence artifact upload.

Evidence artifact:

- ID: `9394100566`;
- SHA-256: `f60680cc5f84209092a58ea4a215e2b92f7ea8b8c14d7342615c2c95861bad78`;
- screenshots: `01-healthy-100.png`, `02-price-change-90.png`, `03-parse-failed-preserves-90.png`.

The screenshots were independently visually inspected after CI. They clearly show the healthy `$100` state, the `$90` price-change/history state, and the `PARSE_FAILED` state with `$90` retained as the last verified value plus the explicit warning that it is not being treated as fresh.

## Next verification program — Retailer Reliability

The next acceptance gate is not “more CRUD.” It must measure real extraction reliability.

Required gates:

- adapter interface + adapter/version provenance;
- generic structured extractor behind the interface;
- deterministic adapter contracts;
- Shopify plus at least two major US retailer adapters;
- evidence/extraction trace model;
- controlled live URL corpus;
- live-canary command and automatically generated retailer health report;
- explicit distinction between transport success, extraction success, and manually sampled correctness;
- browser fallback architecture;
- browser-specific private/local network blocking before production browser navigation;
- deterministic CI remains blocking; live Internet canaries run manually/scheduled and do not make ordinary PR CI nondeterministic.
