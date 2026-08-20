import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Pool, PoolClient } from 'pg';
import type { Queue } from 'bullmq';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  verifyPassword,
} from '../../../packages/auth/src/index.ts';
import { enqueueCrawl, type CrawlJobData } from '../../../packages/jobs/src/crawl-queue.ts';

const JSON_LIMIT_BYTES = 1_048_576;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type MembershipRole = 'OWNER' | 'MEMBER';

interface AuthenticatedUser {
  id: string;
  email: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
    this.name = 'HttpError';
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > JSON_LIMIT_BYTES) throw new HttpError(413, 'Request body too large', 'BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Body must be a JSON object', 'INVALID_JSON');
  }
}

function requiredString(body: Record<string, unknown>, key: string, max = 500) {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new HttpError(400, `${key} is required`, 'INVALID_INPUT');
  }
  return value.trim();
}

function requiredSecret(body: Record<string, unknown>, key: string, max = 256) {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new HttpError(400, `${key} is required`, 'INVALID_INPUT');
  }
  return value;
}

function optionalNumber(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new HttpError(400, `${key} must be a non-negative number`, 'INVALID_INPUT');
  }
  return value;
}

function validateHttpUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new HttpError(400, 'url is invalid', 'INVALID_URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'Only HTTP(S) listing URLs are allowed', 'INVALID_URL');
  if (url.username || url.password) throw new HttpError(400, 'Credential-bearing URLs are not allowed', 'INVALID_URL');
  return url.toString();
}

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createSession(client: PoolClient, userId: string, ttlMs: number) {
  const token = createSessionToken();
  const sessionId = `sess_${randomUUID()}`;
  const expiresAt = new Date(Date.now() + ttlMs);
  await client.query(
    'INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4)',
    [sessionId, userId, hashSessionToken(token), expiresAt],
  );
  return { token, expiresAt };
}

async function authenticate(pool: Pool, req: IncomingMessage): Promise<AuthenticatedUser> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');
  const token = header.slice('Bearer '.length).trim();
  if (!token) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');
  const result = await pool.query<{id:string;email:string}>(`
    SELECT u.id, u.email
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at > now()
    LIMIT 1
  `, [hashSessionToken(token)]);
  const user = result.rows[0];
  if (!user) throw new HttpError(401, 'Session is invalid or expired', 'UNAUTHENTICATED');
  return user;
}

async function requireMembership(pool: Pool, userId: string, workspaceId: string): Promise<MembershipRole> {
  const result = await pool.query<{role:MembershipRole}>(
    'SELECT role FROM memberships WHERE user_id=$1 AND workspace_id=$2',
    [userId, workspaceId],
  );
  const membership = result.rows[0];
  if (!membership) throw new HttpError(403, 'Workspace access forbidden', 'FORBIDDEN');
  return membership.role;
}

function mapPgConflict(error: unknown): never {
  if ((error as {code?:string}).code === '23505') throw new HttpError(409, 'Resource already exists', 'CONFLICT');
  throw error;
}

export interface ApiServerOptions {
  pool: Pool;
  queue: Queue<CrawlJobData>;
  sessionTtlMs?: number;
}

export function createApiServer(options: ApiServerOptions) {
  const { pool, queue, sessionTtlMs = SESSION_TTL_MS } = options;

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const path = url.pathname;

      if (method === 'GET' && path === '/health') return json(res, 200, { ok: true });

      if (method === 'POST' && path === '/v1/auth/register') {
        const body = await readJson(req);
        const email = normalizeEmail(requiredString(body, 'email', 320));
        const password = requiredSecret(body, 'password', 256);
        if (!email.includes('@')) throw new HttpError(400, 'email is invalid', 'INVALID_INPUT');
        const passwordHash = await hashPassword(password);
        try {
          const result = await inTransaction(pool, async (client) => {
            const userId = `usr_${randomUUID()}`;
            await client.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [userId, email, passwordHash]);
            const session = await createSession(client, userId, sessionTtlMs);
            return { user: { id: userId, email }, ...session };
          });
          return json(res, 201, result);
        } catch (error) { mapPgConflict(error); }
      }

      if (method === 'POST' && path === '/v1/auth/login') {
        const body = await readJson(req);
        const email = normalizeEmail(requiredString(body, 'email', 320));
        const password = requiredSecret(body, 'password', 256);
        const userResult = await pool.query<{id:string;email:string;password_hash:string}>(
          'SELECT id,email,password_hash FROM users WHERE email=$1', [email],
        );
        const user = userResult.rows[0];
        if (!user || !(await verifyPassword(password, user.password_hash))) {
          throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
        }
        const session = await inTransaction(pool, (client) => createSession(client, user.id, sessionTtlMs));
        return json(res, 200, { user: { id: user.id, email: user.email }, ...session });
      }

      const actor = await authenticate(pool, req);

      if (method === 'GET' && path === '/v1/me') return json(res, 200, { user: actor });

      if (method === 'GET' && path === '/v1/workspaces') {
        const rows = await pool.query<{id:string;name:string;role:MembershipRole}>(`
          SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
          WHERE m.user_id=$1 ORDER BY w.created_at ASC, w.id ASC
        `, [actor.id]);
        return json(res, 200, { workspaces: rows.rows });
      }

      if (method === 'POST' && path === '/v1/workspaces') {
        const body = await readJson(req);
        const name = requiredString(body, 'name', 200);
        const workspace = await inTransaction(pool, async (client) => {
          const id = `ws_${randomUUID()}`;
          await client.query('INSERT INTO workspaces(id,name) VALUES($1,$2)', [id, name]);
          await client.query("INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'OWNER')", [actor.id, id]);
          return { id, name, role: 'OWNER' as const };
        });
        return json(res, 201, { workspace });
      }

      const memberCollection = path.match(/^\/v1\/workspaces\/([^/]+)\/members$/);
      if (memberCollection && method === 'POST') {
        const workspaceId = decodeURIComponent(memberCollection[1]);
        const role = await requireMembership(pool, actor.id, workspaceId);
        if (role !== 'OWNER') throw new HttpError(403, 'Only workspace owners can manage members', 'FORBIDDEN');
        const body = await readJson(req);
        const email = normalizeEmail(requiredString(body, 'email', 320));
        const requestedRole = body.role === undefined ? 'MEMBER' : requiredString(body, 'role', 10).toUpperCase();
        if (requestedRole !== 'OWNER' && requestedRole !== 'MEMBER') {
          throw new HttpError(400, 'role must be OWNER or MEMBER', 'INVALID_INPUT');
        }
        const userResult = await pool.query<{id:string;email:string}>('SELECT id,email FROM users WHERE email=$1', [email]);
        const user = userResult.rows[0];
        if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND');
        try {
          await pool.query('INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,$3)', [user.id, workspaceId, requestedRole]);
        } catch (error) { mapPgConflict(error); }
        return json(res, 201, { membership: { userId:user.id, email:user.email, workspaceId, role:requestedRole } });
      }

      const productCollection = path.match(/^\/v1\/workspaces\/([^/]+)\/products$/);
      if (productCollection) {
        const workspaceId = decodeURIComponent(productCollection[1]);
        await requireMembership(pool, actor.id, workspaceId);
        if (method === 'GET') {
          const rows = await pool.query(`
            SELECT id,sku,title,current_price::text,currency FROM products
            WHERE workspace_id=$1 ORDER BY created_at ASC,id ASC
          `, [workspaceId]);
          return json(res, 200, { products: rows.rows.map((row) => ({
            id:row.id, sku:row.sku, title:row.title,
            currentPrice:row.current_price === null ? null : Number(row.current_price), currency:row.currency,
          })) });
        }
        if (method === 'POST') {
          const body = await readJson(req);
          const sku = requiredString(body, 'sku', 120);
          const title = requiredString(body, 'title', 500);
          const currency = requiredString(body, 'currency', 3).toUpperCase();
          if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'currency must be a 3-letter code', 'INVALID_INPUT');
          const currentPrice = optionalNumber(body, 'currentPrice');
          const id = `prod_${randomUUID()}`;
          try {
            await pool.query(`
              INSERT INTO products(id,workspace_id,sku,title,current_price,currency)
              VALUES($1,$2,$3,$4,$5,$6)
            `, [id, workspaceId, sku, title, currentPrice, currency]);
          } catch (error) { mapPgConflict(error); }
          return json(res, 201, { product: { id, workspaceId, sku, title, currentPrice, currency } });
        }
      }

      const listingCollection = path.match(/^\/v1\/workspaces\/([^/]+)\/products\/([^/]+)\/listings$/);
      if (listingCollection && method === 'POST') {
        const workspaceId = decodeURIComponent(listingCollection[1]);
        const productId = decodeURIComponent(listingCollection[2]);
        await requireMembership(pool, actor.id, workspaceId);
        const product = await pool.query('SELECT id FROM products WHERE id=$1 AND workspace_id=$2', [productId, workspaceId]);
        if (product.rowCount !== 1) throw new HttpError(404, 'Product not found', 'NOT_FOUND');
        const body = await readJson(req);
        const listingUrl = validateHttpUrl(requiredString(body, 'url', 4000));
        const retailer = requiredString(body, 'retailer', 250);
        const id = `lst_${randomUUID()}`;
        await pool.query(`
          INSERT INTO competitor_listings(id,workspace_id,product_id,url,retailer)
          VALUES($1,$2,$3,$4,$5)
        `, [id, workspaceId, productId, listingUrl, retailer]);
        return json(res, 201, { listing: { id, workspaceId, productId, url: listingUrl, retailer, health: 'STALE' } });
      }

      const listingRoute = path.match(/^\/v1\/workspaces\/([^/]+)\/listings\/([^/]+)$/);
      if (listingRoute && method === 'GET') {
        const workspaceId = decodeURIComponent(listingRoute[1]);
        const listingId = decodeURIComponent(listingRoute[2]);
        await requireMembership(pool, actor.id, workspaceId);
        const result = await pool.query(`
          SELECT id,product_id,url,retailer,health,current_price::text,current_currency,current_stock_status,
            last_crawl_at,last_successful_crawl_at,failure_count,last_failure_code
          FROM competitor_listings WHERE id=$1 AND workspace_id=$2
        `, [listingId, workspaceId]);
        const row = result.rows[0];
        if (!row) throw new HttpError(404, 'Listing not found', 'NOT_FOUND');
        return json(res, 200, { listing: {
          id:row.id, productId:row.product_id, url:row.url, retailer:row.retailer, health:row.health,
          currentPrice:row.current_price === null ? null : Number(row.current_price),
          currentCurrency:row.current_currency, currentStockStatus:row.current_stock_status,
          lastCrawlAt:row.last_crawl_at, lastSuccessfulCrawlAt:row.last_successful_crawl_at,
          failureCount:row.failure_count, lastFailureCode:row.last_failure_code,
        } });
      }

      const historyRoute = path.match(/^\/v1\/workspaces\/([^/]+)\/listings\/([^/]+)\/history$/);
      if (historyRoute && method === 'GET') {
        const workspaceId = decodeURIComponent(historyRoute[1]);
        const listingId = decodeURIComponent(historyRoute[2]);
        await requireMembership(pool, actor.id, workspaceId);
        const exists = await pool.query('SELECT 1 FROM competitor_listings WHERE id=$1 AND workspace_id=$2', [listingId, workspaceId]);
        if (exists.rowCount !== 1) throw new HttpError(404, 'Listing not found', 'NOT_FOUND');
        const observations = await pool.query(`
          SELECT id,crawl_run_id,verified_at,currency,price::text,stock_status,seller_name,source_method,confidence::text
          FROM price_observations WHERE competitor_listing_id=$1 AND workspace_id=$2
          ORDER BY verified_at DESC,id DESC
        `, [listingId, workspaceId]);
        const changes = await pool.query(`
          SELECT id,observation_id,previous_observation_id,type,previous_value,current_value,created_at
          FROM change_events WHERE listing_id=$1 AND workspace_id=$2
          ORDER BY created_at DESC,id DESC
        `, [listingId, workspaceId]);
        return json(res, 200, {
          observations: observations.rows.map((row) => ({
            id:row.id, crawlRunId:row.crawl_run_id, verifiedAt:row.verified_at, currency:row.currency,
            price:Number(row.price), stockStatus:row.stock_status, sellerName:row.seller_name,
            sourceMethod:row.source_method, confidence:Number(row.confidence),
          })),
          changes: changes.rows.map((row) => ({
            id:row.id, observationId:row.observation_id, previousObservationId:row.previous_observation_id,
            type:row.type, previousValue:row.previous_value, currentValue:row.current_value, createdAt:row.created_at,
          })),
        });
      }

      const crawlRoute = path.match(/^\/v1\/workspaces\/([^/]+)\/listings\/([^/]+)\/crawl$/);
      if (crawlRoute && method === 'POST') {
        const workspaceId = decodeURIComponent(crawlRoute[1]);
        const listingId = decodeURIComponent(crawlRoute[2]);
        await requireMembership(pool, actor.id, workspaceId);
        const result = await pool.query<{product_id:string;url:string}>(
          'SELECT product_id,url FROM competitor_listings WHERE id=$1 AND workspace_id=$2',
          [listingId, workspaceId],
        );
        const listing = result.rows[0];
        if (!listing) throw new HttpError(404, 'Listing not found', 'NOT_FOUND');
        const crawlRunId = `run_${randomUUID()}`;
        const jobKey = `manual:${listingId}:${crawlRunId}`;
        const job = await enqueueCrawl(queue, {
          workspaceId, productId: listing.product_id, listingId, url: listing.url, crawlRunId, jobKey,
        });
        return json(res, 202, { crawl: { crawlRunId, jobKey, queueJobId: job.id } });
      }

      throw new HttpError(404, 'Route not found', 'NOT_FOUND');
    } catch (error) {
      if (error instanceof HttpError) return json(res, error.status, { error: { code: error.code, message: error.message } });
      console.error('api_request_failed', error);
      return json(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    }
  });

  return {
    server,
    async listen(port = 0, host = '127.0.0.1') {
      await new Promise<void>((resolve) => server.listen(port, host, resolve));
      const address = server.address() as AddressInfo | null;
      if (!address) throw new Error('API server failed to bind');
      return `http://127.0.0.1:${address.port}`;
    },
    async close() {
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
