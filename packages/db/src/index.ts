import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import type { ListingHealth, PriceObservation, StockStatus } from '../../domain/src/index.ts';

export function createDatabasePool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new Pool({ connectionString, max: 10 });
}

export async function migrate(pool: Pool) {
  const path = fileURLToPath(new URL('../migrations/001_foundation.sql', import.meta.url));
  const sql = await readFile(path, 'utf8');
  await pool.query(sql);
}

export async function truncateAll(pool: Pool) {
  await pool.query('TRUNCATE notification_outbox, change_events, price_observations, crawl_runs, competitor_listings, products, workspaces CASCADE');
}

export interface CrawlRunIdentity {
  id: string;
  jobKey: string;
  workspaceId: string;
  listingId: string;
}

export async function claimCrawlRun(pool: Pool, input: CrawlRunIdentity, at = new Date()) {
  const result = await pool.query<{
    id: string; job_key: string; workspace_id: string; listing_id: string; status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'; attempt: number;
  }>(`
    INSERT INTO crawl_runs (id, job_key, workspace_id, listing_id, status, attempt, started_at)
    VALUES ($1,$2,$3,$4,'RUNNING',1,$5)
    ON CONFLICT (job_key) DO UPDATE SET
      attempt = crawl_runs.attempt + 1,
      status = CASE WHEN crawl_runs.status = 'SUCCEEDED' THEN 'SUCCEEDED' ELSE 'RUNNING' END,
      started_at = CASE WHEN crawl_runs.status = 'SUCCEEDED' THEN crawl_runs.started_at ELSE EXCLUDED.started_at END,
      failure_code = CASE WHEN crawl_runs.status = 'SUCCEEDED' THEN crawl_runs.failure_code ELSE NULL END,
      finished_at = CASE WHEN crawl_runs.status = 'SUCCEEDED' THEN crawl_runs.finished_at ELSE NULL END
    WHERE crawl_runs.id = EXCLUDED.id
      AND crawl_runs.workspace_id = EXCLUDED.workspace_id
      AND crawl_runs.listing_id = EXCLUDED.listing_id
    RETURNING id, job_key, workspace_id, listing_id, status, attempt
  `, [input.id, input.jobKey, input.workspaceId, input.listingId, at]);
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error('jobKey is already bound to a different crawl identity'), { code:'CRAWL_RUN_IDENTITY_CONFLICT' });
  return { ...row, alreadySucceeded: row.status === 'SUCCEEDED' };
}

interface ChangeInsert {
  id: string;
  type: 'PRICE_CHANGED' | 'STOCK_CHANGED';
  previousValue: number | StockStatus;
  currentValue: number | StockStatus;
}

async function insertChangeAndOutbox(
  client: PoolClient,
  workspaceId: string,
  listingId: string,
  observationId: string,
  previousObservationId: string,
  change: ChangeInsert,
) {
  const inserted = await client.query<{id:string}>(`
    INSERT INTO change_events (
      id, workspace_id, listing_id, observation_id, previous_observation_id, type, previous_value, current_value
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
    ON CONFLICT (observation_id, type) DO NOTHING
    RETURNING id
  `, [
    change.id, workspaceId, listingId, observationId, previousObservationId, change.type,
    JSON.stringify(change.previousValue), JSON.stringify(change.currentValue),
  ]);
  if (inserted.rowCount === 0) return false;
  const changeId = inserted.rows[0].id;
  await client.query(`
    INSERT INTO notification_outbox (id, workspace_id, change_event_id, channel)
    VALUES ($1,$2,$3,'WEBHOOK')
    ON CONFLICT (change_event_id, channel) DO NOTHING
  `, [`outbox_${changeId}`, workspaceId, changeId]);
  return true;
}

export async function persistObservationAndEffects(pool: Pool, observation: PriceObservation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const listingLock = await client.query<{product_id:string}>(
      'SELECT product_id FROM competitor_listings WHERE id=$1 AND workspace_id=$2 FOR UPDATE',
      [observation.competitorListingId, observation.workspaceId],
    );
    if (listingLock.rowCount !== 1) throw new Error('Listing not found in workspace');
    if (listingLock.rows[0].product_id !== observation.productId) throw new Error('Observation product/listing mismatch');

    const inserted = await client.query<{id:string}>(`
      INSERT INTO price_observations (
        id, workspace_id, product_id, competitor_listing_id, crawl_run_id, fetched_at, verified_at,
        currency, price, stock_status, seller_name, source_method, extractor_version, confidence
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (crawl_run_id) DO NOTHING
      RETURNING id
    `, [
      observation.id, observation.workspaceId, observation.productId, observation.competitorListingId,
      observation.crawlRunId, observation.fetchedAt, observation.verifiedAt, observation.currency,
      observation.price, observation.stockStatus, observation.sellerName ?? null, observation.sourceMethod,
      observation.extractorVersion, observation.confidence,
    ]);

    if (inserted.rowCount === 0) {
      await client.query('COMMIT');
      return { inserted: false as const, changeCount: 0, outboxCount: 0 };
    }

    const priorResult = await client.query<{
      id:string; price:string; stock_status:StockStatus;
    }>(`
      SELECT id, price::text, stock_status
      FROM price_observations
      WHERE competitor_listing_id=$1 AND workspace_id=$2 AND id<>$3
      ORDER BY verified_at DESC, id DESC
      LIMIT 1
    `, [observation.competitorListingId, observation.workspaceId, observation.id]);

    let changeCount = 0;
    let outboxCount = 0;
    const prior = priorResult.rows[0];
    if (prior) {
      const priorPrice = Number(prior.price);
      if (priorPrice !== observation.price) {
        const created = await insertChangeAndOutbox(client, observation.workspaceId, observation.competitorListingId, observation.id, prior.id, {
          id: `chg_${observation.id}_price`, type: 'PRICE_CHANGED', previousValue: priorPrice, currentValue: observation.price,
        });
        if (created) { changeCount += 1; outboxCount += 1; }
      }
      if (prior.stock_status !== observation.stockStatus) {
        const created = await insertChangeAndOutbox(client, observation.workspaceId, observation.competitorListingId, observation.id, prior.id, {
          id: `chg_${observation.id}_stock`, type: 'STOCK_CHANGED', previousValue: prior.stock_status, currentValue: observation.stockStatus,
        });
        if (created) { changeCount += 1; outboxCount += 1; }
      }
    }

    await client.query(`
      UPDATE competitor_listings SET
        current_price=$1, current_currency=$2, current_stock_status=$3,
        last_crawl_at=$4, last_successful_crawl_at=$5,
        health='HEALTHY', failure_count=0, last_failure_code=NULL
      WHERE id=$6 AND workspace_id=$7
    `, [
      observation.price, observation.currency, observation.stockStatus,
      observation.fetchedAt, observation.verifiedAt,
      observation.competitorListingId, observation.workspaceId,
    ]);
    await client.query(`
      UPDATE crawl_runs SET status='SUCCEEDED', finished_at=$1, failure_code=NULL
      WHERE id=$2 AND workspace_id=$3
    `, [observation.verifiedAt, observation.crawlRunId, observation.workspaceId]);
    await client.query('COMMIT');
    return { inserted: true as const, changeCount, outboxCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function recordCrawlFailure(
  pool: Pool,
  input: CrawlRunIdentity,
  at: Date,
  code: string,
  health: ListingHealth = 'DEGRADED',
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      UPDATE crawl_runs SET status='FAILED', finished_at=$1, failure_code=$2
      WHERE id=$3 AND workspace_id=$4 AND status <> 'SUCCEEDED'
    `, [at, code, input.id, input.workspaceId]);
    await client.query(`
      UPDATE competitor_listings SET last_crawl_at=$1, failure_count=failure_count+1,
        last_failure_code=$2, health=$3
      WHERE id=$4 AND workspace_id=$5
    `, [at, code, health, input.listingId, input.workspaceId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function seedCatalog(pool: Pool, input: {
  workspaceId:string; workspaceName:string; productId:string; sku:string; title:string; currency:string;
  listingId:string; url:string; retailer:string;
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO workspaces(id,name) VALUES($1,$2)', [input.workspaceId,input.workspaceName]);
    await client.query('INSERT INTO products(id,workspace_id,sku,title,currency) VALUES($1,$2,$3,$4,$5)', [input.productId,input.workspaceId,input.sku,input.title,input.currency]);
    await client.query(`INSERT INTO competitor_listings(id,workspace_id,product_id,url,retailer) VALUES($1,$2,$3,$4,$5)`, [input.listingId,input.workspaceId,input.productId,input.url,input.retailer]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function countRows(pool: Pool) {
  const result = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM price_observations) AS observations,
      (SELECT count(*)::int FROM change_events) AS changes,
      (SELECT count(*)::int FROM notification_outbox) AS outbox,
      (SELECT count(*)::int FROM crawl_runs WHERE status='SUCCEEDED') AS succeeded_runs
  `);
  return result.rows[0] as {observations:number;changes:number;outbox:number;succeeded_runs:number};
}
