# ADR-002 — Crawler Pipeline

## Status
Accepted.

## Decision
Use a cascading crawler architecture: secure URL policy -> lightweight HTTP structured extraction -> retailer adapter -> browser fallback -> alternate extraction -> optional intelligent extraction.

Extraction produces candidates. Validation/normalization decides whether an observation can be appended. A fetch/extraction failure updates health without fabricating a successful observation.

## Current implementation
Generic JSON-LD Product/Offer extraction plus secure HTTP fetch primitives and deterministic fixture tests.

## Deferred
Crawlee/Playwright runtime integration and retailer adapters until durable worker foundation is available.
