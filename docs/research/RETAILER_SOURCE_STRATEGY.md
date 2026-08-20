# Retailer Source Strategy

This document records source-strategy conclusions discovered by live canaries and accepted reliability loops. A measured retailer baseline is always scoped to its tested corpus; it is not a universal reliability claim.

## Shopify storefronts — v1 accepted/frozen

Primary source remains ordinary product HTML through PriceIntel's DNS-pinned HTTP transport.

For compatible Shopify-hosted themes, adapter `shopify@1.3.0` may request bounded same-origin supplementary artifacts through crawler core:

1. `/{locale}/products/{handle}.js` for product/variant data;
2. `/{locale}/cart.js` only when presentment currency cannot be established from the primary page.

Supplementary work is bounded by crawler-core request/byte/time limits and uses the same hardened HTTP transport as primary fetches.

References:
- https://shopify.dev/docs/api/ajax/reference/product
- https://shopify.dev/docs/api/ajax

Important limitation: Shopify documents the Ajax API as available to themes hosted by Shopify, not custom storefronts. A `404` from the Ajax endpoint is evidence that this source strategy does not apply; it is not a reason to recursively probe arbitrary URLs or invent a price.

Variant policy is accuracy-first:

- explicit `?variant=` URLs may produce variant-specific observations;
- if multiple currently relevant/available variants have different prices, product-level extraction abstains;
- unavailable variants may be excluded only when availability evidence is complete;
- incomplete availability evidence remains conservative;
- OpenGraph price is not sufficient standalone evidence for a variant-bearing Shopify product.

Accepted measured baseline:

- frozen corpus: 20 URLs / 5 stores;
- corrected decision truth: 15 expected observations, 4 expected variant abstentions, 1 unavailable page;
- Shopify 1.2 corrected replay: 95% overall decision accuracy, one false abstention, zero false prices/unsafe observations;
- Shopify 1.3: 100% overall decision accuracy on the same truth, zero false prices/unsafe observations/false abstentions.

See `docs/verification/SHOPIFY_RELIABILITY_V1.md` for immutable run/artifact evidence and the Scindapsus oracle correction.

This means **Shopify v1 is frozen**, not that PriceIntel is universally 100% accurate on Shopify.

Listing market safety is separate from adapter correctness. Every monitored listing has an `expected_currency`; optional `market_country`/`locale` record market intent. Unexpected currency becomes `MARKET_MISMATCH` / `NEEDS_REVIEW` before persistence, preventing worker/storefront geography from silently becoming a price-change observation.

## Walmart

The current live corpus reaches an explicit `/blocked` challenge page. That state is classified `BLOCKED`, not `BROWSER_RENDER`.

PriceIntel will not define browser fallback as a mechanism for defeating access controls or CAPTCHAs. Walmart Marketplace APIs are seller/solution-provider oriented and are not currently treated as an anonymous competitor-price source for this product.

Reference:
- https://developer.walmart.com/us-marketplace/docs

Next source action: investigate a permitted commercial data source, retailer agreement, or another approved source. Until then, blocked Walmart pages remain honest failures.

## Best Buy — active next source program

The public Best Buy Products API technically exposes product catalog information including pricing and availability.

References:
- https://developer.bestbuy.com/apis
- https://developer.bestbuy.com/legal

The public API Terms reviewed during the Shopify reliability program include a restriction against using the Services or Content on behalf of or for the benefit of a third party, such as other retailers, for analyzing/reviewing Best Buy pricing, products, or services. That appears incompatible with using the public developer API as the default source for a third-party competitor-price intelligence SaaS.

Therefore PriceIntel does **not** integrate the public Best Buy API under those terms. Production API use requires written permission or a separate agreement that actually permits the intended use.

The next Best Buy reliability loop is source-first:

1. verify whether an acceptable public, retailer-approved, licensed, or commercial structured source exists;
2. keep the public developer API at `MANUAL_REVIEW` unless a suitable agreement permits PriceIntel's intended use;
3. only then create deterministic source/adapter contracts;
4. measure a small real Best Buy corpus for fetch success, extraction/abstention behavior, independent truth correctness, bytes/latency, and source failures;
5. do not treat blocked/challenged web access as justification for anti-bot circumvention.

## Browser source policy

Browser rendering is appropriate only when an otherwise permitted public source genuinely requires client rendering and lightweight sources are insufficient.

Browser fallback is **not** appropriate merely because:

- a challenge page exists;
- a retailer blocks automated access;
- an API's terms are unsuitable;
- a source is commercially inconvenient.

Production Chromium remains disabled until browser-specific egress isolation, context isolation, redirect/websocket/service-worker policy, and request/byte/time budgets satisfy the browser security gate.

## Source-selection principle

Prefer the cheapest sufficiently reliable **permitted** source, but never collapse these distinct states:

- page is accessible but structured extraction is incomplete;
- an approved supplementary source exists;
- JavaScript rendering is genuinely required;
- the retailer explicitly blocks/challenges access;
- an API exists technically but its terms do not permit this use;
- no trustworthy permitted source exists yet.

Reliability measurement, failure honesty, market integrity, and source permission are all part of adapter acceptance.
