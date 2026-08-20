# Status

## Current milestone

**Shopify reliability v1 is accepted and frozen on the measured corpus. Best Buy automated source access is also accepted as failed-closed and frozen pending an approved source.**

The accepted Shopify claim is deliberately scoped: on the frozen 20-URL / 5-store Shopify corpus with independently reviewed decision truth, `shopify@1.3.0` achieved 100% decision accuracy: 15/15 expected observations correctly priced, 4/4 variant ambiguities correctly abstained, and 1/1 unavailable page correctly classified, with zero false price observations and zero false abstentions.

This is **not** a claim that PriceIntel is 100% accurate on all Shopify stores. It is the accepted baseline for this corpus and adapter version.

The corrected pre-fix replay of Shopify 1.2 scored 95% on the same truth set, with Stag Matches as the sole false abstention. Shopify 1.3's narrow availability-aware variant rule fixed that miss without creating an unsafe observation.

The final Shopify production-safety gate is also complete: competitor listings carry an explicit market contract and unexpected currencies are rejected before persistence as `MARKET_MISMATCH` / `NEEDS_REVIEW`.

Best Buy now has a different accepted result: parser capability exists, but the currently reviewed public sources are not operationally approved for PriceIntel's intended use. Production and live-canary access fail closed as `SOURCE_NOT_APPROVED`, including redirect and supplementary-fetch destinations.

## Accepted evidence

### Shopify 1.2 corrected replay

- Run: `32395534870`
- Artifact: `9416480111`
- Artifact SHA-256: `bdcb3030b4b77407d6f1a866afc690f0c0ab7d90a0de08c3d1903ad2a0a44ec3`
- Expected observations: 15; produced: 14/15; correct produced prices: 14/14.
- Expected abstentions: 4; correct: 4/4.
- Unavailable: 1/1.
- Wrong prices: 0; unsafe unexpected observations: 0; false price observations: 0.
- False abstentions: 1.
- Overall decision accuracy: **95%**.

### Shopify 1.3 final accepted score

- Run: `32395507110`
- Artifact: `9416476817`
- Artifact SHA-256: `cf9dbc2a88f200ea1ecc04a5be6f85f380022bb7e7f214c2f097bac25573291d`
- Expected observations: 15; produced: 15/15; correct prices: 15/15.
- Expected abstentions: 4; correct: 4/4.
- Unavailable: 1/1.
- Wrong prices: 0; unsafe unexpected observations: 0; false price observations: 0; false abstentions: 0.
- Overall decision accuracy: **100%**.

### Market-context hardening

Migration `004_listing_market_context.sql` adds listing-level `expected_currency`, optional `market_country`, and optional `locale`.

The queue carries only durable crawl identity. The worker reloads product ID, listing URL, and market contract from PostgreSQL at execution time. If extracted currency differs from `expected_currency`, the worker records `MARKET_MISMATCH` with `NEEDS_REVIEW` and creates no observation/change/outbox/current-price mutation.

Hardening run `32419254812` on commit `bcefe669fc712cc563222d8c229705b6c6b28cff` passed the full backend + browser gate including the dedicated market-mismatch integration test.

`market_country` and `locale` represent explicit market intent for future retailer-specific request localization. They do not imply that every retailer request is actively localized. The enforced invariant today is that an unexpected currency can never silently become a verified observation.

### Best Buy direct source gate

Commit `30b4eae2021f320cf54056bb9c544d03bcff6f9d` passed hardening run `32420516534`.

The real Postgres/Redis/BullMQ regression proves a BestBuy.com listing is reloaded from PostgreSQL, rejected as `SOURCE_NOT_APPROVED`, invokes the fetcher zero times, preserves exactly one historical `$199.99 USD` observation/current state, creates no change/outbox, and records only failure metadata with `NEEDS_REVIEW`.

### Per-hop source authorization

Commit `945e0b15e5787973cf983fba64487fd074f571d7` passed hardening run `32421412905`.

`secureFetch()` now accepts a generic target-authorizer callback and invokes it before DNS and transport on every concrete hop. Production worker fetches and the live canary pass `assertAutomatedSourceAccess` into this boundary.

Regression coverage proves:

1. direct Best Buy is blocked before DNS/transport;
2. approved origin -> Best Buy redirect never contacts the Best Buy destination;
3. supplementary Shopify request -> Best Buy redirect is blocked and surfaced as `SOURCE_NOT_APPROVED`;
4. approved -> approved redirect remains functional.

An intermediate run `32421300251` failed strict TypeScript only because the authorizer callback was typed as `void` while the source-policy function returns its successful decision object. The callback type was corrected; no behavioral assertion changed.

## Historical operator milestone

The browser-backed operator vertical remains accepted. GitHub Actions run `32334339220` on commit `c8fda2a1fa78da552169848c9bde3a88c7d2f3e3` published `priceintel/hardening = success` and uploaded browser evidence artifact `9394100566` (`sha256:f60680cc5f84209092a58ea4a215e2b92f7ea8b8c14d7342615c2c95861bad78`).

The accepted browser path proves `$100 HEALTHY -> $90 PRICE_CHANGED -> malformed PARSE_FAILED`, with the last verified `$90` preserved and explicitly not represented as fresh.

## Completed

- Durable PostgreSQL/BullMQ crawl processing and replay/idempotency guarantees.
- Checksum-locked ordered migration ledger with PostgreSQL advisory lock.
- Authenticated tenant-scoped API and HttpOnly browser cookie boundary.
- Same-origin CSRF enforcement, logout revocation, and pre-scrypt auth rate limiting.
- Minimal operator UI and real Chromium Playwright E2E.
- Failure-honest current/history behavior.
- DNS-pinned HTTP(S) transport with redirect revalidation and peer-address verification.
- Provenance-rich retailer adapter registry and shared `executeExtractionPipeline()` used by production and reliability measurement.
- Decision-aware truth model distinguishing observations, variant abstentions, unavailable pages, and blocked states.
- Corrected unsafe-observation metrics: wrong expected prices and unexpected observations are separately visible and combined into the false-price safety count.
- Bounded supplementary Shopify HTTP extraction through the hardened transport.
- Shopify `1.3.0` availability-aware variant semantics.
- Frozen 20-URL / 5-store Shopify truth corpus and accepted 95% -> 100% before/after evidence.
- Reusable bounded Chromium truth-audit tooling; browser evidence remains a verifier input, never production observation data.
- Listing market contract (`expected_currency`, `market_country`, `locale`).
- Identity-only BullMQ crawl messages; worker reloads authoritative crawl configuration from PostgreSQL.
- Pre-persistence and row-lock-protected `MARKET_MISMATCH` guard.
- One-shot Shopify corpus/replay/truth/diagnostic workflows removed after baseline acceptance.
- Best Buy public source review recorded as an operational `SOURCE_NOT_APPROVED / MANUAL_REVIEW` decision, not a broad legal conclusion.
- Direct Best Buy zero-network production gate accepted.
- Per-hop HTTP source authorization accepted for initial, redirect, and supplementary requests.
- Best Buy parser retained as dormant deterministic capability without permission to access the live source.

## Reliability lessons preserved

- A challenge detector that scanned raw scripts produced a false 90% blocked rate; visible-state classification fixed the measurement before accepting it.
- OpenGraph alone produced a wrong Fish Knife price; Shopify now refuses that source as standalone product evidence.
- Higher extraction coverage was deliberately reduced when product-level variant ambiguity could not be resolved safely.
- Scindapsus initially had the wrong verifier truth label. A focused visible-control browser recheck and Shopify source metadata proved both CAD 14.95 and CAD 26.95 variants were live, so the oracle was corrected to abstention rather than changing production logic to satisfy bad truth.
- Stag Matches was the genuine Shopify 1.2 false abstention; Shopify 1.3 fixed only that measured error while preserving the four correct abstentions.
- A technically useful retailer API or parser is not automatically an acceptable production source.
- Source permission must be enforced per network hop, not only on the original listing URL.

## Active next program — source governance and acceptable-source research

Shopify and Best Buy crawler engineering are frozen unless a regression, intentional corpus expansion, or newly approved source reopens them.

Next work should focus on source governance and the next retailer source decision:

1. investigate Best Buy written permission, a separate signed agreement, or a licensed provider whose rights explicitly cover competitor-price intelligence; do not write more Best Buy crawler code meanwhile;
2. generalize source-registry governance metadata (`APPROVED | NOT_APPROVED | REVIEW_REQUIRED`, basis, reviewedAt, evidence reference, review/expiry date) when doing so benefits multiple retailers;
3. apply the source-acceptability-first process to Walmart before attempting new crawling techniques;
4. only after an acceptable source exists, build its source adapter, bounded corpus, decision truth, and reliability score;
5. keep browser automation out of any attempt to bypass access controls or source restrictions.

## Known risks / intentionally open

- The accepted Shopify score covers 20 URLs / 5 stores, not Shopify as a whole; broader statistical confidence requires intentional corpus expansion.
- `market_country` / `locale` are persisted but generic active market selection is not implemented across retailers.
- Production browser fallback remains disabled; browser network interception is defense-in-depth and cannot replace restrictive deployment egress.
- Walmart observed challenge pages remain `BLOCKED` until an acceptable source exists.
- Best Buy has no currently approved automated data source for PriceIntel; progress depends on permission/agreement/licensed-source work rather than crawler engineering.
- Source-policy registry evidence metadata is currently code/docs-based rather than a durable normalized data model.
- Evidence retention/redaction policy for large raw artifacts remains open.
- Notification delivery beyond transactional outbox intent remains open.
- International parsing beyond explicit retailer adapters remains intentionally deferred.

## Deferred intentionally

- MAP enforcement.
- Billing.
- Automated repricing writes.
- Automatic product matching.
- Consumer browser extension.
- Broad analytics/dashboard polish.
- AI extraction as a substitute for measured deterministic reliability.
