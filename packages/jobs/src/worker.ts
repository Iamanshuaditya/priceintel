import type { Pool } from 'pg';
import type { Job } from 'bullmq';
import { crawlStructuredProduct, type HtmlFetcher } from '../../crawler-core/src/crawl.ts';
import { claimCrawlRun, persistObservationAndEffects, recordCrawlFailure } from '../../db/src/index.ts';
import type { CrawlJobData } from './crawl-queue.ts';

export interface ProcessorHooks {
  afterCommit?: (job: Job<CrawlJobData>, result: {inserted:boolean;changeCount:number;outboxCount:number}) => Promise<void> | void;
}

export function buildCrawlProcessor(pool: Pool, fetchHtml: HtmlFetcher, hooks: ProcessorHooks = {}) {
  return async (job: Job<CrawlJobData>) => {
    const data = job.data;
    const identity = { id:data.crawlRunId, jobKey:data.jobKey, workspaceId:data.workspaceId, listingId:data.listingId };
    const claim = await claimCrawlRun(pool, identity);
    if (claim.alreadySucceeded) return { deduplicated: true, crawlRunId: data.crawlRunId };

    let observation;
    try {
      observation = await crawlStructuredProduct({
        workspaceId:data.workspaceId, productId:data.productId, listingId:data.listingId,
        url:data.url, crawlRunId:data.crawlRunId,
      }, fetchHtml);
    } catch (error) {
      const code = (error as {code?:string}).code ?? 'CRAWL_FAILED';
      await recordCrawlFailure(pool, identity, new Date(), code, code === 'PARSE_FAILED' ? 'PARSE_FAILED' : 'DEGRADED');
      throw error;
    }

    const result = await persistObservationAndEffects(pool, observation);
    await hooks.afterCommit?.(job, result);
    return { deduplicated: !result.inserted, crawlRunId:data.crawlRunId, ...result };
  };
}
