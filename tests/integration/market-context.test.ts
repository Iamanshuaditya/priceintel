import test from 'node:test';
import assert from 'node:assert/strict';
import type { Worker } from 'bullmq';
import type { PriceObservation } from '../../packages/domain/src/index.ts';
import {
  claimCrawlRun,
  countRows,
  createDatabasePool,
  loadCrawlListingConfig,
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

test('market mismatch records only crawl failure and preserves last verified state', async (t) => {
  const pool = createDatabasePool();
  const queueName = `priceintel-market-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    workspaceId:'ws_market', workspaceName:'Market Test', productId:'prod_market', sku:'SKU-MKT', title:'Market Product', currency:'USD',
    listingId:'listing_market', url:'https://example.com/original', retailer:'example.com',
    expectedCurrency:'USD', marketCountry:'US', locale:'en-US',
  });

  const config = await loadCrawlListingConfig(pool, 'ws_market', 'listing_market');
  assert.deepEqual(config, {
    workspaceId:'ws_market', listingId:'listing_market', productId:'prod_market',
    url:'https://example.com/original', expectedCurrency:'USD', marketCountry:'US', locale:'en-US',
  });

  const baselineAt = new Date('2026-08-20T12:00:00Z');
  await claimCrawlRun(pool, {
    id:'run_market_base', jobKey:'job-market-base', workspaceId:'ws_market', listingId:'listing_market',
  }, baselineAt);
  const baseline: PriceObservation = {
    id:'obs_market_base', workspaceId:'ws_market', productId:'prod_market', competitorListingId:'listing_market',
    fetchedAt:baselineAt, verifiedAt:baselineAt, currency:'USD', price:100, stockStatus:'IN_STOCK',
    sourceMethod:'JSON_LD', extractorVersion:'generic-jsonld@1.0.0', confidence:0.95, crawlRunId:'run_market_base',
  };
  assert.equal((await persistObservationAndEffects(pool, baseline)).inserted, true);

  const job = await enqueueCrawl(queue, {
    workspaceId:'ws_market', listingId:'listing_market', crawlRunId:'run_market_mismatch', jobKey:'job-market-mismatch',
  }, { attempts:1, removeOnComplete:false, removeOnFail:false });
  assert.deepEqual(Object.keys(job.data).sort(), ['crawlRunId','jobKey','listingId','workspaceId']);

  // Prove execution-time configuration comes from PostgreSQL, not the queue.
  await pool.query(
    "UPDATE competitor_listings SET url='https://example.com/authoritative' WHERE id='listing_market' AND workspace_id='ws_market'",
  );

  const fetchedUrls: string[] = [];
  const fetchHtml = async (url: string) => {
    fetchedUrls.push(url);
    return {
      html:'<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"90","priceCurrency":"CAD","availability":"https://schema.org/InStock"}}</script>',
      finalUrl:url,
      status:200,
      contentType:'text/html',
    };
  };
  worker = createCrawlWorker(buildCrawlProcessor(pool, fetchHtml), process.env.REDIS_URL, {
    queueName, concurrency:1,
  });
  await worker.waitUntilReady();
  await waitForJobState(job, 'failed');

  assert.deepEqual(fetchedUrls, ['https://example.com/authoritative']);
  assert.deepEqual(await countRows(pool), { observations:1, changes:0, outbox:0, succeeded_runs:1 });

  const observationRows = await pool.query(
    "SELECT crawl_run_id,currency,price::text FROM price_observations WHERE competitor_listing_id='listing_market' ORDER BY verified_at",
  );
  assert.deepEqual(observationRows.rows.map((row) => [row.crawl_run_id,row.currency,Number(row.price)]), [
    ['run_market_base','USD',100],
  ]);

  const listing = await pool.query(`
    SELECT current_price::text,current_currency,current_stock_status,last_successful_crawl_at,last_crawl_at,
      health,failure_count,last_failure_code,expected_currency,market_country,locale
    FROM competitor_listings WHERE id='listing_market' AND workspace_id='ws_market'
  `);
  const row = listing.rows[0];
  assert.equal(Number(row.current_price), 100);
  assert.equal(row.current_currency, 'USD');
  assert.equal(row.current_stock_status, 'IN_STOCK');
  assert.equal(new Date(row.last_successful_crawl_at).toISOString(), baselineAt.toISOString());
  assert.ok(new Date(row.last_crawl_at).getTime() > baselineAt.getTime(), 'failed attempt should advance last_crawl_at');
  assert.equal(row.health, 'NEEDS_REVIEW');
  assert.equal(Number(row.failure_count), 1);
  assert.equal(row.last_failure_code, 'MARKET_MISMATCH');
  assert.equal(row.expected_currency.trim(), 'USD');
  assert.equal(row.market_country.trim(), 'US');
  assert.equal(row.locale, 'en-US');

  const failedRun = await pool.query(
    "SELECT status,failure_code,attempt FROM crawl_runs WHERE id='run_market_mismatch' AND workspace_id='ws_market'",
  );
  assert.equal(failedRun.rows[0].status, 'FAILED');
  assert.equal(failedRun.rows[0].failure_code, 'MARKET_MISMATCH');
  assert.equal(Number(failedRun.rows[0].attempt), 1);
});
