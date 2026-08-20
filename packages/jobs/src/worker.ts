import type { Pool } from 'pg';
import type { Job } from 'bullmq';
import { crawlStructuredProduct, type HtmlFetcher } from '../../crawler-core/src/crawl.ts';
import { assertAutomatedSourceAccess } from '../../crawler-core/src/source-access-policy.ts';
import {
  claimCrawlRun,
  loadCrawlListingConfig,
  persistObservationAndEffects,
  recordCrawlFailure,
} from '../../db/src/index.ts';
import type { CrawlJobData } from './crawl-queue.ts';

export interface ProcessorHooks {
  afterCommit?: (job: Job<CrawlJobData>, result: {inserted:boolean;changeCount:number;outboxCount:number}) => Promise<void> | void;
}

function failureHealth(code: string) {
  if (code === 'MARKET_MISMATCH' || code === 'SOURCE_NOT_APPROVED' || code === 'SOURCE_REVIEW_REQUIRED') return 'NEEDS_REVIEW' as const;
  if (code === 'PARSE_FAILED' || code === 'CANDIDATE_DISAGREEMENT') return 'PARSE_FAILED' as const;
  return 'DEGRADED' as const;
}

export function buildCrawlProcessor(pool: Pool, fetchHtml: HtmlFetcher, hooks: ProcessorHooks = {}) {
  return async (job: Job<CrawlJobData>) => {
    const data = job.data;
    const identity = { id:data.crawlRunId, jobKey:data.jobKey, workspaceId:data.workspaceId, listingId:data.listingId };
    const claim = await claimCrawlRun(pool, identity);
    if (claim.alreadySucceeded) return { deduplicated: true, crawlRunId: data.crawlRunId };

    try {
      // BullMQ carries only durable crawl identity. PostgreSQL is authoritative for
      // the product/listing URL and market contract at the moment the worker runs.
      const listing = await loadCrawlListingConfig(pool, data.workspaceId, data.listingId);

      // Parser capability is not source permission. Fail closed before network
      // access when the current operational source policy requires approval.
      assertAutomatedSourceAccess(listing.url);

      const observation = await crawlStructuredProduct({
        workspaceId:data.workspaceId,
        productId:listing.productId,
        listingId:data.listingId,
        url:listing.url,
        crawlRunId:data.crawlRunId,
      }, fetchHtml);

      if (observation.currency.toUpperCase() !== listing.expectedCurrency) {
        throw Object.assign(
          new Error(`Observed currency ${observation.currency} does not match expected ${listing.expectedCurrency}`),
          { code:'MARKET_MISMATCH' },
        );
      }

      // persistObservationAndEffects repeats the currency invariant under the
      // listing row lock so alternate callers cannot bypass this worker guard.
      const result = await persistObservationAndEffects(pool, observation);
      await hooks.afterCommit?.(job, result);
      return { deduplicated: !result.inserted, crawlRunId:data.crawlRunId, ...result };
    } catch (error) {
      const code = (error as {code?:string}).code ?? 'CRAWL_FAILED';
      await recordCrawlFailure(pool, identity, new Date(), code, failureHealth(code));
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`${code}: ${message}`, { cause:error }), { code });
    }
  };
}
