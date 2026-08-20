# Security

## Implemented now

- HTTP/HTTPS-only competitor URL policy.
- Credential-bearing URLs rejected.
- localhost and private/link-local IP literals rejected.
- DNS-resolved private/link-local destinations rejected.
- cloud metadata IP (`169.254.169.254`) rejected as part of link-local blocking.
- redirect targets revalidated before following.
- tenant-scoped monitoring store methods reject cross-workspace entity access.

## Release-blocking work still open

- production authentication/session model;
- authorization integration tests at API layer;
- database-level tenant isolation constraints;
- rate limiting;
- CSRF strategy if cookie auth is selected;
- webhook signing;
- secrets/log redaction;
- dependency scanning once dependencies land;
- CSV formula-injection controls;
- production egress/DNS-rebinding hardening.
