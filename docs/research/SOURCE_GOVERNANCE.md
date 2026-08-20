# Source Governance

Review date: **2026-08-21**

PriceIntel separates **technical capability** from **source approval**. A parser, browser routine, API client, or third-party feed is not a production source merely because it can return a price.

## Registry

Reviewed sources are recorded in the version-controlled registry:

`packages/crawler-core/src/source-governance.ts`

Each record contains:

- `sourceId`;
- hostname patterns;
- status: `APPROVED`, `NOT_APPROVED`, or `REVIEW_REQUIRED`;
- permitted access methods;
- permission/review basis;
- review date and optional review-after date;
- evidence reference;
- operational reason.

The initial registry is intentionally version-controlled rather than database-managed so source-policy changes receive ordinary code review, deterministic tests, and immutable Git history.

## Access methods

The registry distinguishes:

- `PUBLIC_HTTP`;
- `RETAILER_API`;
- `LICENSED_PROVIDER`;
- `BROWSER`.

An approved source must explicitly permit the method PriceIntel intends to use. Approval of one source/method does not imply approval of another source or another method for the same retailer.

## Runtime behavior

`evaluateAutomatedSourceAccess()` resolves reviewed URL hosts through the registry. `assertAutomatedSourceAccess()` converts a non-approved state into a fail-closed runtime error.

For reviewed sources:

- `NOT_APPROVED` -> `SOURCE_NOT_APPROVED` / `MANUAL_REVIEW`;
- `REVIEW_REQUIRED` -> `SOURCE_REVIEW_REQUIRED` / `MANUAL_REVIEW`;
- `APPROVED` -> allowed only when the requested access method is listed in `permittedMethods`.

Production `secureFetch()` applies the source authorizer before DNS/SSRF validation and transport on every HTTP hop, including redirects. Supplementary adapter requests use that same fetch path.

## Migration behavior for unregistered sources

The current generic crawler predates the registry and supports arbitrary retailer URLs, including the accepted Shopify corpus. Therefore an **unmatched URL remains allowed for now** rather than converting this registry rollout into an unplanned global shutdown.

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

As of 2026-08-21:

- `BESTBUY_PUBLIC_WEB` — `NOT_APPROVED`;
- `WALMART_PUBLIC_WEB` — `NOT_APPROVED`;
- `WALMART_MARKETPLACE_API` — `REVIEW_REQUIRED`.

Best Buy parser capability remains dormant/tested while its live source is frozen. Walmart source decisions are documented separately in `docs/research/WALMART_SOURCE_DECISION.md`.
