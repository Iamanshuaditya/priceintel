# Best Buy Source Gate Verification

Date: **2026-08-21**

Status: **ACCEPTED — SOURCE_NOT_APPROVED / MANUAL_REVIEW**

This verifies PriceIntel's operational source-governance behavior for Best Buy. It is not a legal conclusion about all possible Best Buy data uses or agreements.

## Direct production gate

Accepted commit: `30b4eae2021f320cf54056bb9c544d03bcff6f9d`

GitHub Actions run: `32420516534`

The integration path uses real PostgreSQL, Redis, BullMQ, and the production crawl processor. It proves:

```text
BestBuy.com listing
→ PostgreSQL config reload
→ source permission preflight
→ SOURCE_NOT_APPROVED
→ fetchCalls === 0
→ verified history/current state preserved
→ no change event
→ no notification outbox
→ NEEDS_REVIEW
```

The fixture begins with one verified `$199.99 USD` observation. After the denied crawl, the test requires exactly one observation total, zero change events, zero outbox rows, unchanged current `$199.99 USD`, and failure metadata only.

The immediately preceding red run was compiler-only: the new baseline observation used unsupported source provenance `FIXTURE`. The only code change was to use the already-supported `JSON_LD` source method. All behavior assertions remained unchanged.

## Per-hop transport authorization

Accepted commit: `945e0b15e5787973cf983fba64487fd074f571d7`

GitHub Actions run: `32421412905`

`secureFetch()` now accepts a generic `authorizeTarget(url)` callback. It invokes that callback before DNS resolution and transport for every initial and redirect hop.

Production worker HTTP fetches and the scheduled/manual reliability canary pass `assertAutomatedSourceAccess()` into this callback. Supplementary adapter artifacts use the same fetch path.

Accepted regressions:

1. **Direct Best Buy** — rejected before DNS and before transport.
2. **Approved origin → Best Buy redirect** — the approved origin may receive one request; the Best Buy redirect destination receives no DNS resolution and no transport call.
3. **Supplementary Shopify request → Best Buy redirect** — the initial same-origin supplementary request may occur; the Best Buy redirect destination is never contacted and the supplementary evidence records `SOURCE_NOT_APPROVED`.
4. **Approved → approved redirect** — remains functional and proves the authorization hook is not a blanket redirect blocker.

### Preserved failed verification

Run `32421300251` failed strict TypeScript before behavioral execution because the hook was initially typed as returning `void | Promise<void>`, while `assertAutomatedSourceAccess()` returns a successful source-decision object.

The hook contract was corrected to accept and ignore arbitrary successful return values (`unknown | Promise<unknown>`). Denial still occurs only by throwing. No behavioral assertion was weakened or removed.

## Accepted invariant

For crawler HTTP paths configured with the source authorizer:

```text
source permission
        +
network safety
        =
per-hop fetch authorization
```

An unapproved redirect destination cannot be contacted merely because the original URL was approved.

## Best Buy engineering freeze

The deterministic `bestbuy@1.0.0` parser remains dormant/tested capability. It is not an approved live source.

Do not add Best Buy proxy rotation, CAPTCHA solving, browser-bypass logic, alternate scraping tricks, or affiliate-account workarounds.

Reopen Best Buy engineering only when PriceIntel has an acceptable source contract such as written Best Buy permission, a suitable separate agreement, or a licensed provider whose rights explicitly cover the intended competitor-price intelligence use. At that point, create a new source contract and restart bounded corpus/truth/reliability measurement.
