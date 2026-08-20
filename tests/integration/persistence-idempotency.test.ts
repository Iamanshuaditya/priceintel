import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimCrawlRun, countRows, createDatabasePool, migrate, persistObservationAndEffects, recordCrawlFailure, seedCatalog, truncateAll,
} from '../../packages/db/src/index.ts';
import type { PriceObservation } from '../../packages/domain/src/index.ts';

function observation(input: {
  id:string; crawlRunId:string; verifiedAt:string; price:number; stockStatus?: PriceObservation['stockStatus'];
}): PriceObservation {
  const at = new Date(input.verifiedAt);
  return {
    id:input.id,
    workspaceId:'ws_db',
    productId:'prod_db',
    competitorListingId:'listing_db',
    fetchedAt:at,
    verifiedAt:at,
    currency:'USD',
    price:input.price,
    stockStatus:input.stockStatus ?? 'UNKNOWN',
    sourceMethod:'JSON_LD',
    extractorVersion:'jsonld-v2',
    confidence:0.95,
    crawlRunId:input.crawlRunId,
  };
}

async function seedDefault(pool: ReturnType<typeof createDatabasePool>) {
  await migrate(pool);
  await truncateAll(pool);
  await seedCatalog(pool, {
    workspaceId:'ws_db', workspaceName:'DB Test', productId:'prod_db', sku:'SKU-DB', title:'DB Product', currency:'USD',
    listingId:'listing_db', url:'https://example.com/product', retailer:'example.com',
  });
}

test('PostgreSQL is the authority for observation idempotency under concurrent replay', async (t) => {
  const pool = createDatabasePool();
  t.after(async () => pool.end());
  await seedDefault(pool);
  await claimCrawlRun(pool, { id:'run_db_1', jobKey:'job-db-1', workspaceId:'ws_db', listingId:'listing_db' });

  const value = observation({ id:'obs_db_1', crawlRunId:'run_db_1', verifiedAt:'2026-08-20T04:00:00Z', price:100 });
  const results = await Promise.all([
    persistObservationAndEffects(pool, value),
    persistObservationAndEffects(pool, value),
  ]);
  assert.deepEqual(results.map((r) => r.inserted).sort(), [false, true]);
  assert.deepEqual(await countRows(pool), { observations:1, changes:0, outbox:0, succeeded_runs:1 });
});

test('out-of-order completion preserves chronological history without rolling current state backward', async (t) => {
  const pool = createDatabasePool();
  t.after(async () => pool.end());
  await seedDefault(pool);

  await claimCrawlRun(pool, { id:'run_newer', jobKey:'job-newer', workspaceId:'ws_db', listingId:'listing_db' }, new Date('2026-08-20T10:05:00Z'));
  const newer = observation({ id:'obs_newer', crawlRunId:'run_newer', verifiedAt:'2026-08-20T10:05:00Z', price:90 });
  const newerResult = await persistObservationAndEffects(pool, newer);
  assert.equal(newerResult.advancedCurrent, true);

  await claimCrawlRun(pool, { id:'run_older', jobKey:'job-older', workspaceId:'ws_db', listingId:'listing_db' }, new Date('2026-08-20T10:00:00Z'));
  const older = observation({ id:'obs_older', crawlRunId:'run_older', verifiedAt:'2026-08-20T10:00:00Z', price:100 });
  const olderResult = await persistObservationAndEffects(pool, older);
  assert.equal(olderResult.inserted, true, 'late historical observation must still be preserved');
  assert.equal(olderResult.advancedCurrent, false, 'late historical observation must not become current');
  assert.equal(olderResult.changeCount, 0, 'late historical observation must not synthesize reverse changes');

  const listing = await pool.query(`
    SELECT current_price::text, last_successful_crawl_at, last_crawl_at, health
    FROM competitor_listings WHERE id='listing_db'
  `);
  assert.equal(Number(listing.rows[0].current_price), 90);
  assert.equal(new Date(listing.rows[0].last_successful_crawl_at).toISOString(), '2026-08-20T10:05:00.000Z');
  assert.equal(new Date(listing.rows[0].last_crawl_at).toISOString(), '2026-08-20T10:05:00.000Z');
  assert.equal(listing.rows[0].health, 'HEALTHY');

  const history = await pool.query(`
    SELECT id, price::text, verified_at
    FROM price_observations
    WHERE competitor_listing_id='listing_db'
    ORDER BY verified_at ASC, id ASC
  `);
  assert.deepEqual(history.rows.map((row) => [row.id, Number(row.price)]), [
    ['obs_older', 100],
    ['obs_newer', 90],
  ]);
  assert.deepEqual(await countRows(pool), { observations:2, changes:0, outbox:0, succeeded_runs:2 });

  await claimCrawlRun(pool, { id:'run_future', jobKey:'job-future', workspaceId:'ws_db', listingId:'listing_db' }, new Date('2026-08-20T10:10:00Z'));
  const future = observation({ id:'obs_future', crawlRunId:'run_future', verifiedAt:'2026-08-20T10:10:00Z', price:80 });
  const futureResult = await persistObservationAndEffects(pool, future);
  assert.equal(futureResult.advancedCurrent, true);
  assert.equal(futureResult.changeCount, 1);

  const change = await pool.query(`
    SELECT previous_observation_id, previous_value, current_value
    FROM change_events
    WHERE observation_id='obs_future' AND type='PRICE_CHANGED'
  `);
  assert.equal(change.rowCount, 1);
  assert.equal(change.rows[0].previous_observation_id, 'obs_newer', 'forward change must use chronological predecessor, not late insert');
  assert.equal(Number(change.rows[0].previous_value), 90);
  assert.equal(Number(change.rows[0].current_value), 80);
});

test('an older failure finishing late cannot overwrite newer successful health', async (t) => {
  const pool = createDatabasePool();
  t.after(async () => pool.end());
  await seedDefault(pool);

  await claimCrawlRun(pool, { id:'run_success', jobKey:'job-success', workspaceId:'ws_db', listingId:'listing_db' }, new Date('2026-08-20T11:05:00Z'));
  await persistObservationAndEffects(pool, observation({ id:'obs_success', crawlRunId:'run_success', verifiedAt:'2026-08-20T11:05:00Z', price:90 }));

  await claimCrawlRun(pool, { id:'run_old_failure', jobKey:'job-old-failure', workspaceId:'ws_db', listingId:'listing_db' }, new Date('2026-08-20T11:00:00Z'));
  await recordCrawlFailure(
    pool,
    { id:'run_old_failure', jobKey:'job-old-failure', workspaceId:'ws_db', listingId:'listing_db' },
    new Date('2026-08-20T11:00:00Z'),
    'TIMEOUT',
    'DEGRADED',
  );

  const listing = await pool.query(`SELECT current_price::text, last_crawl_at, last_successful_crawl_at, health, failure_count FROM competitor_listings WHERE id='listing_db'`);
  assert.equal(Number(listing.rows[0].current_price), 90);
  assert.equal(new Date(listing.rows[0].last_crawl_at).toISOString(), '2026-08-20T11:05:00.000Z');
  assert.equal(new Date(listing.rows[0].last_successful_crawl_at).toISOString(), '2026-08-20T11:05:00.000Z');
  assert.equal(listing.rows[0].health, 'HEALTHY');
  assert.equal(Number(listing.rows[0].failure_count), 0);
});

test('database composite foreign keys reject cross-workspace listing/product wiring', async (t) => {
  const pool = createDatabasePool();
  t.after(async () => pool.end());
  await migrate(pool);
  await truncateAll(pool);
  await pool.query("INSERT INTO workspaces(id,name) VALUES ('ws_a','A'),('ws_b','B')");
  await pool.query("INSERT INTO products(id,workspace_id,sku,title,currency) VALUES ('prod_a','ws_a','A-1','A','USD')");
  await assert.rejects(
    pool.query("INSERT INTO competitor_listings(id,workspace_id,product_id,url,retailer,expected_currency) VALUES ('bad','ws_b','prod_a','https://example.com','example.com','USD')"),
    /foreign key/i,
  );
});

test('job key cannot be rebound to a different crawl identity', async (t) => {
  const pool = createDatabasePool();
  t.after(async () => pool.end());
  await migrate(pool);
  await truncateAll(pool);
  await seedCatalog(pool, {
    workspaceId:'ws_identity', workspaceName:'Identity Test', productId:'prod_identity', sku:'SKU-ID', title:'Identity Product', currency:'USD',
    listingId:'listing_identity', url:'https://example.com/product', retailer:'example.com',
  });

  await claimCrawlRun(pool, { id:'run_identity_1', jobKey:'stable-job-key', workspaceId:'ws_identity', listingId:'listing_identity' });
  await assert.rejects(
    claimCrawlRun(pool, { id:'run_identity_2', jobKey:'stable-job-key', workspaceId:'ws_identity', listingId:'listing_identity' }),
    (error: unknown) => (error as { code?: string }).code === 'CRAWL_RUN_IDENTITY_CONFLICT',
  );

  const rows = await pool.query("SELECT id, job_key, attempt FROM crawl_runs WHERE job_key='stable-job-key'");
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].id, 'run_identity_1');
  assert.equal(Number(rows.rows[0].attempt), 1, 'rejected identity collision must not mutate the existing run');
});
