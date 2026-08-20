# Status

## Current milestone

**Shopify reliability v1 is accepted/frozen. Source governance is a version-controlled platform capability. Best Buy, Walmart, Target, Home Depot, and Lowe's public-web crawler engineering are frozen behind source approval. Lowe's is the first reviewed large retailer with a verified structured partner pricing source that remains a serious commercial approval candidate.**

The accepted Shopify claim remains deliberately scoped: on the frozen 20-URL / 5-store Shopify corpus with independently reviewed decision truth, `shopify@1.3.0` achieved 100% decision accuracy: 15/15 expected observations correctly priced, 4/4 variant ambiguities correctly abstained, and 1/1 unavailable page correctly classified, with zero false price observations and zero false abstentions.

This is **not** a claim that PriceIntel is 100% accurate on all Shopify stores. It is the accepted baseline for this corpus and adapter version.

The corrected pre-fix replay of Shopify 1.2 scored 95% on the same truth set, with Stag Matches as the sole false abstention. Shopify 1.3's narrow availability-aware variant rule fixed that miss without creating an unsafe observation.

The Shopify market-safety gate is complete: competitor listings carry an explicit market contract and unexpected currencies are rejected before persistence as `MARKET_MISMATCH / NEEDS_REVIEW`.

Best Buy public web, Walmart public web, Target public web, Home Depot public web, and Lowe's public web are all governed as `NOT_APPROVED` for the currently reviewed automated public-web use. Their runtime policies fail closed before network transport.

Reviewed structured/partner surfaces remain separate source decisions:

- `WALMART_MARKETPLACE_API` -> `REVIEW_REQUIRED` for seller/solution-provider-scoped use;
- `TARGET_PLUS_API` -> research-level `REVIEW_REQUIRED`, intentionally unrouted until the real production API endpoint/scopes are verified;
- `HOME_DEPOT_SUPPLIER_PARTNER_DATA` -> research-level `REVIEW_REQUIRED`, intentionally unrouted until a real permitted interface/agreement is verified;
- `LOWES_PARTNER_CATALOG_API` -> runtime `REVIEW_REQUIRED` on verified production host `apis-b2b.lowes.com` for `RETAILER_API`;
- `LOWES_MARKETPLACE_SELLER_API` -> research-level `REVIEW_REQUIRED`, intentionally unrouted until the seller API endpoint/agreement/scope is verified.

Lowe's also forced an important governance improvement: source-policy selection is now method-aware. A broad public-web hostname policy and a narrower retailer-API policy can overlap in DNS space without relying on registry order.

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

The version-controlled registry initially established source ID, verified hostname patterns, status, permitted access methods, review basis, review dates, evidence reference, and operational reason. Walmart public web is denied before DNS/transport while its Marketplace API remains a separate `REVIEW_REQUIRED` source.

### Target public-web source gate

Commit `f9d29c747a269a433a8e0beb7f20a9b990e37c45` passed hardening run `32423634205`.

`TARGET_PUBLIC_WEB` is a `NOT_APPROVED` runtime policy for `target.com` / subdomains. The deterministic transport regression requires Target authorization to reject before both resolver and transport invocation.

`TARGET_PLUS_API` remains intentionally absent from runtime matching until the real production endpoint/scope is verified. Target also has a future price-context requirement covering stable location/store/channel/personalization context.

### Home Depot public-web source gate

Commit `7f7a2afa59dce10312ccf360e44015964ebc9bc9` passed hardening run `32424877131`.

`HOME_DEPOT_PUBLIC_WEB` is a `NOT_APPROVED` runtime policy for `homedepot.com` / subdomains. The deterministic transport regression requires Home Depot authorization to reject before both resolver and transport invocation.

`HOME_DEPOT_SUPPLIER_PARTNER_DATA` remains a research-level `REVIEW_REQUIRED` conclusion with no guessed runtime endpoint. Home Depot also has a future geographic/store/channel/fulfillment price-context requirement.

### Lowe's method-aware source gate

Corrected implementation/test commit `65583fa1b8e5708f906241bef7f40f9737ba8ac6` passed hardening run `32425946580`.

The registry now separates:

```text
appliesToMethods
→ which policy governs a hostname + method request

permittedMethods
→ which methods an approved source actually authorizes
```

`sourcePolicyConflicts()` rejects overlapping hostname policies when their `appliesToMethods` intersect. The deterministic suite requires the production conflict set to remain empty, eliminating array-order dependence.

Lowe's runtime records are:

```text
LOWES_PUBLIC_WEB
  lowes.com, *.lowes.com
  appliesToMethods = PUBLIC_HTTP, BROWSER
  status = NOT_APPROVED

LOWES_PARTNER_CATALOG_API
  apis-b2b.lowes.com
  appliesToMethods = RETAILER_API
  status = REVIEW_REQUIRED
```

Regression coverage proves:

- Lowes.com public web -> `SOURCE_NOT_APPROVED` before DNS/transport;
- `apis-b2b.lowes.com` as `PUBLIC_HTTP` -> `LOWES_PUBLIC_WEB / SOURCE_NOT_APPROVED`;
- the same API URL as `RETAILER_API` -> `LOWES_PARTNER_CATALOG_API / SOURCE_REVIEW_REQUIRED`;
- production registry ambiguity set is empty;
- a synthetic overlapping same-method policy is detected as a conflict;
- `LOWES_MARKETPLACE_SELLER_API` remains intentionally absent from runtime matching.

Initial run `32425778570` on `0806cde63d09bd5d3ab4e8c9dbf54adc5d03000e` failed strict TypeScript before runtime assertions because a synthetic test fixture made `permittedMethods` readonly. The corrected commit changed only fixture typing; no behavioral assertion changed.

Lowe's source rationale, commercial approval questions, Marketplace seller separation, and future national/store/ZIP/customer-pricing context are recorded in `docs/research/LOWES_SOURCE_DECISION.md` and `docs/verification/LOWES_SOURCE_GATE.md`.

No Lowe's live public-web product fetch, browser experiment, adapter, proxy/CAPTCHA work, or frontend reverse engineering was added.

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
- Best Buy direct and per-hop source-denial gates accepted; parser remains dormant.
- Version-controlled source-governance registry implemented and tested.
- Walmart public-web source `NOT_APPROVED`; Marketplace API separately `REVIEW_REQUIRED`.
- Target public-web source `NOT_APPROVED`; Target Plus research-level `REVIEW_REQUIRED`/unrouted.
- Home Depot public-web source `NOT_APPROVED`; supplier/partner data research-level `REVIEW_REQUIRED`/unrouted.
- Lowe's public-web source `NOT_APPROVED` without a live product-page experiment.
- Lowe's verified Partner Product Catalog API recorded as `REVIEW_REQUIRED` for `RETAILER_API` on `apis-b2b.lowes.com`.
- Lowe's Marketplace seller API kept research-level `REVIEW_REQUIRED`/unrouted until endpoint/agreement/scope verification.
- Source-policy selection made method-aware with deterministic ambiguity detection.
- Future price identity requirements recorded for location/context-sensitive retailers.

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
- Runtime source matching must use verified endpoints; governance must not invent API hostnames from portal/documentation URLs.
- Policy selection must use hostname **and source method** when source namespaces overlap; registry ordering is not an authorization mechanism.
- Currency alone may be insufficient price identity for location-sensitive retailers.
- Supplier/seller access is not automatically a competitor-price data license.
- A structured partner API can be technically appropriate while remaining disabled pending rights/use-case approval.

## Active next program — Lowe's partner-source commercial approval

All reviewed public-web crawler programs remain frozen unless source status changes.

The highest-value next source event is external/commercial rather than crawler engineering:

1. contact the Lowe's partner/integration team and obtain the applicable Product Catalog/API agreement or written answer for PriceIntel's intended use;
2. confirm whether the source permits competitor-price monitoring, historical retention, source evidence, derived analytics, customer-facing history/alerts, and the expected operating volume;
3. confirm whether national and/or store-level feeds may be used for this purpose;
4. keep anonymous retail pricing as the ordinary default; do not submit customer email/identity for Pro contract pricing without explicit customer authorization and source-agreement support;
5. if approved, make `LOWES_PARTNER_CATALOG_API` the next large-retailer reliability program: authenticated source contract -> bounded real corpus -> independent decision truth -> reliability/cost baseline;
6. if not approved, keep Lowe's frozen and continue source-acceptability review for another retailer or a licensed provider.

## Known risks / intentionally open

- The accepted Shopify score covers 20 URLs / 5 stores, not Shopify as a whole.
- `market_country` / `locale` are persisted but generic active market selection is not implemented across retailers.
- Production browser fallback remains disabled; browser interception cannot replace restrictive deployment egress.
- Best Buy has no currently approved automated data source for PriceIntel.
- Walmart public web is `NOT_APPROVED`; Marketplace API remains `REVIEW_REQUIRED`.
- Target public web is `NOT_APPROVED`; Target Plus remains research-level `REVIEW_REQUIRED`/unrouted.
- Home Depot public web is `NOT_APPROVED`; supplier/partner data remains research-level `REVIEW_REQUIRED`/unrouted.
- Lowe's public web is `NOT_APPROVED`; the verified Partner Product Catalog API remains `REVIEW_REQUIRED` pending agreement/use-case approval.
- Lowe's Marketplace seller API remains research-level `REVIEW_REQUIRED` with no verified runtime endpoint record yet.
- Lowe's requires a richer national/store/ZIP/channel/customer-pricing context before comparable observations are generated.
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
