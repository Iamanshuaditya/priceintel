# Verification Log

## 2026-08-20 — Foundation slice

Commands intended for every clean run:

```bash
npm test
npm run test:security
npm run test:vertical
npm run demo
```

Environment note: external npm registry lookup timed out and Docker is unavailable in the current execution environment, so the foundation was designed to have zero third-party runtime/test dependencies. PostgreSQL/Redis integration gates remain open rather than being faked.

## Final verifier pass for foundation commit

`npm test` -> **14/14 PASS**.

Coverage includes JSON-LD extraction/normalization, malformed data rejection, candidate disagreement rejection, private/link-local/metadata/IP-mapped-IPv6 classification, credentials/protocol/localhost rejection, private DNS result rejection, redirect-to-private rejection, tenant boundary rejection, failure honesty, duplicate observation/crawl idempotency, cross-workspace ID overwrite rejection, and a real local HTTP fixture vertical backend spine.

`npm run test:security` -> **5/5 PASS**.

`npm run test:vertical` -> **1/1 PASS**.

Verifier-found defects fixed before commit:

1. duplicate successful crawl ingestion could append duplicate history -> added observation/crawl-run idempotency;
2. IPv4-mapped IPv6 could evade naive private IPv4 detection -> canonical mapped-address handling added and regression-tested.
