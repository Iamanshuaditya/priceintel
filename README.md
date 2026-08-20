# PriceIntel

PriceIntel is a B2B competitor price monitoring and price-intelligence platform foundation. The initial product is aimed at ecommerce operators and brands that need reliable competitor-price observations, historical change tracking, monitoring health, and eventually MAP/brand-protection evidence.

## Current implemented slice

This repository currently contains the first verified engineering spine:

- deterministic local ecommerce fixture server;
- hostile-URL/SSRF policy with redirect validation primitives;
- generic JSON-LD product extraction;
- normalized append-only price observations;
- monitoring health (`HEALTHY`, `DEGRADED`, `STALE`, etc.);
- semantic price/stock change detection;
- tenant-scoped in-memory monitoring store for deterministic vertical-slice tests;
- end-to-end backend-spine test proving successful crawl, history, change detection, and failure honesty.

This is **not yet the complete MVP**. PostgreSQL, the durable queue/worker, authentication, production UI, retailer-specific adapters, alerts, and evidence storage remain open work and are tracked in `docs/STATUS.md`.

## Quick verification

Requires Node.js >= 22.6 (native TypeScript type stripping is used only to keep the dependency-free foundation executable before package installation infrastructure is introduced).

```bash
npm test
npm run test:security
npm run test:vertical
```

Run the deterministic fixture server:

```bash
npm run fixture
```

Run the executable first-slice demo:

```bash
npm run demo
```

## Architecture direction

The intended production stack is a TypeScript monorepo with a web app, API, durable worker queue, PostgreSQL, Redis-backed jobs, browser/HTTP crawler strategies, and S3-compatible evidence storage. See `docs/adr/ADR-001-stack.md` and `docs/ARCHITECTURE.md`.

## Important correctness rule

A previous verified price is never silently re-labeled as fresh after a failed crawl. Failed verification updates listing health/freshness state without appending a successful observation.
