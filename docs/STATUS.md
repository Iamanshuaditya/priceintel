# Status

## Current milestone

Phase C/D foundation — first executable crawler/domain spine.

## Completed

- Repository initialized.
- Product direction encoded in docs.
- Initial stack/crawler/security ADRs.
- Loop state and verification log established.
- Deterministic fixture commerce server.
- URL/SSRF security policy and redirect validation.
- Generic JSON-LD Product/Offer extraction.
- Normalized price observations.
- Append-only in-memory history for deterministic tests.
- Tenant ownership checks in domain store.
- Semantic price/stock change detection.
- Failure-honest listing health updates.
- First backend vertical-slice test.
- Second-slice failure-honesty test embedded in vertical suite.

## In progress

- Complete OSS/license review of all required references.
- Production persistence design.
- Durable queue/worker implementation.

## Blocked

- Full dependency-based stack verification in this execution environment: package registry access timed out and Docker is unavailable.

## Failed verification

None in the final foundation test run. Environment limitations are not marked as code failures.

## Next actions

1. Add PostgreSQL schema/migrations and ephemeral DB integration tests.
2. Add durable queue and worker with retry/backoff/idempotency.
3. Replace in-memory vertical harness with real DB + queue integration path.
4. Add API/auth/workspace boundary.
5. Add first production web UI surface showing current price + freshness.
6. Add retailer adapter contract and more fixture suites.
7. Add alerts and notification dedupe.

## Known risks

- Node native type stripping is a temporary bootstrap verification mechanism, not the final toolchain.
- DNS answer is not pinned to the socket in the current dependency-free secure fetch transport.
- No production browser strategy is implemented yet.

## Deferred intentionally

- Consumer tracker/browser extension.
- Automated repricing writes.
- Automatic product matching.
- Billing.
- AI extraction.
