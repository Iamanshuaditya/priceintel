# Target Source Decision

Review date: **2026-08-21**

Operational status:

- `TARGET_PUBLIC_WEB` — **NOT_APPROVED** for PriceIntel automated commercial price monitoring.
- `TARGET_PLUS_API` — **REVIEW_REQUIRED as a source-governance conclusion**, but **not yet registered as a runtime hostname policy** because the actual production API hostname and relevant scopes have not been verified from the reviewed public material.

This is an engineering/source-governance decision for PriceIntel, not legal advice.

## Target public web

Official terms reviewed:

- https://www.target.com/c/terms-conditions/-/N-4sr7l

The reviewed Target.com Terms & Conditions identify themselves as last updated **April 15, 2026**. They expressly treat interaction through crawlers, robots, browsers, data-mining/extraction tools, and similar functionality as use of the Site.

For the PriceIntel use case, the relevant restrictions include:

- commercial use of the Site or its Content, including collection/use of product listings, descriptions, prices, or images;
- downloading/copying/transmitting Content for the benefit of another merchant;
- use of automated engines/tools/agents to navigate/search outside the mechanisms Target permits;
- systematic scraping, extraction, collection, storage, or database creation from product listings, descriptions, prices, images, and other Site content.

PriceIntel therefore does not treat Target.com HTML/browser collection as an approved live competitor-price source under the reviewed public terms.

Runtime registry decision:

```text
sourceId      TARGET_PUBLIC_WEB
status        NOT_APPROVED
methods       []
basis         PUBLIC_TERMS_REVIEW
next action   MANUAL_REVIEW / approved-source investigation
```

`target.com` and its subdomains fail source authorization before DNS resolution or HTTP transport. No Target.com live crawl is required to establish this source decision.

## Target Plus seller/developer integration surface

Official public material reviewed:

- https://plus.target.com/
- https://developer-beta.target.com/
- https://plus.target.com/docs/spec/orders

Target Plus publicly describes a curated seller marketplace with application review, contracting/onboarding, seller tools, and API resources including `Sellers-v1`, `Seller_orders-v1`, and `Item Taxonomy API`.

Target's developer portal separately exposes Target Plus / external-user login, which supports the conclusion that an authenticated partner integration surface exists.

This is materially different from anonymous Target.com collection. It creates a plausible seller/partner-authorized integration path.

However, the reviewed public material does **not** establish that a Target Plus seller or integration provider may use Target APIs as a general third-party competitor-price intelligence feed. It also does not expose enough verified production endpoint/scope information to create a safe runtime URL matcher without guessing.

Therefore the governance conclusion is:

```text
sourceId      TARGET_PLUS_API
status        REVIEW_REQUIRED
method        RETAILER_API
runtime host  UNVERIFIED — intentionally not guessed
next action   verify partner agreement, exact API hostname/scopes, seller authorization, and permitted use
```

No Target Plus API request should be made by PriceIntel until those items are verified and an explicit runtime source policy is added.

## Price identity / market-context requirement

Official pricing guidance reviewed:

- https://www.target.com/help/article/000194850

Target states that online and local-store prices can differ, that pricing/promotions/availability can vary by location, and that some prices/offers may be affected by location and shopping history. Target also describes regular prices as consistent for guests shopping at the same store while allowing differences between locations because market conditions vary by store.

That means `expectedCurrency = USD` is not enough to define a Target price observation if an approved Target source becomes available later.

A Target reopen should first define a stable price context such as:

```text
currency          USD
country           US
ZIP / market      explicit
storeId           explicit when store pricing is measured
channel           ONLINE | STORE
personalization   ANONYMOUS / NON_MEMBER unless a separately approved user context is intentional
```

The exact schema can be designed when an approved source exists. The invariant is more important than the field names: two observations should not be compared as a price change unless they were measured under the same declared Target price context.

## What can reopen Target engineering

Reopen a Target technical source experiment only after one of these is established:

1. express written Target permission for PriceIntel's intended automated use;
2. a separate agreement that expressly covers the intended price-monitoring/derived-analytics use;
3. verified Target Plus partner/seller API terms, scopes, endpoint, and seller authorization that cover a specific PriceIntel feature;
4. a licensed third-party provider whose rights explicitly cover Target price data, retention, derived analytics, and customer use.

A proxy, browser automation, affiliate-style workaround, cached search result, or scraping vendor does not by itself establish source approval.

## Current engineering stop point

Do not reverse-engineer Target's frontend, add Target browser fallback, or probe unknown Target Plus API endpoints while source approval is unresolved.

The next Target work is source/partner validation. If an acceptable source emerges, add a verified runtime policy record and then begin the standard controlled source-adapter -> small corpus -> independent truth -> reliability/cost loop.
