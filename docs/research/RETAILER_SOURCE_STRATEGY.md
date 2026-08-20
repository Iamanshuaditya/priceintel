# Retailer Source Strategy

This document records source-strategy conclusions discovered by live canaries. It is not a claim that any retailer source is currently production reliable.

## Shopify storefronts

Primary source remains ordinary product HTML through PriceIntel's DNS-pinned HTTP transport.

For Shopify-hosted themes, adapter `shopify@1.1.0` may request at most two same-origin supplementary artifacts through crawler core:

1. `/{locale}/products/{handle}.js` for product/variant data;
2. `/{locale}/cart.js` only when presentment currency cannot be established from the primary page.

References:
- https://shopify.dev/docs/api/ajax/reference/product
- https://shopify.dev/docs/api/ajax

Important limitation: Shopify documents the Ajax API as available to themes hosted by Shopify, not custom storefronts. A `404` from the Ajax endpoint is therefore evidence that the source strategy may not apply; it is not a reason for an adapter to invent a price or recursively probe arbitrary URLs.

Variant policy remains conservative. If prices vary and the monitored URL does not identify an exact `variant` ID, PriceIntel emits no price candidate.

## Walmart

The current live corpus reaches an explicit `/blocked` challenge page. That state is classified `BLOCKED`, not `BROWSER_RENDER`.

PriceIntel will not define browser fallback as a mechanism for defeating access controls or CAPTCHAs. Walmart Marketplace APIs are seller/solution-provider oriented and are not currently treated as an anonymous competitor-price source for this product.

Reference:
- https://developer.walmart.com/us-marketplace/docs

Next source action: investigate a permitted commercial data source, retailer agreement, or another approved source. Until then, blocked Walmart pages remain honest failures.

## Best Buy

The public Best Buy Products API technically exposes product catalog information including pricing and availability.

References:
- https://developer.bestbuy.com/apis
- https://developer.bestbuy.com/legal

However, the public API Terms reviewed on 2026-08-20 include a restriction against using the Services or Content on behalf of or for the benefit of a third party, such as other retailers, for analyzing/reviewing Best Buy pricing, products, or services. That appears incompatible with using the public developer API as the default source for a third-party competitor-price intelligence SaaS.

Therefore PriceIntel does **not** integrate the public Best Buy API under those terms. Production API use requires written permission or a separate agreement that actually permits the intended use. The current next action is `MANUAL_REVIEW` / licensed-source investigation, not `APPROVED_API` as though approval already existed.

## Source-selection principle

Prefer the cheapest reliable permitted source, but never collapse these distinct states:

- page is accessible but structured extraction is incomplete;
- an approved supplementary source exists;
- JavaScript rendering is genuinely required;
- the retailer explicitly blocks/challenges access;
- an API exists technically but its terms do not permit this use;
- no trustworthy permitted source exists yet.

Reliability measurement and commercial/source permission are both part of adapter acceptance.
