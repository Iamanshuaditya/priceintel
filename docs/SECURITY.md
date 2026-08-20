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

### Crawl identity

Stable crawl job keys cannot be rebound to another crawl identity. Manual crawl state is persisted before enqueue so the UI follows database-backed crawl identity rather than trusting BullMQ as the business authority.

## Browser crawler security gate — still open

The operator UI uses Playwright only in deterministic E2E. A production browser crawler/fallback is not yet enabled.

Before any production `page.goto(userUrl)` path, the browser worker needs a separate network policy because page scripts, images, iframes, XHR/fetch, redirects, websockets, and service-worker activity create network surfaces not covered by the HTTP fetcher’s pinned-socket boundary.

Release-blocking requirements for browser crawling:

- reject private/local destinations for the initial navigation;
- intercept subsequent browser-originated requests and reject private/local destinations;
- revalidate redirects;
- define websocket and service-worker policy;
- isolate browser contexts/sessions across tenants/jobs;
- cap navigation/resource budgets;
- combine application controls with restrictive deployment egress where possible;
- regression-test hostile pages attempting internal-network requests.

## Other open security work

- webhook signing for external notification delivery;
- secrets/log redaction review;
- dependency vulnerability/scanning policy beyond lockfile reproducibility;
- CSV/formula-injection controls if CSV export/import is added;
- evidence retention/redaction controls before storing substantial HTML/screenshots/headers;
- production proxy credential/session isolation if retailer proxies are introduced.
