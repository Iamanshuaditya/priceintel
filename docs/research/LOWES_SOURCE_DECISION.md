# Lowe's Source Decision

Review date: **2026-08-21**

Operational status:

- `LOWES_PUBLIC_WEB` — **NOT_APPROVED** for PriceIntel automated public-web collection.
- `LOWES_PARTNER_CATALOG_API` — **REVIEW_REQUIRED**; verified production host exists, but do not use until the Lowe's partner agreement/license is confirmed to permit PriceIntel's intended competitor-monitoring, retention, derived analytics, and customer presentation.
- `LOWES_MARKETPLACE_SELLER_API` — **REVIEW_REQUIRED governance conclusion; runtime endpoint intentionally unregistered until the real seller API endpoint/agreement/scope is verified**.

This is an engineering/source-governance decision for PriceIntel, not legal advice.

## Public Lowes.com web source

Official terms reviewed:

- https://www.lowes.com/l/about/terms-and-conditions-of-use

The reviewed Lowe's Terms & Conditions of Use are effective July 15, 2026. They prohibit use of robots, spiders, site search/retrieval applications, or other manual/automatic processes to retrieve, index, data-mine, reproduce, or circumvent the Site or its contents. The terms also describe extracting, scraping, mining, copying, or otherwise gathering Site information as prohibited reseller activity in connection with downstream product sales.

PriceIntel's commercial competitor-price monitoring therefore does not treat Lowes.com HTML as an approved automated source under the reviewed public terms.

Runtime decision:

```text
sourceId          LOWES_PUBLIC_WEB
hostnamePatterns  lowes.com, *.lowes.com
appliesToMethods  PUBLIC_HTTP, BROWSER
status            NOT_APPROVED
permittedMethods  []
next action       MANUAL_REVIEW / approved-source investigation
```

No Lowe's product-page live fetch was added as part of this source review.

## Lowe's Partner Product Catalog API

Official developer material reviewed:

- https://developer.lowes.com/
- https://developer.lowes.com/portal/solutions/product-discovery/
- https://developer.lowes.com/portal/business-components/Product%20Catalog/

This is the first reviewed large-retailer source with a clearly documented structured partner-data path that is directly relevant to product/price intelligence.

Lowe's Developer Hub states that partners can integrate Lowe's product catalog, inventory, pricing, promotions, and order-management capabilities into third-party applications/platforms. The Product Discovery guidance explicitly describes loading catalog data into a partner system, fetching real-time pricing/availability/promotions, and rendering Lowe's product information inside the partner experience.

The Product Catalog documentation exposes a verified production API hostname:

```text
https://apis-b2b.lowes.com
```

and documents OAuth/client credentials plus product-detail/search endpoints. Product details can carry national/store-level pricing, inventory, ZIP/store context, and eligible Pro contract pricing.

That technical capability does **not** by itself establish the rights PriceIntel needs. The public material is framed around product discovery, shopping experiences, commerce/marketplace integrations, and presentation of Lowe's products to customers. The reviewed public documentation does not clearly establish that a partner may use the data for a B2B competitor-monitoring SaaS with historical retention, derived analytics, alerts, and presentation to PriceIntel customers.

Therefore the runtime registry records:

```text
sourceId          LOWES_PARTNER_CATALOG_API
hostnamePatterns  apis-b2b.lowes.com
appliesToMethods  RETAILER_API
status            REVIEW_REQUIRED
permittedMethods  []
next action       confirm partner agreement/license for PriceIntel use
```

A `RETAILER_API` evaluation for this verified host must produce `SOURCE_REVIEW_REQUIRED / MANUAL_REVIEW` until that decision is intentionally changed.

### Commercial questions required before approval

Ask Lowe's partner/integration team whether the applicable Product Catalog/API agreement permits PriceIntel to:

1. retrieve Lowe's pricing/inventory for monitored products on behalf of PriceIntel customers;
2. retain historical price observations and source evidence;
3. compute and store derived analytics, deltas, trends, and alerts;
4. present Lowe's pricing/history/derived analytics to PriceIntel SaaS customers;
5. use national and/or store-level feeds for competitor monitoring rather than solely a Lowe's shopping/checkout experience;
6. operate at the expected request/feed volume and retention period;
7. use anonymous retail pricing without sending customer identity data.

Do not enable the API until the answers and governing agreement establish the intended use.

## Lowe's Marketplace Seller API

Official seller documentation reviewed:

- https://seller.lowes.com/mirakl-seller-documentation/

Lowe's operates a curated third-party marketplace powered by Mirakl. The public seller documentation is explicitly for approved Lowe's Marketplace sellers and covers onboarding, product/offer management, orders, API settings/credentials, and programmatic use of the Mirakl API.

This is a seller-operations surface. The reviewed material does not establish that its API can retrieve arbitrary competing sellers' prices or that PriceIntel may use seller credentials as a general competitor-price data feed.

The public material reviewed here also does not establish the concrete production seller API hostname PriceIntel should govern. Therefore:

```text
LOWES_MARKETPLACE_SELLER_API
status            REVIEW_REQUIRED (research conclusion)
runtime record    absent
```

Do not guess a Mirakl/API hostname from portal URLs. If a seller-scoped PriceIntel product is pursued, verify the actual endpoint, agreement, scopes, seller authorization, accessible price fields, and permitted uses before adding a runtime source record.

## Method-aware governance requirement

Lowe's exposed a registry ambiguity that must not be solved by array ordering:

```text
LOWES_PUBLIC_WEB
  *.lowes.com
  appliesToMethods = PUBLIC_HTTP, BROWSER

LOWES_PARTNER_CATALOG_API
  apis-b2b.lowes.com
  appliesToMethods = RETAILER_API
```

The runtime registry now distinguishes policy scope (`appliesToMethods`) from authorization (`permittedMethods`). Source selection uses hostname **and access method**, and deterministic registry validation rejects overlapping hostname policies when their method scopes overlap.

This means the API hostname can correctly resolve to `LOWES_PUBLIC_WEB` for a public-web/browser attempt while resolving to `LOWES_PARTNER_CATALOG_API` for a `RETAILER_API` attempt, without relying on array order.

## Future price-context invariant

Official developer and retail material makes Lowe's price locality explicit:

- Product Catalog supports national and store-level pricing.
- Product endpoints accept store/ZIP context.
- Contract pricing may be available for eligible Pro customers using customer context.
- Lowe's Price Promise states Lowe's stores do not price-match other Lowe's stores and Lowes.com does not price-match prices across ZIP codes.

Therefore an approved future Lowe's source must not identify observations by `USD` currency alone.

Before Lowe's reliability measurement begins, define an explicit price context appropriate to the approved source, covering at least:

```text
currency = USD
scope = NATIONAL | STORE
ZIP / geographic context when applicable
storeId when store-level price is measured
channel = ONLINE | STORE
customerPricing = ANONYMOUS_RETAIL | separately-authorized PRO_CONTRACT
```

For ordinary competitor monitoring, `ANONYMOUS_RETAIL` should be the default. PriceIntel must not submit a customer email or other identity to request Pro contract pricing unless that customer explicitly authorized that use and the source agreement permits it.

Price-change comparisons must only compare observations under the same declared price context.

## Engineering stop / reopen conditions

Freeze Lowes.com crawler/browser engineering. Do not add frontend reverse engineering, proxy/CAPTCHA work, or unofficial endpoint probing.

`LOWES_PARTNER_CATALOG_API` is different: keep its **commercial/source-rights review active**, not its technical implementation.

Reopen a real Lowe's reliability corpus when one of these is established:

1. Lowe's partner approval/agreement explicitly permits the intended PriceIntel Product Catalog use;
2. another written Lowe's permission covers the monitoring/retention/analytics/customer-presentation use; or
3. a licensed provider supplies Lowe's data with rights covering the required retention, derived analytics, and customer use.

If the partner API is approved, it should become the next large-retailer structured-source reliability program: authenticated source contract -> bounded corpus -> independent decision truth -> reliability/cost baseline.
