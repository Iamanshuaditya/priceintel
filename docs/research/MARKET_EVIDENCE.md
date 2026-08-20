# Market Evidence — Engineering Summary

The supplied build brief establishes the product thesis: do not begin with another consumer price tracker. The initial system is a US-first B2B competitor price monitoring and price-intelligence platform, with MAP/brand-protection as a high-value expansion.

Engineering implications:

- reliability and monitoring operations are product features, not internal details;
- historical observations must be retained rather than overwritten by current state;
- stale/failed verification must be visible and truthful;
- manual competitor URL mapping is acceptable for the MVP;
- generic extraction should use multiple signals/candidates and retailer adapters should be isolated;
- durable scheduling, retry classification, per-domain controls, health metrics, and alert dedupe matter more than consumer-oriented SEO/history features;
- user-supplied URLs make SSRF a release-blocking threat;
- the first proof should be a vertical path from workspace/product/listing through crawl, normalized observation, history, change detection and UI, followed by a deliberate failure scenario.
