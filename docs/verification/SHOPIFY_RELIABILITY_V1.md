# Shopify Reliability v1 — Accepted Measured Baseline

## Scope

This document freezes the accepted Shopify reliability v1 baseline for PriceIntel.

The scope is exactly:

- **20 fixed product URLs**;
- **5 Shopify-backed stores**;
- independently reviewed decision truth;
- `shopify@1.3.0` production extraction behavior;
- lightweight HTTP/supplementary extraction through PriceIntel's hardened transport;
- decision correctness, not merely parser coverage.

This document does **not** support the statement “PriceIntel is 100% accurate on Shopify.” It records a 100% decision score on this measured corpus only.

## Truth model

The corrected frozen truth set contains:

- expected observations: **15**;
- expected variant-ambiguity abstentions: **4**;
- expected unavailable pages: **1**;
- expected blocked pages: **0**.

Truth was established from browser screenshots, visible page state, bounded targeted variant interaction, retailer source metadata where needed, and verifier review. Browser-extracted snippets were supporting evidence only and never became production observations.

## Corrected Shopify 1.2 replay

The replay deliberately measured pre-fix extraction code at:

`a050bcf1d3f1140016046fb404bc1deae9132f02`

while overlaying the later corrected truth file. This preserves a comparable before score without rewriting historical code.

Evidence:

- GitHub Actions run: `32395534870`;
- artifact ID: `9416480111`;
- artifact SHA-256: `bdcb3030b4b77407d6f1a866afc690f0c0ab7d90a0de08c3d1903ad2a0a44ec3`.

Result:

| Metric | Shopify 1.2 |
|---|---:|
| Expected observations | 15 |
| Produced observations | 14/15 (93.3%) |
| Correct produced prices | 14/14 (100%) |
| Expected abstentions | 4 |
| Correct abstentions | 4/4 (100%) |
| Expected unavailable | 1 |
| Correct unavailable | 1/1 |
| Wrong expected-observation prices | 0 |
| Unsafe unexpected observations | 0 |
| False price observations | 0 |
| False abstentions | 1 |
| Overall decision accuracy | **95%** |

The sole miss was **Mollyjogger Stag Matches**. The live/default `$10` variant was observable while the differently priced alternate was sold out; Shopify 1.2 treated the historical/unavailable variation as product-level ambiguity and abstained.

## Shopify 1.3 accepted score

`shopify@1.3.0` changed only the measured availability issue:

- when complete availability evidence exists, unavailable variants may be excluded from product-level price ambiguity;
- differently priced currently available/relevant variants still require abstention;
- incomplete availability evidence remains conservative;
- explicit `?variant=` URLs retain variant-specific semantics.

Evidence:

- GitHub Actions run: `32395507110`;
- artifact ID: `9416476817`;
- artifact SHA-256: `cf9dbc2a88f200ea1ecc04a5be6f85f380022bb7e7f214c2f097bac25573291d`.

Result:

| Metric | Shopify 1.3 |
|---|---:|
| Expected observations | 15 |
| Produced observations | 15/15 |
| Correct prices | 15/15 (100%) |
| Expected abstentions | 4 |
| Correct abstentions | 4/4 (100%) |
| Expected unavailable | 1 |
| Correct unavailable | 1/1 |
| Wrong expected-observation prices | 0 |
| Unsafe unexpected observations | 0 |
| False price observations | 0 |
| False abstentions | 0 |
| Overall decision accuracy | **100%** |

Accepted claim:

> On the frozen 20-URL / 5-store Shopify corpus with independently reviewed decision truth, `shopify@1.3.0` achieved 100% decision accuracy: 15/15 expected observations correctly priced, 4/4 variant ambiguities correctly abstained, and 1/1 unavailable page correctly classified, with zero false price observations and zero false abstentions.

## Oracle correction — Scindapsus

The reliability process itself was tested by an incorrect truth label.

An earlier verifier interaction suggested the Miss Boon Scindapsus 6-inch variant could not be activated, so truth was initially labeled as one CAD 14.95 observation.

Independent evidence later contradicted that label:

1. source diagnostic run `32394981279`, artifact `9416281097`, SHA-256 `cd27d02fe5b692fbe4223be963c7613d1cb325a45bf38edbba71a022bb8495cf` reported both CAD 14.95 and CAD 26.95 variants available;
2. focused visible-control browser recheck run `32395208368`, artifact `9416381316`, SHA-256 `29b2c20c50df56f9484d3981720f4a62825a3bb8a89b6a61b0ca68c84d2a274d` clicked the actual visible 6-inch label, switched to the corresponding variant URL, and visibly changed the price from CAD 14.95 to CAD 26.95.

Truth was corrected to:

`ABSTAIN_VARIANT_AMBIGUITY [14.95, 26.95] CAD`

The production adapter was **not** modified to satisfy the earlier incorrect oracle. Both Shopify 1.2 and 1.3 correctly abstain on Scindapsus under the corrected truth.

## Other failures that shaped v1

### Fish Knife unsafe low price

A low-confidence/OpenGraph path previously allowed a product-level `$14.98` candidate even though the product had live configurations at `$14.98` and `$28.50`.

The accepted behavior is abstention. OpenGraph price is not sufficient standalone evidence for a Shopify product observation.

### Challenge-classification false positive

The first 20-URL report incorrectly classified most normal product pages as blocked because anti-bot strings inside JavaScript were scanned as visible challenge content.

Challenge classification was fixed to use explicit HTTP/final-URL/visible-document state before the corpus result was accepted.

### Verifier timeout

An early variant-probe verifier interacted with too many controls on every live page and exhausted its 25-minute GitHub Actions timeout.

The verifier was redesigned instead of increasing the timeout:

- variant probing became opt-in;
- only truth-dependent ambiguous entries were probed;
- per-entry probe caps were added;
- a global probe ceiling was added;
- per-probe time was bounded;
- the whole audit had its own deadline.

The bounded verifier then completed in roughly a minute rather than consuming the workflow timeout.

## Shared production/measurement path

Production crawling and the reliability canary use the same `executeExtractionPipeline()`.

The canary does not independently decide when to use supplementary evidence or how to select candidates. It observes the same primary/supplementary extraction orchestration used by production.

This is an acceptance requirement: **the measurement system must not become a second crawler implementation.**

## Market-context production safety

Shopify v1 also requires the listing market contract introduced by migration 004:

- non-null `expected_currency`;
- optional `market_country`;
- optional `locale`.

BullMQ carries identity only. The worker reloads current URL/product/market configuration from PostgreSQL before crawling.

If the extracted currency does not match the listing's expected currency:

`MARKET_MISMATCH -> NEEDS_REVIEW`

and the system creates no observation, current-state mutation, change event, or notification intent.

Hardening run `32419254812` on commit `bcefe669fc712cc563222d8c229705b6c6b28cff` passed the dedicated real PostgreSQL/Redis/BullMQ regression proving these semantics.

`market_country` and `locale` store intended market context but do not yet imply generic active localization across every retailer. Until retailer-specific localization is verified, expected currency is the fail-closed invariant.

## Closure

Shopify reliability v1 is **accepted and frozen**.

The following temporary evidence-generation machinery was removed after acceptance:

- one-shot Shopify corpus workflow;
- one-shot corrected-baseline replay workflow;
- one-shot source diagnostic workflow;
- one-shot truth/recheck workflow;
- retailer-specific Scindapsus and Gymshark diagnostic scripts.

Reusable reliability infrastructure remains:

- adapter registry and deterministic tests;
- shared extraction pipeline;
- scheduled/manual live canary;
- decision-aware truth and reporting;
- bounded generic browser truth-audit tool;
- frozen corpus/truth data.

Do not continue polishing Shopify unless a production regression or an intentional corpus-expansion program reopens this baseline.

## Next source class

The next reliability program is **Best Buy structured/API source reliability**.

The first gate is source acceptability, not parser code. PriceIntel should not rely on a source whose terms do not permit the intended third-party pricing-analysis use. Until a suitable source/agreement exists, the Best Buy public API path remains `MANUAL_REVIEW` rather than a production integration.
