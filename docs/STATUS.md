# Status

## Current milestone

**Shopify reliability v1 is accepted/frozen. Best Buy crawler engineering is frozen behind source approval. Source governance is now a version-controlled platform capability, and Walmart has completed its first source-acceptability decision without a new crawler experiment.**

The accepted Shopify claim remains deliberately scoped: on the frozen 20-URL / 5-store Shopify corpus with independently reviewed decision truth, `shopify@1.3.0` achieved 100% decision accuracy: 15/15 expected observations correctly priced, 4/4 variant ambiguities correctly abstained, and 1/1 unavailable page correctly classified, with zero false price observations and zero false abstentions.

This is **not** a claim that PriceIntel is 100% accurate on all Shopify stores. It is the accepted baseline for this corpus and adapter version.

The corrected pre-fix replay of Shopify 1.2 scored 95% on the same truth set, with Stag Matches as the sole false abstention. Shopify 1.3's narrow availability-aware variant rule fixed that miss without creating an unsafe observation.

The Shopify market-safety gate is complete: competitor listings carry an explicit market contract and unexpected currencies are rejected before persistence as `MARKET_MISMATCH / NEEDS_REVIEW`.

Best Buy has a different accepted result: parser capability exists, but the currently reviewed public sources are not operationally approved for PriceIntel's intended use. Production and live-canary access fail closed as `SOURCE_NOT_APPROVED`, including redirect and supplementary-fetch destinations.

Walmart is now source-reviewed before any new technical experiment:

- `WALMART_PUBLIC_WEB` -> `NOT_APPROVED` for PriceIntel automated collection under the reviewed public terms;
- `WALMART_MARKETPLACE_API` -> `REVIEW_REQUIRED`, because the API is seller/solution-provider scoped and its use for PriceIntel must be validated through the actual onboarding/authorization/use case before it can become an approved source.

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

### Best Buy direct source gate

Commit `30b4eae2021f320cf54056bb9c544d03bcff6f9d` passed hardening run `32420516534`.

The real Postgres/Redis/BullMQ regression proves a BestBuy.com listing is reloaded from PostgreSQL, rejected as `SOURCE_NOT_APPROVED`, invokes the fetcher zero times, preserves exactly one historical `$199.99 USD` observation/current state, creates no change/outbox, and records only failure metadata with `NEEDS_REVIEW`.

### Per-hop source authorization

Commit `945e0b15e5787973cf983fba64487fd074f571d7` passed hardening run `32421412905`.

`secureFetch()` invokes the source authorizer before DNS and transport on every concrete HTTP hop. Regression coverage proves direct denial, approved-origin -> unapproved-destination redirect denial, supplementary redirect denial, and normal approved redirects.

### Source-governance registry + Walmart policy

Commit `02cd370c8869216ee2d814ea40bb73a167abeb88` passed hardening run `32422743147`.

The version-controlled registry in `packages/crawler-core/src/source-governance.ts` carries:

- source ID;
- hostname patterns;
- status (`APPROVED | NOT_APPROVED | REVIEW_REQUIRED`);
- permitted access methods (`PUBLIC_HTTP | RETAILER_API | LICENSED_PROVIDER | BROWSER`);
- review basis;
- `reviewedAt` / optional `reviewAfter`;
- evidence reference;
- operational reason.

Deterministic tests prove registry uniqueness/evidence metadata, preserve the accepted Best Buy redirect gates, and prove Walmart public-web access is denied before DNS/transport. Marketplace API evaluation is separately classified `SOURCE_REVIEW_REQUIRED` when evaluated as `RETAILER_API`.

The Walmart source rationale is recorded in `docs/research/WALMART_SOURCE_DECISION.md`. No Walmart live fetch/browser/API experiment was added as part of this decision.

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
- Corrected unsafe-observation metrics.
- Bounded supplementary Shopify HTTP extraction through the hardened transport.
- Shopify `1.3.0` availability-aware variant semantics.
- Frozen 20-URL / 5-store Shopify truth corpus and accepted 95% -> 100% before/after evidence.
- Reusable bounded Chromium truth-audit tooling; browser evidence remains a verifier input, never production observation data.
- Listing market contract (`expected_currency`, `market_country`, `locale`).
- Identity-only BullMQ crawl messages; worker reloads authoritative crawl configuration from PostgreSQL.
- Pre-persistence and row-lock-protected `MARKET_MISMATCH` guard.
- One-shot Shopify corpus/replay/truth/diagnostic workflows removed after baseline acceptance.
- Best Buy direct and per-hop source-denial gates accepted; parser remains dormant.
- Version-controlled source-governance registry implemented and tested.
- Walmart public-web source classified `NOT_APPROVED` without another crawler experiment.
- Walmart Marketplace API kept separate as `REVIEW_REQUIRED` rather than incorrectly treating seller-scoped API capability as blanket approval.

## Reliability / governance lessons preserved

- A challenge detector that scanned raw scripts produced a false 90% blocked rate; visible-state classification fixed the measurement before accepting it.
- OpenGraph alone produced a wrong Fish Knife price; Shopify now refuses that source as standalone product evidence.
- Higher extraction coverage was deliberately reduced when product-level variant ambiguity could not be resolved safely.
- Scindapsus initially had the wrong verifier truth label; the oracle was corrected rather than production logic being weakened.
- Stag Matches was the genuine Shopify 1.2 false abstention; Shopify 1.3 fixed only that measured error.
- A technically useful retailer API or parser is not automatically an acceptable production source.
- Source permission is enforced per network hop, not only on the original listing URL.
- Source acceptability should precede adapter/corpus work for every new retailer.
- Public web, retailer API, licensed provider, and browser are separate source methods and may have different approval states for the same retailer.

## Active next program — next retailer source decision

Shopify and Best Buy crawler engineering remain frozen. Walmart public-web engineering is also frozen unless its source status changes.

Next work should continue the source-first sequence rather than increasing scraping sophistication:

1. validate whether Walmart Marketplace solution-provider/seller authorization can support a narrow PriceIntel seller-scoped feature; otherwise seek a licensed provider with appropriate rights;
2. start **Target source acceptability review** before any Target crawler work;
3. then perform the same source decision for Home Depot;
4. only build a new retailer adapter/corpus when its source is explicitly approved for the intended access method;
5. select a future production-browser-fallback test retailer only where source permission is approved and rendering—not access permission—is the real technical obstacle.

## Known risks / intentionally open

- The accepted Shopify score covers 20 URLs / 5 stores, not Shopify as a whole.
- `market_country` / `locale` are persisted but generic active market selection is not implemented across retailers.
- Production browser fallback remains disabled; browser interception cannot replace restrictive deployment egress.
- Best Buy has no currently approved automated data source for PriceIntel.
- Walmart public web is `NOT_APPROVED`; the Marketplace API remains `REVIEW_REQUIRED` pending seller/solution-provider authorization/use-case validation.
- The source-governance registry currently preserves legacy behavior for **unregistered** generic sources to avoid unexpectedly disabling existing Shopify/generic listings. Formal retailer reliability programs must register a source decision before new live measurement. A future explicit migration may make registry membership mandatory for all production sources.
- Registry policy is version-controlled code/docs rather than a normalized database service; this is intentional for the initial governance layer.
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
