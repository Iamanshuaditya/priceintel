# Best Buy Source Decision

Review date: **2026-08-21**

Status: **SOURCE_NOT_APPROVED / MANUAL_REVIEW**

This is an engineering/source-governance decision for PriceIntel, not legal advice. It records why the current code must fail closed before automated Best Buy network access until an appropriate written/licensed source permission exists.

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

PriceIntel therefore must not treat ordinary automated BestBuy.com HTTP/browser crawling as the fallback when the public API is commercially unsuitable.

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

PriceIntel now separates parser capability from source permission through `evaluateAutomatedSourceAccess()` / `assertAutomatedSourceAccess()`.

For `bestbuy.com` and subdomains the default operational decision is:

```text
allowed       false
code          SOURCE_NOT_APPROVED
next action   MANUAL_REVIEW
```

Production workers evaluate this policy **after loading the current listing from PostgreSQL but before any HTTP fetch**.

A Best Buy attempt therefore produces:

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

The scheduled/manual reliability canary applies the same preflight before live fetch, so measurement does not continue accessing an unapproved source merely because a deterministic parser exists.

Deterministic Best Buy adapter fixtures remain useful for parser development and for a future explicitly approved source contract; they are not permission to run the adapter against the live retailer.

## What would unblock Best Buy

Any production Best Buy reliability program now needs one of these before live automated source measurement:

1. written Best Buy permission / a separate agreement covering PriceIntel's intended price-analysis use;
2. an approved/licensed Best Buy data arrangement whose license explicitly permits this use;
3. a third-party commercial data source whose own rights/license cover redistribution/use for competitor-price intelligence and whose provenance/reliability can be verified.

A proxy, browser, CAPTCHA-solving service, search-result cache, or scraping vendor does **not** by itself solve source permission.

## Next engineering action

Until an approved source exists, Best Buy reliability should measure the source state itself:

- production attempt classification: `SOURCE_NOT_APPROVED`;
- next action: `MANUAL_REVIEW` / commercial-source or written-permission investigation;
- deterministic parser tests: remain green but dormant;
- live BestBuy.com canary fetches: disabled by source policy.

Once an acceptable source exists, create a new explicit source contract and reopen the Best Buy corpus measurement loop without weakening this gate.
