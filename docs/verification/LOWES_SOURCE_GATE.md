# Lowe's Source Gate Verification

Date: **2026-08-21**

Status:

- `LOWES_PUBLIC_WEB` — **ACCEPTED: NOT_APPROVED / MANUAL_REVIEW**.
- `LOWES_PARTNER_CATALOG_API` — **REVIEW_REQUIRED / verified runtime host / commercial-source approval active**.
- `LOWES_MARKETPLACE_SELLER_API` — **REVIEW_REQUIRED governance conclusion; runtime endpoint intentionally unregistered until verified**.
- Method-aware source-policy selection — **ACCEPTED**.

This is an operational engineering/source-governance record, not a legal conclusion about every possible Lowe's agreement or integration.

## Method-aware governance change

Lowe's exposed a real hostname-overlap case:

```text
LOWES_PUBLIC_WEB
  lowes.com, *.lowes.com
  appliesToMethods = PUBLIC_HTTP, BROWSER

LOWES_PARTNER_CATALOG_API
  apis-b2b.lowes.com
  appliesToMethods = RETAILER_API
```

The registry now distinguishes:

- `appliesToMethods`: which policy governs a hostname + method request;
- `permittedMethods`: which governed methods are actually authorized when the source is approved.

`sourcePolicyForUrl(url, method)` selects by both dimensions. `sourcePolicyConflicts()` detects overlapping hostname patterns whose `appliesToMethods` intersect. The deterministic suite requires the production registry conflict set to remain empty, so array ordering cannot resolve source-policy ambiguity.

A synthetic regression proves `*.example.com` and `api.example.com` conflict when both govern `PUBLIC_HTTP`.

## Lowe's public-web gate

Runtime record:

```text
sourceId          LOWES_PUBLIC_WEB
hostname patterns lowes.com, *.lowes.com
appliesToMethods  PUBLIC_HTTP, BROWSER
status            NOT_APPROVED
permittedMethods  []
basis             PUBLIC_TERMS_REVIEW
evidence          docs/research/LOWES_SOURCE_DECISION.md
```

The deterministic transport regression requires a Lowes.com product URL to fail `SOURCE_NOT_APPROVED` before either DNS resolution or HTTP transport. Both counters must remain zero.

No Lowes.com live product request, browser experiment, adapter, proxy/CAPTCHA work, or frontend reverse engineering was added.

## Lowe's Partner Product Catalog API

Lowe's public Developer Hub documents the verified production hostname:

```text
https://apis-b2b.lowes.com
```

and structured product-catalog capabilities including pricing, promotions, inventory, national/store-level pricing, ZIP/store context, and eligible contract pricing.

Runtime record:

```text
sourceId          LOWES_PARTNER_CATALOG_API
hostname patterns apis-b2b.lowes.com
appliesToMethods  RETAILER_API
status            REVIEW_REQUIRED
permittedMethods  []
evidence          docs/research/LOWES_SOURCE_DECISION.md
```

The routing regression proves the same concrete API URL resolves differently by method:

```text
PUBLIC_HTTP
→ LOWES_PUBLIC_WEB
→ SOURCE_NOT_APPROVED

RETAILER_API
→ LOWES_PARTNER_CATALOG_API
→ SOURCE_REVIEW_REQUIRED
```

This result is independent of registry array order.

The API remains disabled until Lowe's partner terms/agreement explicitly support PriceIntel's intended monitoring, historical retention, derived analytics, customer presentation, and operating model.

## Lowe's Marketplace Seller API

Public Mirakl documentation establishes a curated seller marketplace and seller API/integration capability, but the reviewed source does not establish a PriceIntel-suitable competitor-price feed or the concrete runtime seller endpoint that should be registered.

The deterministic suite therefore requires:

```text
sourcePolicyForId('LOWES_MARKETPLACE_SELLER_API') === undefined
```

until the endpoint/agreement/scope/permitted use is verified.

## Price-context reopen requirement

Lowe's official partner API and retail policy make price locality/context explicit. An approved future Lowe's source must distinguish relevant dimensions rather than identifying price by USD alone:

```text
currency = USD
scope = NATIONAL | STORE
ZIP / geographic context
storeId when store-level pricing is used
channel = ONLINE | STORE
customerPricing = ANONYMOUS_RETAIL | separately-authorized PRO_CONTRACT
```

Ordinary competitor monitoring should default to anonymous retail. Customer identity/email must not be submitted for contract pricing without explicit customer authorization and source-agreement support.

Only observations with the same declared price context should be compared for price-change events.

## CI history

Initial Lowe's regression head:

- Commit: `0806cde63d09bd5d3ab4e8c9dbf54adc5d03000e`
- Hardening run: `32425778570`
- Result: **FAIL before runtime tests**.

The only failure was strict TypeScript in the synthetic ambiguity fixture: `as const` made `permittedMethods: []` readonly while `SourcePolicy` expects a mutable `SourceAccessMethod[]`. No policy behavior assertion ran or changed.

Corrected accepted implementation/test head:

- Commit: `65583fa1b8e5708f906241bef7f40f9737ba8ac6`
- Hardening run: `32425946580`
- Result: **SUCCESS**.

The fix changed only the synthetic fixture typing. The method-aware routing, conflict detection, public-web zero-network assertion, partner API `SOURCE_REVIEW_REQUIRED`, and unrouted seller-API assertions remained unchanged.

## Engineering state

Freeze Lowe's public-web crawler/browser work.

Keep `LOWES_PARTNER_CATALOG_API` active only as a commercial/source-rights dependency. If the applicable Lowe's agreement permits PriceIntel's intended use, this API should become the next large-retailer structured-source reliability program: authenticated source contract -> bounded real corpus -> independent decision truth -> reliability/cost baseline.
