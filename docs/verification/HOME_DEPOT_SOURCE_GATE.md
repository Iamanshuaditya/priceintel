# Home Depot Source Gate Verification

Date: **2026-08-21**

Status:

- `HOME_DEPOT_PUBLIC_WEB` — **ACCEPTED: NOT_APPROVED / MANUAL_REVIEW**.
- `HOME_DEPOT_SUPPLIER_PARTNER_DATA` — **REVIEW_REQUIRED governance conclusion; runtime interface intentionally unregistered until actual agreement/interface/scopes are verified**.

This is an operational engineering/source-governance record, not a legal conclusion about every possible Home Depot agreement or data relationship.

## Accepted public-web gate

Implementation/test commit: `7f7a2afa59dce10312ccf360e44015964ebc9bc9`

GitHub Actions hardening run: `32424877131`

The version-controlled source registry contains:

```text
sourceId          HOME_DEPOT_PUBLIC_WEB
hostname patterns homedepot.com, *.homedepot.com
status            NOT_APPROVED
permittedMethods  []
basis             PUBLIC_TERMS_REVIEW
evidence          docs/research/HOME_DEPOT_SOURCE_DECISION.md
```

The deterministic transport regression proves a HomeDepot.com URL is rejected by source authorization before either DNS resolution or HTTP transport. The test requires both counters to remain zero and requires `SOURCE_NOT_APPROVED` with source ID `HOME_DEPOT_PUBLIC_WEB`.

No HomeDepot.com live product request was added as part of this source review.

## Supplier / partner handling

Home Depot publicly documents Supplier Hub onboarding, merchandising/non-merchandising supplier relationships, market insights, operational management tools, and possible EDI capability. It also explicitly states that it does not offer a marketplace.

That supports a research-level `REVIEW_REQUIRED` conclusion for possible supplier/partner data, but the reviewed public material does not establish a PriceIntel-suitable production API/interface or competitor-intelligence rights.

The runtime registry therefore deliberately does **not** contain `HOME_DEPOT_SUPPLIER_PARTNER_DATA`.

A deterministic registry test requires:

```text
sourcePolicyForId('HOME_DEPOT_SUPPLIER_PARTNER_DATA') === undefined
```

until the actual interface/agreement/permitted use is verified. This prevents PriceIntel from guessing an endpoint from Supplier Hub, HDConnect, EDI references, or partner portals.

## Future price-context invariant

Home Depot's official Terms state that product prices may vary due to differing geographic-market conditions. The site notes local-store prices may vary, and the privacy statement says location may be used to provide pricing and availability for nearby stores.

Therefore an approved future Home Depot source must not identify observations by `USD` currency alone.

Before Home Depot reliability measurement reopens, define an explicit price context covering the dimensions relevant to the source, including at least:

```text
country / market
ZIP or equivalent geographic market
storeId when local-store pricing is measured
ONLINE vs LOCAL_STORE channel
fulfillment context when it affects price
currency
```

Price-change comparisons must only compare observations under the same declared context.

## Engineering freeze

Do not add:

- Home Depot frontend reverse engineering;
- Home Depot browser fallback;
- proxy/CAPTCHA work;
- unofficial/internal-looking endpoint probing;
- guessed supplier APIs;
- Home Depot adapters or real corpus measurement.

Reopen Home Depot engineering only when PriceIntel has an acceptable source through written permission, a suitable partner agreement/interface, or a licensed provider with appropriate Home Depot data rights.
