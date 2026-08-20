# Security

## Implemented controls

### HTTP crawler SSRF boundary

- HTTP/HTTPS-only competitor URL policy.
- Credential-bearing URLs rejected.
- localhost/private/link-local literals rejected, including cloud metadata and IPv4-mapped IPv6 variants.
- DNS-resolved private/local destinations rejected.
- Redirect targets fully revalidated before following.
- Validated DNS answers are carried into transport; connection lookup is pinned to an approved address set.
- The actual connected peer address is verified against the approved set.
- Response-size cap prevents unbounded bootstrap buffering.

The HTTP transport model is:

`resolve -> approve IP set -> connect only to approved IP -> verify peer`

Production should still combine this application-layer policy with deployment egress controls.

### Source-permission boundary

Source permission is intentionally separate from parser capability and from SSRF safety.

`secureFetch()` accepts a generic `authorizeTarget(url)` callback. Production worker HTTP fetches and the scheduled/manual reliability canary pass `assertAutomatedSourceAccess()` into that callback.

The callback runs before DNS resolution and before transport on **every concrete HTTP hop**, not only the original listing URL:

`authorize -> resolve/SSRF-check -> pinned request -> redirect -> authorize -> resolve/SSRF-check -> pinned request`

This closes the case where an approved origin redirects to a source that PriceIntel has classified as unapproved. The approved origin may have received the first request; the denied redirect destination receives no DNS resolution and no transport call.

Supplementary adapter artifacts use the same production `HtmlFetcher`, so a supplementary request cannot bypass the source decision through a redirect either.

The worker retains a higher-level direct listing preflight as defense-in-depth. The transport callback is the lower-level invariant that protects redirects and supplementary network paths.

Best Buy is currently the first explicit failed-closed source policy: `bestbuy.com` and subdomains produce `SOURCE_NOT_APPROVED` / `MANUAL_REVIEW` pending an appropriate written/licensed source permission. This is an operational engineering policy, not a broad legal conclusion.

Accepted regressions prove:

- direct Best Buy is rejected before DNS/transport;
- approved origin -> Best Buy redirect never contacts Best Buy;
- Shopify supplementary request -> Best Buy redirect is blocked and surfaced as `SOURCE_NOT_APPROVED`;
- approved -> approved redirects remain functional.

### Tenant/auth boundary

- Passwords are salted scrypt hashes.
- Session tokens are random 32-byte secrets; only SHA-256 token hashes are persisted.
- Sessions expire and logout revokes the persisted session.
- Browser sessions use `priceintel_session` as an HttpOnly cookie with `SameSite=Lax`; `Secure` is enabled in production mode.
- Browser cookie login/register does not return the raw bearer token in JSON and the operator UI does not store the token in `localStorage`.
- Bearer sessions remain supported for explicit API/CLI use.
- Every workspace-scoped API route requires persisted workspace membership.
- Member management is owner-only.
- Integration tests prove authenticated outsiders receive `403` for another workspace.
- PostgreSQL composite workspace foreign keys provide defense-in-depth tenant isolation below the API layer.

### CSRF and auth abuse

Cookie-authenticated unsafe methods require a same-origin `Origin` header. Cross-origin authenticated writes are rejected.

Login/register attempts are rate-limited before unbounded scrypt work, reducing the ability to turn password hashing into a CPU-exhaustion endpoint.

### Crawl identity and configuration authority

Stable crawl job keys cannot be rebound to another crawl identity. Manual crawl state is persisted before enqueue so the UI follows database-backed crawl identity rather than trusting BullMQ as the business authority.

BullMQ now carries only:

- `workspaceId`;
- `listingId`;
- `crawlRunId`;
- `jobKey`.

The queue does not carry authoritative URL, product ID, currency, country, or locale. `enqueueCrawl()` reconstructs the message from the four identity fields, and the worker reloads current crawl configuration from PostgreSQL after claiming the run.

This protects against stale queued configuration and reduces the damage of queue-message tampering: Redis cannot silently redirect a valid listing crawl to another URL or market contract simply by changing non-authoritative payload fields.

### Market/currency integrity boundary

`competitor_listings` persists:

- non-null `expected_currency`;
- optional `market_country`;
- optional `locale`.

For API-created listings, expected currency defaults from the parent product unless explicitly configured.

The current production invariant is intentionally narrower than full localization control:

`candidate currency == expected_currency` is required before a candidate can become a verified observation.

The worker checks this against PostgreSQL-loaded configuration before persistence, and `persistObservationAndEffects()` repeats it while holding the listing row lock. An unexpected currency becomes `MARKET_MISMATCH` with `NEEDS_REVIEW`.

A market mismatch may update crawl-attempt/failure metadata, but it cannot create:

- a verified observation;
- a current-price/current-currency/current-stock mutation;
- a new `last_successful_crawl_at`;
- a change event;
- notification-outbox intent.

This prevents worker geography, retailer geolocation, cookies, or a changed storefront default from silently turning a USD listing into a CAD observation and then being misinterpreted as a price change.

`market_country` and `locale` currently preserve intended context but are not themselves a guarantee that every retailer request is localized. Retailer-specific localization must be implemented and verified separately; until then, the currency invariant fails closed.

The dedicated real PostgreSQL/Redis/BullMQ regression mutates a listing URL after enqueue, proves the worker fetches the new PostgreSQL URL, returns a CAD candidate for a USD contract, and confirms the historical USD observation/current state/change/outbox remain untouched while only `MARKET_MISMATCH` failure metadata advances.

### Reliability/oracle integrity

Production and live canary share `executeExtractionPipeline()`, reducing the risk that the measurement system silently uses a different extraction policy.

Decision truth distinguishes expected observations, variant abstentions, unavailable pages, and blocked states. Unsafe observations against abstention/unavailable/blocked truth are counted explicitly rather than hidden inside coverage metrics.

Browser truth-audit output is verifier evidence, not production data. Screenshots and visible page state are reviewed independently. The Shopify reliability loop preserved a case where the browser oracle itself was wrong: a focused visible-control recheck and Shopify source metadata proved Scindapsus had two live CAD prices, so truth was corrected to abstention instead of weakening production logic.

## Browser crawler security gate — still open

The operator UI and reliability verifier use Playwright, but a production browser crawler/fallback is not yet enabled.

The browser network policy can reject private/local HTTP/WebSocket destinations and service workers are disabled in verifier contexts, but browser interception is not equivalent to the raw HTTP fetcher's socket-level DNS pinning.

Before any production `page.goto(userUrl)` path, browser workers require:

- reject private/local destinations for initial and subsequent browser requests;
- revalidate redirects;
- explicit websocket and service-worker policy;
- isolated browser contexts/sessions across tenants/jobs;
- navigation/request/byte/time budgets;
- restrictive deployment-level private-network egress denial;
- hostile-page regressions attempting internal-network access.

Explicit retailer challenge pages remain `BLOCKED`; production browser fallback must not become a mechanism for bypassing access controls or anti-bot protections.

## Other open security work

- webhook signing for external notification delivery;
- secrets/log redaction review;
- dependency vulnerability/scanning policy beyond lockfile reproducibility;
- CSV/formula-injection controls if CSV export/import is added;
- evidence retention/redaction controls before storing substantial HTML/screenshots/headers;
- production proxy credential/session isolation if retailer proxies are introduced;
- retailer-specific market selection controls beyond the current fail-closed expected-currency invariant;
- durable source-governance metadata/evidence registry for multi-retailer review lifecycle.
