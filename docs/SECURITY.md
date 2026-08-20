# Security

## Implemented now

- HTTP/HTTPS-only competitor URL policy.
- Credential-bearing URLs rejected.
- localhost and private/link-local IP literals rejected.
- DNS-resolved private/link-local destinations rejected.
- cloud metadata IP (`169.254.169.254`) rejected as part of link-local blocking.
- IPv4-mapped IPv6 private/local addresses rejected.
- redirect targets revalidated before following.
- validated DNS answers are passed into the connection transport rather than resolving the hostname again during socket creation.
- Node transport pins socket lookup to an approved address and verifies the actual connected peer address against the approved set.
- response-size limit prevents unbounded body buffering in the bootstrap transport.
- deterministic domain store rejects cross-workspace entity access.
- PostgreSQL composite workspace foreign keys reject cross-tenant product/listing/observation wiring.
- stable crawl job keys cannot be rebound to a different crawl identity.

## DNS rebinding model

The transport boundary is `resolve -> approve IP set -> connect only to approved IP -> verify peer`. The URL hostname remains the TLS SNI/Host identity, but it is not allowed to trigger a second unconstrained DNS lookup at connection time. Redirects repeat the full validation process.

Production deployment should still combine application-layer controls with egress/network policy where available.

## Release-blocking work still open

- production authentication/session model;
- API authorization integration tests for owner/member boundaries;
- network egress policy in deployment infrastructure;
- rate limiting;
- CSRF strategy if cookie auth is selected;
- webhook signing for external deliveries;
- secrets/log redaction;
- dependency scanning and lockfile policy;
- CSV formula-injection controls;
- browser-worker SSRF/session isolation equivalent to the HTTP transport policy.
