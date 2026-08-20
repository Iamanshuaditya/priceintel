# Walmart Source Decision

Review date: **2026-08-21**

Operational status:

- `WALMART_PUBLIC_WEB` — **NOT_APPROVED** for PriceIntel automated collection.
- `WALMART_MARKETPLACE_API` — **REVIEW_REQUIRED**; do not use until the intended seller/solution-provider use is confirmed as permitted and PriceIntel has the required onboarding/authorization.

This is an engineering/source-governance decision for PriceIntel, not legal advice.

## Public Walmart.com web source

Official terms reviewed:

- https://www.walmart.com/help/article/walmart.com-terms-of-use/3b75080af40340d6bbd596f116fae5a0

The reviewed Walmart.com Terms of Use identify themselves as last updated June 23, 2026. They restrict commercial use and, without Walmart's express prior written consent, prohibit robots/spiders/search-retrieval applications and other automatic devices used to retrieve, index, scrape, data-mine, or gather Materials. The terms also specifically prohibit collection/use of product listings, descriptions, or prices and similar data-gathering/extraction use.

PriceIntel's intended automated competitor-price monitoring therefore does not treat Walmart.com HTML as an approved live source under the reviewed public terms.

Operational registry decision:

```text
sourceId      WALMART_PUBLIC_WEB
status        NOT_APPROVED
method        PUBLIC_HTTP / browser not permitted by this record
next action   MANUAL_REVIEW / approved-source investigation
```

The earlier real probe that landed on Walmart's `/blocked` flow remains useful historical evidence of access behavior, but the source decision now occurs **before** any such network experiment. A block/challenge is no longer a reason to escalate to a more aggressive browser path.

## Walmart Marketplace APIs

Official developer material reviewed:

- https://developer.walmart.com/us-marketplace/page/terms-and-conditions
- https://developer.walmart.com/us-marketplace/docs/get-pricing-insights
- https://developer.walmart.com/us-marketplace/docs/pricing-overview
- https://developer.walmart.com/us-marketplace/reference/getsearchresult
- https://developer.walmart.com/us-marketplace/docs/get-started-as-a-solution-provider
- https://developer.walmart.com/us-marketplace/docs/api-scope-walmart-marketplace

The current Walmart Marketplace API license is oriented around Developer Applications that provide offerings to or on behalf of Walmart Suppliers/Sellers. It restricts reuse and commercial exploitation of Walmart Data outside the approved purposes and requires the Developer to operate within the supplier/seller relationship and applicable onboarding/authorization.

Technically, the Marketplace APIs are highly relevant:

- Pricing APIs can retrieve/manage prices for a seller's Walmart catalog.
- Pricing Insights can expose current item price, Buy Box pricing, competitive pricing information, repricer details, and competitiveness signals **for the seller's items**.
- Item Search can query Walmart's catalog so a seller can decide whether to sell this item.

Those capabilities do not automatically establish that PriceIntel may use Marketplace credentials as a general-purpose Walmart competitor-price feed for arbitrary third-party listings.

### Formal solution-provider route exists

Walmart documents a formal US solution-provider program. A company can apply to become an approved Solution Provider, receive sandbox access after approval, implement OAuth 2.0, register an application for the Seller Center App Store, pass Walmart verification, and then allow Walmart sellers to authorize that application.

The OAuth scope documentation further describes seller-visible scopes and requires approved Solution Providers to request only the access needed for the integration.

That is materially different from anonymous public-web collection. It gives PriceIntel a plausible **seller-authorized product direction**, but it still does not establish that the exact competitor-intelligence feature PriceIntel wants is permitted under the agreement or available under the necessary API scopes.

Therefore the Marketplace API remains `REVIEW_REQUIRED`, not `APPROVED` and not blanket `NOT_APPROVED`:

```text
sourceId      WALMART_MARKETPLACE_API
status        REVIEW_REQUIRED
method        RETAILER_API
next action   verify solution-provider approval, seller consent, scopes, and permitted use
```

No production Marketplace API calls should be made until that review is complete and the access contract is intentionally changed.

## Affiliate / Creator data

Official terms reviewed:

- https://affiliates.walmart.com/terms
- https://creator.walmart.com/terms

The reviewed affiliate/creator materials are designed for referral/creator use rather than competitor-intelligence redistribution. The creator terms restrict redistribution/syndication of Walmart licensed materials/datafeed to third-party partners, networks, or agencies, and the affiliate RSS terms describe the feed as personal/noncommercial except as otherwise permitted by the program.

Therefore an affiliate/creator account or datafeed is **not** treated as a generic workaround for PriceIntel's source needs. A program-specific written right covering the intended monitoring/derived-analytics use would have to be reviewed separately.

## Advertising / supplier APIs

Walmart also exposes APIs for advertisers, suppliers, and internal/partner integrations. The reviewed documentation scopes those APIs to the relevant advertiser/seller/supplier catalog and business relationship. They are not currently classified as general Walmart competitor-price sources for PriceIntel.

Examples:

- https://developer.walmart.com/advertising-partners-search/reference/catalogsearch
- https://developer.walmart.com/suppliers/docs/item-management-api-overview

If a future PriceIntel product is specifically authorized to act for such an account, that should receive a separate sourceId and method-specific review rather than inheriting approval from `WALMART_MARKETPLACE_API`.

## Runtime policy

The version-controlled source-governance registry now records the two Walmart decisions.

For `walmart.com` and its subdomains, normal production/public-web fetch authorization fails before DNS/transport with:

```text
SOURCE_NOT_APPROVED
NEEDS_REVIEW
```

For `marketplace.walmartapis.com`, an explicit `RETAILER_API` source evaluation returns:

```text
SOURCE_REVIEW_REQUIRED
MANUAL_REVIEW
```

The worker currently uses the public-HTTP authorizer for listing crawls, so Walmart.com listings fail closed before crawler transport. No Walmart adapter or browser change is needed for this source milestone.

## What can reopen Walmart engineering

Reopen a Walmart technical source experiment only after one of these is established:

1. express Walmart permission for PriceIntel's intended automated competitor-price use;
2. approved Walmart solution-provider status plus seller authorization/scopes and terms that cover the specific PriceIntel feature;
3. a licensed third-party provider whose rights explicitly cover the required Walmart price data, retention, derived analytics, and customer use.

A proxy, CAPTCHA solver, browser automation, affiliate account, or vendor that merely claims to scrape Walmart does not establish source approval.

## Current engineering stop point

Do not add Walmart scraper/browser sophistication while source approval is unresolved.

The next Walmart work is commercial/source validation of the Marketplace solution-provider route and/or licensed data providers. If one becomes acceptable, create a new explicit source contract, update the registry with its permission basis and permitted method, then begin the normal small-corpus -> independent-truth -> reliability/cost loop.
