# ADR-001 — Stack Direction

## Status
Accepted for direction; dependency selection staged.

## Decision
Use a TypeScript monorepo. Production target: web application + API, PostgreSQL persistence, durable queue/worker, HTTP-first crawler with Playwright/Crawlee browser capability where justified, S3-compatible evidence storage, structured logs/metrics, deterministic fixtures, and Playwright E2E.

For the zero-dependency foundation, Node 22 native TypeScript stripping executes pure domain/crawler modules and tests. This is intentionally temporary so core invariants can be verified in an environment without registry or Docker access.

## Why
The system needs shared domain contracts across API, workers and tests, while crawler execution must remain operationally isolated from UI concerns.

## Revisit
Adopt a conventional compiler/test toolchain as soon as registry access is available; native type stripping is not the production build strategy.
