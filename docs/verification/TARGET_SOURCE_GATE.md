# Target Source Gate Verification

Date: **2026-08-21**

Status:

- `TARGET_PUBLIC_WEB` — **ACCEPTED: NOT_APPROVED / MANUAL_REVIEW**.
- `TARGET_PLUS_API` — **REVIEW_REQUIRED governance conclusion; runtime endpoint intentionally unregistered until the real API hostname/scopes are verified**.

This is an operational engineering/source-governance record, not a legal conclusion about every possible Target agreement or integration.

## Accepted Target public-web gate

Implementation/test commit: `f9d29c747a269a433a8e0beb7f20a9b990e37c45`

GitHub Actions hardening run: `32423634205`

The version-controlled source registry contains:

```text
sourceId          TARGET_PUBLIC_WEB
hostname patterns target.com, *.target.com
status            NOT_APPROVED
permittedMethods  []
basis             PUBLIC_TERMS_REVIEW
evidence          docs/research/TARGET_SOURCE_DECISION.md
```

The deterministic transport regression proves a Target.com URL is rejected by source authorization before either DNS resolution or HTTP transport. The test requires both counters to remain zero and requires `SOURCE_NOT_APPROVED` with source ID `TARGET_PUBLIC_WEB`.

No Target.com live network request was added as part of this source review.

## Target Plus handling

Public Target material establishes a curated Target Plus seller program, onboarding/contracting, developer/external-user access, and public API-resource references.

That supports a `REVIEW_REQUIRED` source-governance conclusion for a possible seller/partner integration, but the reviewed public material does not establish the production API hostname, exact scopes, seller authorization model for the intended feature, or general competitor-monitoring rights.

The runtime registry therefore deliberately does **not** contain `TARGET_PLUS_API` yet.

A deterministic registry test requires:

```text
sourcePolicyForId('TARGET_PLUS_API') === undefined
```

until the actual endpoint/scope is verified. This prevents PriceIntel from guessing an API hostname from the developer portal or documentation site and then treating that guessed address as a governed production source.

When the real runtime endpoint and applicable agreement/scopes are verified, add a distinct `TARGET_PLUS_API` record with `RETAILER_API` method and the appropriate status/evidence.

## Future price-context invariant

Target's official pricing guidance states that online/store pricing can differ, pricing/promotions/availability can vary by location, and personalized savings may use location and shopping history.

Therefore an approved future Target source must not identify observations by `USD` currency alone.

Before Target reliability measurement reopens, define an explicit price context covering at least the relevant dimensions:

```text
country / market
ZIP or equivalent location
storeId when store pricing is measured
ONLINE vs STORE channel
anonymous/non-member vs separately approved personalized context
currency
```

A PriceIntel price-change comparison must only compare observations measured under the same declared context.

## Engineering freeze

Do not add:

- Target frontend reverse engineering;
- Target browser fallback;
- proxy/CAPTCHA work;
- guessed Target Plus API requests;
- Target adapters or real corpus measurement.

Reopen Target engineering only after an acceptable source is established through written permission, a suitable agreement, verified seller/partner API rights for a specific PriceIntel feature, or a licensed provider with appropriate Target data rights.
