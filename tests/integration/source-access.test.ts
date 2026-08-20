import test from 'node:test';
import assert from 'node:assert/strict';
import type { Worker } from 'bullmq';
import type { PriceObservation } from '../../packages/domain/src/index.ts';
import {
  claimCrawlRun,
  countRows,
  createDatabasePool,
  migrate,
  persistObservationAndEffects,
  seedCatalog,
  truncateAll,
} from '../../packages/db/src/index.ts';
import { createCrawlQueue, createCrawlWorker, enqueueCrawl } from '../../packages/jobs/src/crawl-queue.ts';
import { buildCrawlProcessor } from '../../packages/jobs/src/worker.ts';

async function waitForJobState(job: { getState(): Promise<string> }, wanted: string, timeoutMs = 12_000) {
  const started = Date.now();
  let last = 'unknown';
  while (Date.now() - started < timeoutMs) {
    last = await job.getState();
    if (last === wanted) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`job did not reach ${wanted}; last state=${last}`);
}

test('unapproved Best Buy source fails before network access and preserves verified state', async (t) => {
  const pool = createDatabasePool();
  const queueName = `priceintel-source-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const queue = createCrawlQueue(process.env.REDIS_URL, queueName);
  let worker: Worker | undefined;
  t.after(async () => {
    await worker?.close().catch(() => undefined);
    await queue.obliterate({ force:true }).catch(() => undefined);
    await queue.close();
    await pool.end();
  });

  await migrate(pool);
  await truncateAll(pool);
  await seedCatalog(pool, {
    workspaceId:'ws_source', workspaceName:'Source Test', productId:'prod_source', sku:'SKU-SOURCE', title:'Source Product', currency:'USD',
    listingId:'listing_source',
    url:'https://www.bestbuy.com/site/example-product/1234567.p',
    retailer:'Best Buy', expectedCurrency:'USD', marketCountry:'US', locale:'en-US',
  });

  const baselineAt = new Date('2026-08-20T13:00:00Z');
  await claimCrawlRun(pool, {
    id:'run_source_base', jobKey:'job-source-base', workspaceId:'ws_source', listingId:'listing_source',
  }, baselineAt);
  const baseline: PriceObservation = {
    id:'obs_source_base', workspaceId:'ws_source', productId:'prod_source', competitorListingId:'listing_source',
    fetchedAt:baselineAt, verifiedAt:baselineAt, currency:'USD', price:199.99, stockStatus:'IN_STOCK',
    sourceMethod:'JSON_LD', extractorVersion:'fixture-v1', confidence:1, crawlRunId:'run_source_base',
  };
  assert.equal((await persistObservationAndEffects(pool, baseline)).inserted, true);

  const job = await enqueueCrawl(queue, {
    workspaceId:'ws_source', listingId:'listing_source', crawlRunId:'run_source_denied', jobKey:'job-source-denied',
  }, { attempts:1, removeOnComplete:false, removeOnFail:false });

  let fetchCalls = 0;
  const fetchHtml = async () => {
    fetchCalls += 1;
    throw new Error('network fetch must never be reached for unapproved source');
  };
  worker = createCrawlWorker(buildCrawlProcessor(pool, fetchHtml), process.env.REDIS_URL, {
    queueName, concurrency:1,
  });
  await worker.waitUntilReady();
  await waitForJobState(job, 'failed');

  assert.equal(fetchCalls, 0, 'source policy must run before HTTP transport');
  assert.deepEqual(await countRows(pool), { observations:1, changes:0, outbox:0, succeeded_runs:1 });

  const listing = await pool.query(`
    SELECT current_price::text,current_currency,current_stock_status,last_successful_crawl_at,last_crawl_at,
      health,failure_count,last_failure_code
    FROM competitor_listings WHERE id='listing_source' AND workspace_id='ws_source'
  `);
  const row = listing.rows[0];
  assert.equal(Number(row.current_price), 199.99);
  assert.equal(row.current_currency, 'USD');
  assert.equal(row.current_stock_status, 'IN_STOCK');
  assert.equal(new Date(row.last_successful_crawl_at).toISOString(), baselineAt.toISOString());
  assert.ok(new Date(row.last_crawl_at).getTime() > baselineAt.getTime());
  assert.equal(row.health, 'NEEDS_REVIEW');
  assert.equal(Number(row.failure_count), 1);
  assert.equal(row.last_failure_code, 'SOURCE_NOT_APPROVED');

  const failedRun = await pool.query(
    "SELECT status,failure_code,attempt FROM crawl_runs WHERE id='run_source_denied' AND workspace_id='ws_source'",
  );
  assert.equal(failedRun.rows[0].status, 'FAILED');
  assert.equal(failedRun.rows[0].failure_code, 'SOURCE_NOT_APPROVED');
  assert.equal(Number(failedRun.rows[0].attempt), 1);
});
