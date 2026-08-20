# Source Governance

Review date: **2026-08-21**

PriceIntel separates **technical capability** from **source approval**. A parser, browser routine, API client, or third-party feed is not a production source merely because it can return a price.

## Registry

Reviewed runtime sources are recorded in the version-controlled registry:

`packages/crawler-core/src/source-governance.ts`

Each runtime record contains:

- `sourceId`;
- verified hostname patterns;
- `appliesToMethods`: which access methods this record governs;
- status: `APPROVED`, `NOT_APPROVED`, or `REVIEW_REQUIRED`;
- `permittedMethods`: which governed methods are actually authorized when the source is approved;
- permission/review basis;
- review date and optional review-after date;
- evidence reference;
- operational reason.

The initial registry is intentionally version-controlled rather than database-managed so source-policy changes receive ordinary code review, deterministic tests, and immutable Git history.

## Method-aware policy selection

Hostname matching alone is insufficient when one retailer exposes multiple source surfaces under the same DNS tree.

`appliesToMethods` and `permittedMethods` answer different questions:

```text
appliesToMethods
→ which policy governs this hostname + access-method request?

permittedMethods
→ which methods does the approved source actually authorize?
```

Policy selection therefore uses **hostname + access method**, not array order.

Lowe's is the first concrete overlapping-host example:

```text
LOWES_PUBLIC_WEB
  hostnamePatterns = lowes.com, *.lowes.com
  appliesToMethods = PUBLIC_HTTP, BROWSER
  status = NOT_APPROVED

LOWES_PARTNER_CATALOG_API
  hostnamePatterns = apis-b2b.lowes.com
  appliesToMethods = RETAILER_API
  status = REVIEW_REQUIRED
```

A `PUBLIC_HTTP` request to `apis-b2b.lowes.com` is governed by the public-web policy, while a `RETAILER_API` request to the same host is governed by the partner-catalog policy. The result does not depend on registry entry order.

`sourcePolicyConflicts()` deterministically scans the registry for hostname-pattern overlap combined with intersecting `appliesToMethods`. CI requires the conflict set to remain empty. An accidental overlapping policy for the same host/method is therefore a test failure rather than an array-order decision.

## Verified runtime addressing rule

Do **not** guess a production API hostname merely to represent a governance conclusion.

A source can be documented as conceptually `REVIEW_REQUIRED` while its actual runtime endpoint, scopes, or account context are still unknown. Such a source should not receive a URL-matching runtime registry record until the address and relevant access contract are verified.

Target Plus is one explicit example: public evidence establishes a seller/developer integration surface, so its source-review conclusion is `REVIEW_REQUIRED`, but the reviewed public material does not establish the production API hostname/scopes needed for safe runtime matching. `TARGET_PLUS_API` therefore remains documented but intentionally absent from `sourcePolicies` until those facts are verified.

Home Depot supplier/partner data is another example. Public material establishes Supplier Hub onboarding, market insights and operational integration capability, but not a verified PriceIntel-suitable data interface or competitor-intelligence permission. `HOME_DEPOT_SUPPLIER_PARTNER_DATA` is therefore a research-level `REVIEW_REQUIRED` conclusion and is intentionally absent from runtime matching.

Lowe's Marketplace seller APIs are handled the same way: a Mirakl seller integration surface is publicly documented, but the reviewed material does not establish the concrete runtime seller API endpoint PriceIntel should govern. `LOWES_MARKETPLACE_SELLER_API` therefore remains research-level `REVIEW_REQUIRED` and intentionally unrouted.

This prevents source governance from accidentally authorizing, denying, or probing an endpoint inferred from a portal hostname rather than an actual source contract.

## Access methods

The registry distinguishes:

- `PUBLIC_HTTP`;
- `RETAILER_API`;
- `LICENSED_PROVIDER`;
- `BROWSER`.

Approval of one source/method does not imply approval of another source or another method for the same retailer.

## Runtime behavior

`evaluateAutomatedSourceAccess()` resolves reviewed URL hosts **for the requested access method** through the registry. `assertAutomatedSourceAccess()` converts a non-approved state into a fail-closed runtime error.

For a matched runtime source:

- `NOT_APPROVED` -> `SOURCE_NOT_APPROVED` / `MANUAL_REVIEW`;
- `REVIEW_REQUIRED` -> `SOURCE_REVIEW_REQUIRED` / `MANUAL_REVIEW`;
- `APPROVED` -> allowed only when the requested access method is listed in `permittedMethods`.

Production `secureFetch()` applies the source authorizer before DNS/SSRF validation and transport on every HTTP hop, including redirects. Supplementary adapter requests use that same fetch path.

## Migration behavior for unregistered sources

The current generic crawler predates the registry and supports arbitrary retailer URLs, including the accepted Shopify corpus. Therefore an **unmatched URL/method remains allowed for now** rather than converting this registry rollout into an unplanned global shutdown.

This is a compatibility boundary, not an assertion that every unregistered source has been affirmatively approved.

The onboarding rule going forward is stricter:

> A retailer that enters a formal PriceIntel reliability program must receive an explicit source-governance decision before new live source measurement begins.

As coverage matures, the project may intentionally move from this compatibility default toward mandatory registry membership for all production retailers. That should be a separate measured migration with explicit handling for existing listings.

## Retailer reliability workflow

Every new retailer/source should proceed in this order:

```text
1. SOURCE ACCEPTABILITY
        ↓
2. TECHNICAL SOURCE SELECTION
        ↓
3. ADAPTER / SOURCE CONTRACT
        ↓
4. SMALL REAL CORPUS
        ↓
5. INDEPENDENT DECISION TRUTH
        ↓
6. RELIABILITY + COST BASELINE
```

Do not reverse this order by building a scraper first and reviewing the source later.

## Evidence and review lifecycle

A source decision should reference the material used for the operational review, such as:

- public terms review;
- written permission;
- signed contract;
- licensed-provider terms/rights evidence.

`reviewAfter` is a governance reminder, not an automatic expiry mechanism yet. A future registry service may enforce review expiry and require `reviewedBy`, contract identifiers, or signed evidence metadata.

## Current governed sources

As of 2026-08-21, runtime registry records are:

- `BESTBUY_PUBLIC_WEB` — `NOT_APPROVED` for `PUBLIC_HTTP/BROWSER`;
- `WALMART_PUBLIC_WEB` — `NOT_APPROVED` for `PUBLIC_HTTP/BROWSER`;
- `WALMART_MARKETPLACE_API` — `REVIEW_REQUIRED` for `RETAILER_API`;
- `TARGET_PUBLIC_WEB` — `NOT_APPROVED` for `PUBLIC_HTTP/BROWSER`;
- `HOME_DEPOT_PUBLIC_WEB` — `NOT_APPROVED` for `PUBLIC_HTTP/BROWSER`;
- `LOWES_PUBLIC_WEB` — `NOT_APPROVED` for `PUBLIC_HTTP/BROWSER`;
- `LOWES_PARTNER_CATALOG_API` — `REVIEW_REQUIRED` for `RETAILER_API` on verified host `apis-b2b.lowes.com`.

Reviewed but intentionally not runtime-routed yet:

- `TARGET_PLUS_API` — `REVIEW_REQUIRED`; exact production API hostname/scopes still need verification;
- `HOME_DEPOT_SUPPLIER_PARTNER_DATA` — `REVIEW_REQUIRED`; actual interface/agreement/permitted use still need verification;
- `LOWES_MARKETPLACE_SELLER_API` — `REVIEW_REQUIRED`; seller runtime endpoint/agreement/scope still need verification.

Best Buy parser capability remains dormant/tested while its live source is frozen. Retailer decisions are documented in the corresponding files under `docs/research/`, including `LOWES_SOURCE_DECISION.md`.
