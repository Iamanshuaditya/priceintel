# Status

## Current milestone

**Shopify reliability v1 is accepted and frozen on the measured corpus.**

The accepted claim is deliberately scoped: on the frozen 20-URL / 5-store Shopify corpus with independently reviewed decision truth, `shopify@1.3.0` achieved 100% decision accuracy: 15/15 expected observations correctly priced, 4/4 variant ambiguities correctly abstained, and 1/1 unavailable page correctly classified, with zero false price observations and zero false abstentions.

This is **not** a claim that PriceIntel is 100% accurate on all Shopify stores. It is the accepted baseline for this corpus and adapter version.

The corrected pre-fix replay of Shopify 1.2 scored 95% on the same truth set, with Stag Matches as the sole false abstention. Shopify 1.3's narrow availability-aware variant rule fixed that miss without creating an unsafe observation.

The final Shopify production-safety gate is also complete: competitor listings now carry an explicit market contract and unexpected currencies are rejected before persistence as `MARKET_MISMATCH` / `NEEDS_REVIEW`.

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

The queue now carries only durable crawl identity. The worker reloads product ID, listing URL, and market contract from PostgreSQL at execution time. If extracted currency differs from `expected_currency`, the worker records `MARKET_MISMATCH` with `NEEDS_REVIEW` and creates no observation/change/outbox/current-price mutation.

Hardening run `32419254812` on commit `bcefe669fc712cc563222d8c229705b6c6b28cff` passed the full backend + browser gate including the dedicated market-mismatch integration test.

`market_country` and `locale` represent explicit market intent for future retailer-specific request localization. They do not yet imply that every retailer request is actively localized. The enforced invariant today is that an unexpected currency can never silently become a verified observation.

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

## Reliability lessons preserved

- A challenge detector that scanned raw scripts produced a false 90% blocked rate; visible-state classification fixed the measurement before accepting it.
- OpenGraph alone produced a wrong Fish Knife price; Shopify now refuses that source as standalone product evidence.
- Higher extraction coverage was deliberately reduced when product-level variant ambiguity could not be resolved safely.
- Scindapsus initially had the wrong verifier truth label. A focused visible-control browser recheck and Shopify source metadata proved both CAD 14.95 and CAD 26.95 variants were live, so the oracle was corrected to abstention rather than changing production logic to satisfy bad truth.
- Stag Matches was the genuine Shopify 1.2 false abstention; Shopify 1.3 fixed only that measured error while preserving the four correct abstentions.

## Active next program — Best Buy source reliability

Shopify should not receive additional feature polishing unless a regression or intentional corpus expansion reopens it.

Next work:

1. define an acceptable Best Buy source strategy before implementation;
2. evaluate structured/public product data and any source available under terms suitable for PriceIntel's use;
3. keep the public Best Buy developer API in `MANUAL_REVIEW` unless a written agreement permits the intended third-party price-analysis use;
4. build deterministic source/adapter fixtures only for an acceptable source;
5. create a small controlled Best Buy corpus and measure fetch, extraction, truth correctness, latency/bytes, and failure classes;
6. do not use browser automation to bypass access controls or anti-bot challenges.

After Best Buy: Walmart acceptable-source strategy, then production browser fallback only for genuinely render-dependent, non-blocked retailers.

## Known risks / intentionally open

- The accepted Shopify score covers 20 URLs / 5 stores, not Shopify as a whole; broader statistical confidence requires intentional corpus expansion.
- `market_country` / `locale` are persisted but generic active market selection is not implemented across retailers.
- Production browser fallback remains disabled; browser network interception is defense-in-depth and cannot replace restrictive deployment egress.
- Walmart observed challenge pages remain `BLOCKED` until an acceptable source exists.
- Best Buy's public API terms need a suitable agreement before PriceIntel can rely on it for the intended product use.
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
