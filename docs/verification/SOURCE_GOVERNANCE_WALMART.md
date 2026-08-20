# Source Governance + Walmart Verification

Date: **2026-08-21**

Status: **ACCEPTED — governance registry implemented; Walmart source decision completed without new crawler access**

This record verifies the first retailer transition from hard-coded source denial to a reusable source-governance registry.

## Accepted implementation

Commit: `02cd370c8869216ee2d814ea40bb73a167abeb88`

GitHub Actions hardening run: `32422743147`

The full hardening gate passed with:

- strict TypeScript;
- deterministic crawler/security tests;
- PostgreSQL/Redis/BullMQ integration;
- build/migration execution;
- operator Chromium E2E.

## Source-governance registry

`packages/crawler-core/src/source-governance.ts` is the version-controlled policy registry.

Each reviewed source record includes:

```text
sourceId
hostnamePatterns
status
permittedMethods
basis
reviewedAt
reviewAfter
evidenceReference
reason
```

Supported statuses:

- `APPROVED`;
- `NOT_APPROVED`;
- `REVIEW_REQUIRED`.

Supported access methods:

- `PUBLIC_HTTP`;
- `RETAILER_API`;
- `LICENSED_PROVIDER`;
- `BROWSER`.

`source-access-policy.ts` evaluates reviewed sources through this registry rather than retailer-specific conditional branches.

## Compatibility boundary

Unregistered URLs continue to use the pre-existing generic-crawler behavior for now. This prevents the governance rollout from silently disabling the accepted Shopify/generic product surface.

This is **not** affirmative approval of every unknown source.

The onboarding invariant is:

> Any retailer entering a formal PriceIntel reliability program must receive an explicit source decision before new live source measurement begins.

A future intentional migration may make registry membership mandatory for all production sources.

## Walmart public web

Policy:

```text
sourceId       WALMART_PUBLIC_WEB
status         NOT_APPROVED
method         PUBLIC_HTTP
failure        SOURCE_NOT_APPROVED
next action    MANUAL_REVIEW / approved-source investigation
```

Deterministic transport regression proves a Walmart.com URL is rejected before both DNS resolution and transport invocation when the production source authorizer is supplied.

No Walmart.com request, browser experiment, proxy, or challenge bypass was introduced to reach this decision.

The operational basis is recorded in:

`docs/research/WALMART_SOURCE_DECISION.md`

## Walmart Marketplace API

Policy:

```text
sourceId       WALMART_MARKETPLACE_API
status         REVIEW_REQUIRED
method         RETAILER_API
failure        SOURCE_REVIEW_REQUIRED
next action    MANUAL_REVIEW
```

The API is not collapsed into the public-web decision because the technical and contractual context differs. Walmart Marketplace documentation exposes seller-scoped pricing, pricing insights, Buy Box/competitive-pricing information, and catalog functions for sellers/approved solution providers.

Before PriceIntel can classify this source `APPROVED`, the actual seller/solution-provider onboarding, seller authorization, and intended PriceIntel use must be reviewed and shown to fit the applicable agreement. Until then, no API experiment is required or permitted by this policy.

## Best Buy regression preservation

The registry migration preserves the already accepted Best Buy invariants:

- direct Best Buy denial before DNS/transport;
- approved-origin -> Best Buy redirect denial before Best Buy DNS/transport;
- supplementary redirect denial;
- approved -> approved redirects remain functional.

Best Buy remains `NOT_APPROVED` / frozen pending an approved source.

## Accepted source-first workflow

New retailer reliability programs now proceed:

```text
SOURCE ACCEPTABILITY
        ↓
TECHNICAL SOURCE SELECTION
        ↓
ADAPTER / SOURCE CONTRACT
        ↓
SMALL REAL CORPUS
        ↓
INDEPENDENT TRUTH
        ↓
RELIABILITY + COST BASELINE
```

This prevents PriceIntel from treating “technically fetchable” as equivalent to “approved production source.”

## Walmart engineering stop point

Do not add Walmart web scraping, browser fallback, CAPTCHA handling, proxy rotation, or alternate public-web extraction paths while `WALMART_PUBLIC_WEB` is `NOT_APPROVED`.

Potential legitimate reopen conditions:

1. express Walmart permission covering the intended use;
2. approved Marketplace solution-provider/seller authorization whose terms cover the specific PriceIntel feature;
3. a licensed third-party provider with rights covering Walmart pricing data, retention, derived analytics, and customer use.

Until one exists, Walmart technical crawling is frozen and the next retailer source-acceptability review may proceed independently.
