# Threat Model

## Asset / boundary

PriceIntel accepts arbitrary competitor URLs and therefore exposes server-side fetching infrastructure to untrusted input.

## Primary threats in foundation

### SSRF

Threat: attacker submits local, RFC1918, link-local, metadata, IPv6-local, credential-bearing, or redirecting URLs.

Controls: parse and scheme validation, literal-IP classification, DNS-result classification, redirect-by-redirect validation, no `file:`/`ftp:` support.

Residual risk: DNS rebinding between validation and connection remains possible without address-pinned transport or network egress enforcement. This is documented rather than hidden.

### Cross-tenant access

Threat: workspace A references product/listing IDs belonging to workspace B.

Control in deterministic domain store: every entity lookup asserts workspace ownership. Production DB/API layers must repeat this boundary and test it independently.

### Stale-data deception

Threat: failed fetch leaves old price shown as newly verified.

Control: successful observation persistence and last-success timestamp updates are separate from crawl-attempt/failure updates.
