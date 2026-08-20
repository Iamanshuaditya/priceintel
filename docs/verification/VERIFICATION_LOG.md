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
- PostgreSQL/Redis/BullMQ integration suite;
- emitted build + compiled migration execution;
- Chromium installation;
- Playwright operator E2E;
- browser evidence artifact upload.

Evidence artifact:

- ID: `9394100566`;
- SHA-256: `f60680cc5f84209092a58ea4a215e2b92f7ea8b8c14d7342615c2c95861bad78`;
- screenshots: `01-healthy-100.png`, `02-price-change-90.png`, `03-parse-failed-preserves-90.png`.

The screenshots were independently visually inspected after CI. They clearly show the healthy `$100` state, the `$90` price-change/history state, and the `PARSE_FAILED` state with `$90` retained as the last verified value plus the explicit warning that it is not being treated as fresh.

## 2026-08-20 — Retailer Reliability measurement architecture

The reliability program moved production extraction behind a retailer adapter registry and a shared `executeExtractionPipeline()` used by production and the live canary. Candidate provenance includes adapter/version/source information and supplementary artifacts are fetched only through the hardened HTTP boundary with explicit request/byte/time budgets.

Decision truth now distinguishes:

- `OBSERVATION`;
- `ABSTAIN_VARIANT_AMBIGUITY`;
- `UNAVAILABLE`;
- `BLOCKED`.

Metrics separately report observation truth coverage, price correctness, abstention accuracy, unavailable/blocked correctness, wrong expected-observation prices, unsafe unexpected observations, false abstentions, and overall decision accuracy.

The browser truth audit is an independent test oracle. Screenshots/visible page state and verifier review establish truth; automatically extracted snippets/control metadata are supporting evidence only and never become production observations.

Measurement failures preserved during the program include:

- first live canary exposed Node's custom DNS lookup `{all:true}` callback-shape incompatibility; transport was fixed and regression-tested rather than blaming retailers;
- raw-script anti-bot words caused a false 90% challenge rate; challenge detection was restricted to explicit status/final URL/visible page state before trusting corpus metrics;
- Shopify OpenGraph metadata produced an unsafe Fish Knife product-level price; OpenGraph was removed as standalone price evidence;
- an over-broad variant browser audit exhausted its 25-minute workflow budget; the verifier was changed to opt-in targeted probes with per-entry/global/per-probe/whole-audit budgets rather than increasing CI timeout.

## 2026-08-20 — Shopify truth/oracle correction

The 20-URL / 5-store Shopify corpus was independently reviewed with browser evidence and decision-aware truth.

A critical verifier correction is preserved:

- Source diagnostic run `32394981279`, artifact `9416281097`, SHA-256 `cd27d02fe5b692fbe4223be963c7613d1cb325a45bf38edbba71a022bb8495cf` showed Miss Boon Scindapsus variants CAD `14.95` and `26.95` both reported available by Shopify product data.
- Focused visible-control browser recheck run `32395208368`, artifact `9416381316`, SHA-256 `29b2c20c50df56f9484d3981720f4a62825a3bb8a89b6a61b0ca68c84d2a274d` successfully selected the visible 6-inch control and changed the rendered price from CAD `14.95` to CAD `26.95`.
- The truth row was therefore corrected from expected observation to `ABSTAIN_VARIANT_AMBIGUITY`.

Production extraction was **not** changed to satisfy the earlier incorrect oracle.

## 2026-08-20 — Corrected Shopify 1.2 baseline replay

The replay workflow preserved the amended truth, checked out the pre-fix code at `a050bcf1d3f1140016046fb404bc1deae9132f02`, then scored that implementation against the corrected truth.

Run `32395534870`: **PASS**.

Artifact:

- ID: `9416480111`;
- SHA-256: `bdcb3030b4b77407d6f1a866afc690f0c0ab7d90a0de08c3d1903ad2a0a44ec3`.

Decision score:

- expected observations: 15;
- produced observations: 14/15 (93.3%);
- correct produced prices: 14/14 (100%);
- expected abstentions: 4; correct: 4/4;
- unavailable: 1/1;
- wrong prices: 0;
- unsafe unexpected observations: 0;
- false price observations: 0;
- false abstentions: 1;
- overall decision accuracy: **95%**.

The sole miss was Mollyjogger Stag Matches: the crawler abstained even though the differing-price alternate variant was sold out and the live/default variant was a valid `$10` observation.

## 2026-08-20 — Shopify 1.3 accepted baseline

`shopify@1.3.0` introduced one narrow rule: unavailable variants may be excluded from product-level price ambiguity only when availability evidence is complete. Multiple differently priced currently relevant/available variants still produce no product-level observation. Missing/incomplete availability remains conservative, and explicit `?variant=` URLs retain variant-specific behavior.

Run `32395507110`: **PASS**.

Artifact:

- ID: `9416476817`;
- SHA-256: `cf9dbc2a88f200ea1ecc04a5be6f85f380022bb7e7f214c2f097bac25573291d`.

Decision score against the exact same corrected truth:

- expected observations: 15;
- produced observations: 15/15;
- correct prices: 15/15 (100%);
- expected abstentions: 4; correct: 4/4;
- unavailable: 1/1;
- wrong prices: 0;
- unsafe unexpected observations: 0;
- false price observations: 0;
- false abstentions: 0;
- overall decision accuracy: **100%**.

Accepted scope statement:

> On the frozen 20-URL / 5-store Shopify corpus with independently reviewed decision truth, `shopify@1.3.0` achieved 100% decision accuracy: 15/15 expected observations correctly priced, 4/4 variant ambiguities correctly abstained, and 1/1 unavailable page correctly classified, with zero false price observations and zero false abstentions.

This evidence does **not** support the broader statement “PriceIntel is 100% accurate on Shopify.”

## 2026-08-20 — Listing market-context safety gate

Migration `004_listing_market_context.sql` adds `expected_currency`, `market_country`, and `locale` to monitored listings. Existing expected currency is backfilled from the parent product before becoming non-null.

BullMQ crawl messages are now identity-only. The worker reloads authoritative product ID, URL, and market contract from PostgreSQL after claiming the run.

A currency mismatch is rejected before observation persistence as `MARKET_MISMATCH`; persistence repeats the guard under the listing row lock. It becomes listing health `NEEDS_REVIEW`.

Dedicated integration test `tests/integration/market-context.test.ts` proves:

1. baseline `$100 USD` verified history exists;
2. crawl is enqueued with identity only;
3. listing URL is changed in PostgreSQL after enqueue;
4. worker fetches the changed PostgreSQL URL, proving queue data is not authoritative;
5. fixture returns `$90 CAD` for an `expected_currency = USD` listing;
6. crawl fails `MARKET_MISMATCH`;
7. observation count remains exactly 1;
8. changes and outbox remain 0;
9. current `$100 USD` / stock / prior successful timestamp are preserved;
10. `last_crawl_at`, failure count/code, and `NEEDS_REVIEW` advance as failure metadata only.

Commit `bcefe669fc712cc563222d8c229705b6c6b28cff` passed the complete hardening gate in run `32419254812`, including strict TypeScript, deterministic/security suites, PostgreSQL/Redis integration, build/migration execution, and operator Chromium E2E.

## 2026-08-20 — Shopify v1 closure cleanup

After the corrected before/after baseline and market-context gate were accepted, the temporary Shopify one-shot workflows were removed:

- `shopify-baseline-replay-once.yml`;
- `shopify-corpus-once.yml`;
- `shopify-source-diagnostic-once.yml`;
- `shopify-truth-audit-once.yml`.

Single-retailer diagnostic scripts for the Scindapsus recheck, Shopify variant source diagnostic, and earlier Gymshark diagnosis were also removed. The reusable bounded `browser-truth-audit.ts`, permanent scheduled/manual live canary, shared reliability canary, corpus/truth data, and deterministic adapter tests remain.

## Next verification program — Best Buy source reliability

Shopify v1 is frozen unless an intentional regression/corpus-expansion program reopens it.

Next verification work must first establish an acceptable Best Buy source strategy. The currently known public developer API should remain `MANUAL_REVIEW` for PriceIntel's intended third-party price-analysis use unless a suitable written agreement permits it.

An acceptable Best Buy source should then be evaluated through deterministic source contracts plus a bounded real corpus measuring source access, extraction, decision truth, latency/bytes, and failure classification. Browser automation must not be used to bypass access controls or anti-bot challenges.
