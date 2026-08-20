# Open-Source Review

This is a living audit. No third-party source code has been copied into PriceIntel in the foundation slice; references are architectural only unless a later entry explicitly states otherwise.

| Repository | Initial inspection | Useful pattern | Current decision |
|---|---|---|---|
| `clucraft/PriceGhost` | Root structure and project composition | Separate frontend/backend/database concerns; price-tracking project with Dockerized boundaries | Architecture reference only; do not clone/cargo-cult |
| `apify/crawlee` | License and project references | Mature request lifecycle, queues, sessions, HTTP/browser crawler abstraction | Strong candidate for production crawler runtime once dependency-based phase begins |
| `cobusgreyling/loop-engineering` | Process/license | Bounded loops, external state, verification gates, circuit breakers | Adopt principles now via `STATUS.md` + verification log; no tool dependency required |
| `dgtlmoon/changedetection.io` | Store/model paths plus license | Mature monitoring state/store separation and change-oriented architecture | Apache-2.0 reference; deeper worker/notification review before those subsystems |
| `microsoft/playwright` | Required reference queued for browser phase | Keep production browser extraction separate from E2E abstractions | Planned browser + E2E dependency |
| `browserless/browserless` | Required reference queued for infra comparison | Remote browser/session pool option | Decision deferred to browser ADR update after workload measurements |
| `Glitchero/dataprice` | Required reference queued | B2B comparison/product matching concepts | Architecture-reference pass pending |
| `Aniket-16-S/Product-Scraper` | Required reference queued | Ecommerce async/browser patterns | Architecture-only until license confirmed |
| `ScrapingBee/walmart-scraper` | Required reference queued | Walmart-specific identification/retry/normalization ideas | Educational reference; no dependency decision |
| `kevjaeg/CompetitorPriceTracker` | README/project structure + license | Playwright scraper isolation, exponential backoff, structured logging, Prometheus metrics, health checks, CSV, alert routing, test layering | MIT; borrow patterns only. Avoid its SQLite/node-cron single-instance constraints for SaaS |

## Foundation decision

The first slice is deliberately dependency-free and original. This gives us executable evidence for core invariants before choosing Crawlee/BullMQ/ORM/UI dependencies.
