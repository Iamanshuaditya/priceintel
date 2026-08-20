# Best Buy Source Decision

Review date: **2026-08-21**

Status: **SOURCE_NOT_APPROVED / MANUAL_REVIEW — engineering frozen pending approved source**

This is an engineering/source-governance decision for PriceIntel, not legal advice. It records why the current code fails closed before automated Best Buy network access until an appropriate written/licensed source permission exists.

## Technical capability is not the blocker

Best Buy's public Developer Products API is technically attractive for price intelligence. Best Buy describes it as exposing catalog information including pricing and availability, with most product information—including pricing—updated near real time.

Official API overview:

- https://developer.bestbuy.com/apis

PriceIntel also has a deterministic `bestbuy@1.0.0` HTML parser fixture capable of reading structured price metadata. That parser capability is retained as dormant/tested capability.

Neither fact establishes permission to use those sources for PriceIntel's intended commercial third-party competitor-price analysis.

## Public Developer API terms

Official terms:

- https://developer.bestbuy.com/legal

The reviewed public API terms state that the Service/Content may not be used on behalf of or for the benefit of a third party, including other retailers, for analyzing/reviewing Best Buy pricing, products, or services.

That is directly relevant to PriceIntel's intended competitor-price intelligence use. Therefore the public Developer API is **not classified `APPROVED_API`** for this product under the currently published public terms.

A separate signed agreement or written permission that actually covers the intended use could change this decision.

## BestBuy.com website terms

Official site terms:

- https://www.bestbuy.com/site/help-topics/terms-and-conditions/pcmcat204400050067.c?id=pcmcat204400050067

The version reviewed is identified by Best Buy as last updated October 1, 2025. It restricts copying/scraping site Content and restricts automated engines/tools/agents used to navigate or search Best Buy Properties other than Best Buy-provided search agents and generally publicly available browsers.

PriceIntel therefore does not treat ordinary automated BestBuy.com HTTP/browser crawling as the fallback when the public API is commercially unsuitable.

## Affiliate / Creator route

Official affiliate/creator pages:

- https://www.bestbuy.com/site/misc/best-buy-affiliate-program/pcmcat198500050002.c?id=pcmcat198500050002
- https://www.bestbuy.com/site/best-buy-affiliate-program/affiliate-terms-and-conditions/pcmcat748302046001.c?id=pcmcat748302046001
- https://www.bestbuy.com/site/best-buy-affiliate-program/creator-terms-and-conditions/pcmcat1741014869361.c?id=pcmcat1741014869361

The affiliate/creator program is oriented around approved referral links and commissions. The reviewed terms do not establish a general license for competitor-price monitoring. They also state that scraping/spidering a Best Buy Property requires prior written approval; the Creator terms incorporate the Best Buy API Terms for Best Buy-provided content.

Therefore joining the affiliate/creator program alone would **not** move PriceIntel's source state to approved.

## Partner portal / vendor data

Best Buy's Partner Portal Product Data Management tooling is designed for vendors/partners to submit item/content data to Best Buy. It is not an anonymous competitor-price feed for PriceIntel.

Official overview:

- https://partners.bestbuy.com/applications/pdm-user-guide-overview

This route is not currently a suitable source for the monitoring product.

## Enforced code policy

PriceIntel separates parser capability from source permission through `evaluateAutomatedSourceAccess()` / `assertAutomatedSourceAccess()`.

For `bestbuy.com` and subdomains the default operational decision is:

```text
allowed       false
code          SOURCE_NOT_APPROVED
next action   MANUAL_REVIEW
```

Production workers load the current listing configuration from PostgreSQL and perform a direct source preflight before crawl execution. In addition, the production HTTP transport now receives `assertAutomatedSourceAccess` as a generic per-hop authorization callback.

`secureFetch()` invokes the callback **before DNS resolution and before transport for every concrete network hop**:

```text
initial URL
→ source authorization
→ DNS / SSRF validation
→ pinned request

redirect URL
→ source authorization
→ DNS / SSRF validation
→ pinned request
```

Supplementary adapter artifacts use the same production `HtmlFetcher`, so redirects from supplementary requests cross the same permission boundary.

The scheduled/manual reliability canary passes the same authorization callback into `secureFetch()`. Its higher-level initial preflight remains defense-in-depth; live measurement cannot use a redirect to bypass the source decision.

## Accepted verification

### Direct Best Buy zero-network gate

Commit `30b4eae2021f320cf54056bb9c544d03bcff6f9d` passed the full hardening gate in GitHub Actions run `32420516534`.

The Postgres/Redis/BullMQ integration regression proves:

```text
BestBuy.com listing
→ PostgreSQL config reload
→ source permission preflight
→ SOURCE_NOT_APPROVED
→ HTTP fetch calls = 0
→ historical verified observation preserved
→ no change event
→ no outbox
→ NEEDS_REVIEW
```

It explicitly asserts one retained `$199.99 USD` observation, zero changes/outbox, unchanged verified current state, `SOURCE_NOT_APPROVED`, and zero fetcher calls.

The immediately preceding red run was compiler-only: the new baseline fixture used unsupported provenance `FIXTURE`. The only fix was changing that fixture to the existing valid `JSON_LD` source method; the behavioral assertions were unchanged.

### Per-hop redirect/supplement authorization

Commit `945e0b15e5787973cf983fba64487fd074f571d7` passed the full hardening gate in GitHub Actions run `32421412905`.

The transport regressions prove:

1. direct Best Buy is denied before both DNS and transport;
2. an approved URL may issue its first request, but a redirect to Best Buy is denied before Best Buy DNS/transport;
3. a Shopify supplementary request that redirects to Best Buy records `SOURCE_NOT_APPROVED` and never contacts the Best Buy destination;
4. approved-to-approved redirects continue normally.

An intermediate hardening run `32421300251` failed strict TypeScript because the generic target-authorizer callback was initially typed to return only `void`, while `assertAutomatedSourceAccess()` returns its successful decision object. The callback contract was corrected to ignore arbitrary successful return values; no behavioral assertion changed.

## Failure semantics

A direct Best Buy production attempt therefore produces:

```text
network request          NO
new observation          NO
history/current mutation NO
change event             NO
notification intent      NO

last crawl attempt       YES
failure code             SOURCE_NOT_APPROVED
health                   NEEDS_REVIEW
```

A redirect from an otherwise approved source may have already contacted the approved origin, but the unapproved redirect destination receives **no DNS resolution or transport request** after the source callback rejects it.

Deterministic Best Buy adapter fixtures remain useful for parser development and for a future explicitly approved source contract; they are not permission to run the adapter against the live retailer.

## What would unblock Best Buy

Any production Best Buy reliability program now needs one of these before live automated source measurement:

1. written Best Buy permission / a separate agreement covering PriceIntel's intended price-analysis use;
2. an approved/licensed Best Buy data arrangement whose license explicitly permits this use;
3. a third-party commercial data source whose own rights/license cover redistribution/use for competitor-price intelligence and whose provenance/reliability can be verified.

A proxy, browser, CAPTCHA-solving service, search-result cache, affiliate account, or scraping vendor does **not** by itself solve source permission.

For a third-party provider, "sells Best Buy data" is insufficient. Source acceptance must verify the provider's rights for the intended competitor-monitoring/derived-analytics use and any redistribution or retention needed by PriceIntel.

## Frozen engineering boundary

Best Buy engineering is now intentionally frozen until an acceptable source exists.

Do not add:

- proxy rotation;
- CAPTCHA solving;
- browser fallback intended to bypass source restrictions;
- alternate scraping tricks;
- affiliate-account workarounds.

The next Best Buy work is commercial/source research. Once an acceptable source exists, add it as a new explicit source contract, record the permission basis/evidence, then reopen deterministic source tests and a bounded Best Buy truth corpus.

A future generalized source registry should carry governance metadata such as status, permission basis, review date, evidence reference, and review/expiry date. That is a cross-retailer governance improvement, not a reason to continue Best Buy crawler engineering now.
