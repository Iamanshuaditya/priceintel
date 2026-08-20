# Home Depot Source Decision

Review date: **2026-08-21**

Operational status:

- `HOME_DEPOT_PUBLIC_WEB` — **NOT_APPROVED** for PriceIntel automated commercial collection.
- `HOME_DEPOT_SUPPLIER_PARTNER_DATA` — **REVIEW_REQUIRED governance conclusion only**; no runtime source/hostname is registered until an actual interface, agreement, scope, and permitted use are verified.

This is an engineering/source-governance decision for PriceIntel, not legal advice.

## HomeDepot.com public web

Official material reviewed:

- https://www.homedepot.com/c/Terms_of_Use

The reviewed Terms of Use grant permission to view/use the site and print individual pages for personal, noncommercial use. They prohibit modifying, copying beyond that limited use, distributing, reproducing, publishing, licensing, creating derivative works from, transferring, or selling site information/materials.

The Terms also identify extracting, scraping, mining, copying, or otherwise gathering site information as prohibited reseller activity when used in connection with downstream product sales.

For PriceIntel's B2B competitor-price-monitoring purpose, the reviewed public terms do not establish an acceptable basis for automated HomeDepot.com product/price collection.

Runtime decision:

```text
sourceId          HOME_DEPOT_PUBLIC_WEB
hostname patterns homedepot.com, *.homedepot.com
status            NOT_APPROVED
permittedMethods  []
basis             PUBLIC_TERMS_REVIEW
next action       MANUAL_REVIEW / approved-source investigation
```

No HomeDepot.com live product request, browser experiment, adapter work, or frontend reverse engineering was added as part of this review.

## Supplier / partner route

Official material reviewed:

- https://www.homedepot.com/c/suppliers_and_providers

Home Depot publicly documents supplier onboarding, Supplier Hub access, merchandising/non-merchandising supplier relationships, operational tools, market insights, and possible EDI capability for seamless order management.

The same supplier page explicitly answers its marketplace FAQ with:

> Although we don't offer a marketplace, we do have established onboarding paths.

That distinguishes Home Depot from Walmart Marketplace and Target Plus. The reviewed material shows a supplier/partner relationship, not a general seller marketplace or a public competitor-pricing API.

The public material does not establish:

- a verified production API hostname or interface suitable for PriceIntel;
- a general Home Depot pricing-data API for third-party competitor intelligence;
- rights to reuse Supplier Hub/partner data for arbitrary competitor monitoring;
- scopes, customer authorization, retention, derived analytics, or redistribution rights for PriceIntel's intended use.

Therefore the governance conclusion is:

```text
HOME_DEPOT_SUPPLIER_PARTNER_DATA
→ REVIEW_REQUIRED
```

but there is deliberately **no runtime registry entry** for that source today. Do not guess an API hostname from Supplier Hub, HDConnect, EDI documentation, or other partner portals.

Reopen this route only after the actual agreement/interface/scopes and permitted data uses are reviewed.

## Geographic/store price identity

Official material reviewed:

- https://www.homedepot.com/c/Terms_of_Use
- https://www.homedepot.com/privacy/privacy-and-security-statement
- https://www.homedepot.com/c/suppliers_and_providers

Home Depot's Terms state that site product prices may vary from other advertised prices because of differing conditions in different geographic markets. The site also notes that local-store prices may vary from displayed prices.

Home Depot's privacy statement says location data may be used to find the nearest store and provide product pricing and availability at nearby stores.

Therefore an eventual approved Home Depot source must not identify observations by `USD` currency alone. Before Home Depot reliability measurement reopens, define a stable price context covering at least the dimensions relevant to the approved source:

```text
country / market
ZIP or equivalent geographic market
storeId when local-store pricing is measured
ONLINE vs LOCAL_STORE channel
fulfillment mode/context when it changes the quoted price
currency
```

Price changes must compare observations measured under the same declared context. A different store/geographic market must not silently become a `PRICE_CHANGED` event.

This is a reopen requirement, not a new schema project in the current source-review phase.

## What can reopen Home Depot engineering

Reopen technical Home Depot source work only after one of these exists:

1. express written Home Depot permission for PriceIntel's intended automated competitor-price use;
2. a separate supplier/partner agreement and verified interface whose permitted use covers the specific PriceIntel feature;
3. a licensed third-party provider whose rights explicitly cover the required Home Depot data, retention, derived analytics, and customer use.

A proxy, CAPTCHA solver, browser routine, reverse-engineered endpoint, Supplier Hub login, EDI capability, or vendor claiming to scrape Home Depot does not by itself establish source approval.

## Engineering stop point

Do not add:

- HomeDepot.com product-page reverse engineering;
- Home Depot browser fallback;
- proxy/CAPTCHA work;
- unofficial/internal-looking API probing;
- guessed supplier API endpoints;
- Home Depot adapters or real corpus measurement.

The next Home Depot event should be an external source-rights/interface event. Otherwise crawler engineering remains frozen.
