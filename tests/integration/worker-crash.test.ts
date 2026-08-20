import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  claimCrawlRun, countRows, createDatabasePool, migrate, persistObservationAndEffects, seedCatalog, truncateAll,
} from '../../packages/db/src/index.ts';
import { createCrawlQueue, createCrawlWorker, enqueueCrawl } from '../../packages/jobs/src/crawl-queue.ts';
import type { Worker } from 'bullmq';
import { buildCrawlProcessor } from '../../packages/jobs/src/worker.ts';
import type { PriceObservation } from '../../packages/domain/src/index.ts';

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

test('real worker process death after DB commit replays without duplicate observation/change/outbox', async (t) => {
  const pool = createDatabasePool();
  const queueName = `priceintel-crash-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const queue = createCrawlQueue(process.env.REDIS_URL, queueName);
  let replacement: Worker | undefined;
  t.after(async () => {
    await replacement?.close().catch(() => undefined);
    await queue.obliterate({ force:true }).catch(() => undefined);
    await queue.close();
    await pool.end();
  });

  await migrate(pool);
  await truncateAll(pool);
  await seedCatalog(pool, {
    workspaceId:'ws_crash', workspaceName:'Crash Test', productId:'prod_crash', sku:'SKU-CRASH', title:'Crash Product', currency:'USD',
    listingId:'listing_crash', url:'https://example.com/product', retailer:'example.com',
  });

  await claimCrawlRun(pool, { id:'run_base', jobKey:'job-base', workspaceId:'ws_crash', listingId:'listing_crash' });
  const baseAt = new Date('2026-08-20T04:10:00Z');
  const baseline: PriceObservation = {
    id:'obs_base', workspaceId:'ws_crash', productId:'prod_crash', competitorListingId:'listing_crash',
    fetchedAt:baseAt, verifiedAt:baseAt, currency:'USD', price:100, stockStatus:'IN_STOCK',
    sourceMethod:'JSON_LD', extractorVersion:'jsonld-v2', confidence:0.95, crawlRunId:'run_base',
  };
  assert.equal((await persistObservationAndEffects(pool, baseline)).inserted, true);

  const job = await enqueueCrawl(queue, {
    workspaceId:'ws_crash', listingId:'listing_crash', crawlRunId:'run_change', jobKey:'job-change',
  }, { attempts:1, removeOnComplete:false, removeOnFail:false });

  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', '--experimental-strip-types', 'tests/helpers/crash-worker.ts',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, QUEUE_NAME:queueName, TEST_PRICE:'90', TEST_STOCK:'in', CRASH_AFTER_COMMIT:'1' },
    stdio:['ignore','pipe','pipe'],
  });
  let childOut = '';
  let childErr = '';
  child.stdout.on('data', (chunk) => childOut += chunk.toString());
  child.stderr.on('data', (chunk) => childErr += chunk.toString());
  const childExit = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`crash worker did not exit within timeout\nstdout=${childOut}\nstderr=${childErr}`));
    }, 10_000);
    timer.unref();
  });
  const [code] = await Promise.race([childExit, timeout]);
  assert.equal(code, 23, `child did not die at intended point\nstdout=${childOut}\nstderr=${childErr}`);
  assert.match(childErr, /SIMULATED_PROCESS_DEATH_AFTER_COMMIT/);

  const replacementFetch = async () => ({
    html:'<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"90","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>',
  });
  replacement = createCrawlWorker(buildCrawlProcessor(pool, replacementFetch), process.env.REDIS_URL, {
    queueName, concurrency:1, lockDuration:1000, stalledInterval:500, maxStalledCount:2,
  });
  await replacement.waitUntilReady();
  await waitForJobState(job, 'completed');

  assert.deepEqual(await countRows(pool), { observations:2, changes:1, outbox:1, succeeded_runs:2 });
  const run = await pool.query("SELECT status, attempt FROM crawl_runs WHERE id='run_change'");
  assert.equal(run.rows[0].status, 'SUCCEEDED');
  assert.ok(Number(run.rows[0].attempt) >= 2, `expected replay claim, got attempt=${run.rows[0].attempt}`);
  const change = await pool.query("SELECT type, previous_value, current_value FROM change_events WHERE observation_id='obs_run_change'");
  assert.equal(change.rowCount, 1);
  assert.equal(change.rows[0].type, 'PRICE_CHANGED');
});
