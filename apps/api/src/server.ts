import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Pool, PoolClient } from 'pg';
import type { Queue } from 'bullmq';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from '../../../packages/auth/src/index.ts';
import { enqueueCrawl, type CrawlJobData } from '../../../packages/jobs/src/crawl-queue.ts';
import { operatorUiCss, operatorUiHtml, operatorUiJs } from './ui.ts';

const JSON_LIMIT_BYTES = 1_048_576;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'priceintel_session';
const dummyPasswordHashPromise = hashPassword('priceintel-invalid-user-sentinel');

const LISTING_HEALTH = new Set(['HEALTHY','STALE','DEGRADED','BLOCKED','PARSE_FAILED','PAGE_MISSING','NEEDS_REVIEW']);

type MembershipRole = 'OWNER' | 'MEMBER';
type SessionTransport = 'bearer' | 'cookie';
type AuthAction = 'login' | 'register';

interface AuthenticatedSession {
  user: { id: string; email: string };
  tokenHash: string;
  source: SessionTransport;
}

interface RateLimitConfig {
  ipLimit: number;
  emailLimit: number;
  windowMs: number;
}

interface AuthRateLimits {
  login: RateLimitConfig;
  register: RateLimitConfig;
}

const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  login: { ipLimit:30, emailLimit:10, windowMs:15 * 60 * 1000 },
  register: { ipLimit:12, emailLimit:4, windowMs:15 * 60 * 1000 },
};

class HttpError extends Error {
  status: number;
  code: string;
  retryAfterSeconds?: number;
  constructor(status: number, message: string, code: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
  };
}

function json(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string,string> = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...securityHeaders(),
    ...extraHeaders,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

function text(res: ServerResponse, status: number, body: string, contentType: string) {
  res.writeHead(status, {
    ...securityHeaders(),
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  res.end(body);
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
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new HttpError(400, `${key} must be a non-negative number`, 'INVALID_INPUT');
  }
  return value;
}

function sessionTransport(body: Record<string, unknown>): SessionTransport {
  const value = body.sessionTransport ?? 'bearer';
  if (value !== 'bearer' && value !== 'cookie') throw new HttpError(400, 'sessionTransport must be bearer or cookie', 'INVALID_INPUT');
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
  const tokenHash = hashSessionToken(token);
  await client.query(
    'INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4)',
    [sessionId, userId, tokenHash, expiresAt],
  );
  return { token, tokenHash, expiresAt };
}

function parseCookies(header: string | undefined) {
  const cookies = new Map<string,string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    try { cookies.set(key, decodeURIComponent(raw)); } catch { cookies.set(key, raw); }
  }
  return cookies;
}

function sessionCookie(token: string, ttlMs: number, secure: boolean) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.max(1, Math.floor(ttlMs / 1000))}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function clearSessionCookie(secure: boolean) {
  const attributes = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function assertSameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) throw new HttpError(403, 'Same-origin browser request required', 'CSRF_REJECTED');
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new HttpError(403, 'Invalid Origin header', 'CSRF_REJECTED'); }
  if (parsed.host !== host) throw new HttpError(403, 'Cross-origin write rejected', 'CSRF_REJECTED');
}

function requestIp(req: IncomingMessage) {
  return req.socket.remoteAddress ?? 'unknown';
}

function rateLimitKey(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

async function consumeRateLimit(pool: Pool, rawKey: string, limit: number, windowMs: number) {
  const now = new Date();
  const resetBefore = new Date(now.getTime() - windowMs);
  const result = await pool.query<{attempts:number;window_started_at:Date}>(`
    INSERT INTO auth_rate_limits(key_hash,window_started_at,attempts,updated_at)
    VALUES($1,$2,1,$2)
    ON CONFLICT (key_hash) DO UPDATE SET
      attempts = CASE WHEN auth_rate_limits.window_started_at <= $3 THEN 1 ELSE auth_rate_limits.attempts + 1 END,
      window_started_at = CASE WHEN auth_rate_limits.window_started_at <= $3 THEN $2 ELSE auth_rate_limits.window_started_at END,
      updated_at = $2
    RETURNING attempts,window_started_at
  `, [rateLimitKey(rawKey), now, resetBefore]);
  const row = result.rows[0];
  if (row.attempts > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((row.window_started_at.getTime() + windowMs - now.getTime()) / 1000));
    throw new HttpError(429, 'Too many authentication attempts', 'RATE_LIMITED', retryAfterSeconds);
  }
}

async function enforceAuthRateLimit(pool: Pool, req: IncomingMessage, action: AuthAction, email: string, limits: AuthRateLimits) {
  const config = limits[action];
  await consumeRateLimit(pool, `auth:${action}:ip:${requestIp(req)}`, config.ipLimit, config.windowMs);
  await consumeRateLimit(pool, `auth:${action}:email:${email}`, config.emailLimit, config.windowMs);
}

async function authenticate(pool: Pool, req: IncomingMessage): Promise<AuthenticatedSession> {
  const header = req.headers.authorization;
  let token: string | undefined;
  let source: SessionTransport = 'cookie';
  if (header?.startsWith('Bearer ')) {
    token = header.slice('Bearer '.length).trim();
    source = 'bearer';
  } else {
    token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  }
  if (!token) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');
  const tokenHash = hashSessionToken(token);
  const result = await pool.query<{id:string;email:string}>(`
    SELECT u.id, u.email
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at > now()
    LIMIT 1
  `, [tokenHash]);
  const user = result.rows[0];
  if (!user) throw new HttpError(401, 'Session is invalid or expired', 'UNAUTHENTICATED');
  return { user, tokenHash, source };
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

function listingFromRow(row: Record<string, unknown>) {
  return {
    id:row.id,
    productId:row.product_id,
    url:row.url,
    retailer:row.retailer,
    health:row.health,
    currentPrice:row.current_price === null ? null : Number(row.current_price),
    currentCurrency:row.current_currency,
    currentStockStatus:row.current_stock_status,
    lastCrawlAt:row.last_crawl_at,
    lastSuccessfulCrawlAt:row.last_successful_crawl_at,
    failureCount:row.failure_count,
    lastFailureCode:row.last_failure_code,
    sourceMethod:row.source_method ?? null,
    confidence:row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
  };
}

export interface ApiServerOptions {
  pool: Pool;
  queue: Queue<CrawlJobData>;
  sessionTtlMs?: number;
  secureCookies?: boolean;
  authRateLimits?: Partial<{ login: Partial<RateLimitConfig>; register: Partial<RateLimitConfig> }>;
}

export function createApiServer(options: ApiServerOptions) {
  const { pool, queue, sessionTtlMs = SESSION_TTL_MS, secureCookies = false } = options;
  const authRateLimits: AuthRateLimits = {
    login: { ...DEFAULT_AUTH_RATE_LIMITS.login, ...options.authRateLimits?.login },
    register: { ...DEFAULT_AUTH_RATE_LIMITS.register, ...options.authRateLimits?.register },
  };

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const path = url.pathname;

      if (method === 'GET' && path === '/') return text(res, 200, operatorUiHtml(), 'text/html; charset=utf-8');
      if (method === 'GET' && path === '/app.css') return text(res, 200, operatorUiCss(), 'text/css; charset=utf-8');
      if (method === 'GET' && path === '/app.js') return text(res, 200, operatorUiJs(), 'text/javascript; charset=utf-8');
      if (method === 'GET' && path === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (method === 'GET' && path === '/health') return json(res, 200, { ok: true });

      if (method === 'POST' && path === '/v1/auth/register') {
        const body = await readJson(req);
        const email = normalizeEmail(requiredString(body, 'email', 320));
        const password = requiredSecret(body, 'password', 256);
        const transport = sessionTransport(body);
        if (transport === 'cookie') assertSameOrigin(req);
        if (!email.includes('@')) throw new HttpError(400, 'email is invalid', 'INVALID_INPUT');
        try { validatePassword(password); } catch { throw new HttpError(400, 'Password must be between 8 and 256 characters', 'INVALID_PASSWORD'); }
        await enforceAuthRateLimit(pool, req, 'register', email, authRateLimits);
        const passwordHash = await hashPassword(password);
        try {
          const result = await inTransaction(pool, async (client) => {
            const userId = `usr_${randomUUID()}`;
            await client.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [userId, email, passwordHash]);
            const session = await createSession(client, userId, sessionTtlMs);
            return { user: { id:userId, email }, session };
          });
          if (transport === 'cookie') {
            res.setHeader('set-cookie', sessionCookie(result.session.token, sessionTtlMs, secureCookies));
            return json(res, 201, { user:result.user, expiresAt:result.session.expiresAt, sessionTransport:'cookie' });
          }
          return json(res, 201, { user:result.user, token:result.session.token, expiresAt:result.session.expiresAt, sessionTransport:'bearer' });
        } catch (error) { mapPgConflict(error); }
      }

      if (method === 'POST' && path === '/v1/auth/login') {
        const body = await readJson(req);
        const email = normalizeEmail(requiredString(body, 'email', 320));
        const password = requiredSecret(body, 'password', 256);
        const transport = sessionTransport(body);
        if (transport === 'cookie') assertSameOrigin(req);
        await enforceAuthRateLimit(pool, req, 'login', email, authRateLimits);
        const userResult = await pool.query<{id:string;email:string;password_hash:string}>(
          'SELECT id,email,password_hash FROM users WHERE email=$1', [email],
        );
        const user = userResult.rows[0];
        const storedHash = user?.password_hash ?? await dummyPasswordHashPromise;
        const passwordMatches = await verifyPassword(password, storedHash);
        if (!user || !passwordMatches) throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
        const session = await inTransaction(pool, (client) => createSession(client, user.id, sessionTtlMs));
        if (transport === 'cookie') {
          res.setHeader('set-cookie', sessionCookie(session.token, sessionTtlMs, secureCookies));
          return json(res, 200, { user:{ id:user.id, email:user.email }, expiresAt:session.expiresAt, sessionTransport:'cookie' });
        }
        return json(res, 200, { user:{ id:user.id, email:user.email }, token:session.token, expiresAt:session.expiresAt, sessionTransport:'bearer' });
      }

      const actor = await authenticate(pool, req);
      if (actor.source === 'cookie' && method !== 'GET' && method !== 'HEAD') assertSameOrigin(req);

      if (method === 'POST' && path === '/v1/auth/logout') {
        await pool.query('DELETE FROM sessions WHERE token_hash=$1', [actor.tokenHash]);
        res.setHeader('set-cookie', clearSessionCookie(secureCookies));
        return json(res, 200, { ok:true });
      }

      if (method === 'GET' && path === '/v1/me') return json(res, 200, { user:actor.user });

      if (method === 'GET' && path === '/v1/workspaces') {
        const rows = await pool.query<{id:string;name:string;role:MembershipRole}>(`
          SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
          WHERE m.user_id=$1 ORDER BY w.created_at ASC,w.id ASC
        `, [actor.user.id]);
        return json(res, 200, { workspaces:rows.rows });
      }

      if (method === 'POST' && path === '/v1/workspaces') {
        const body = await readJson(req);
        const name = requiredString(body, 'name', 200);
        const workspace = await inTransaction(pool, async (client) => {
          const id = `ws_${randomUUID()}`;
          await client.query('INSERT INTO workspaces(id,name) VALUES($1,$2)', [id, name]);
          await client.query("INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'OWNER')", [actor.user.id, id]);
          return { id, name, role:'OWNER' as const };
        });
        return json(res, 201, { workspace });
      }

      const memberCollection = path.match(/^\/v1\/workspaces\/([^/]+)\/members$/);
      if (memberCollection && method === 'POST') {
        const workspaceId = decodeURIComponent(memberCollection[1]);
        const role = await requireMembership(pool, actor.user.id, workspaceId);
        if (role !== 'OWNER') throw new HttpError(403, 'Only workspace owners can manage members', 'FORBIDDEN');
        const body = await readJson(req);
        const email = normalizeEmail(requiredString(body, 'email', 320));
        const requestedRole = body.role === undefined ? 'MEMBER' : requiredString(body, 'role', 10).toUpperCase();
        if (requestedRole !== 'OWNER' && requestedRole !== 'MEMBER') throw new HttpError(400, 'role must be OWNER or MEMBER', 'INVALID_INPUT');
        const userResult = await pool.query<{id:string;email:string}>('SELECT id,email FROM users WHERE email=$1', [email]);
        const user = userResult.rows[0];
        if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND');
        try { await pool.query('INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,$3)', [user.id,workspaceId,requestedRole]); }
        catch (error) { mapPgConflict(error); }
        return json(res, 201, { membership:{ userId:user.id, email:user.email, workspaceId, role:requestedRole } });
      }

      const productCollection = path.match(/^\/v1\/workspaces\/([^/]+)\/products$/);
      if (productCollection) {
        const workspaceId = decodeURIComponent(productCollection[1]);
        await requireMembership(pool, actor.user.id, workspaceId);
        if (method === 'GET') {
          const rows = await pool.query(`
            SELECT p.id,p.sku,p.title,p.current_price::text,p.currency,
              (SELECT count(*)::int FROM competitor_listings l WHERE l.workspace_id=p.workspace_id AND l.product_id=p.id) AS listing_count
            FROM products p WHERE p.workspace_id=$1 ORDER BY p.created_at ASC,p.id ASC
          `, [workspaceId]);
          return json(res, 200, { products:rows.rows.map((row) => ({
            id:row.id, sku:row.sku, title:row.title,
            currentPrice:row.current_price === null ? null : Number(row.current_price),
            currency:row.currency, listingCount:Number(row.listing_count),
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
            await pool.query('INSERT INTO products(id,workspace_id,sku,title,current_price,currency) VALUES($1,$2,$3,$4,$5,$6)', [id,workspaceId,sku,title,currentPrice,currency]);
          } catch (error) { mapPgConflict(error); }
          return json(res, 201, { product:{ id,workspaceId,sku,title,currentPrice,currency } });
        }
      }

      const productListingCollection = path.match(/^\/v1\/workspaces\/([^/]+)\/products\/([^/]+)\/listings$/);
      if (productListingCollection) {
        const workspaceId = decodeURIComponent(productListingCollection[1]);
        const productId = decodeURIComponent(productListingCollection[2]);
        await requireMembership(pool, actor.user.id, workspaceId);
        const product = await pool.query('SELECT id FROM products WHERE id=$1 AND workspace_id=$2', [productId,workspaceId]);
        if (product.rowCount !== 1) throw new HttpError(404, 'Product not found', 'NOT_FOUND');
        if (method === 'GET') {
          url.searchParams.set('productId', productId);
        } else if (method === 'POST') {
          const body = await readJson(req);
          const listingUrl = validateHttpUrl(requiredString(body, 'url', 4000));
          const retailer = requiredString(body, 'retailer', 250);
          const id = `lst_${randomUUID()}`;
          await pool.query('INSERT INTO competitor_listings(id,workspace_id,product_id,url,retailer) VALUES($1,$2,$3,$4,$5)', [id,workspaceId,productId,listingUrl,retailer]);
          return json(res, 201, { listing:{ id,workspaceId,productId,url:listingUrl,retailer,health:'STALE' } });
        }
      }

      const listingCollection = path.match(/^\/v1\/workspaces\/([^/]+)\/listings$/);
      if ((listingCollection && method === 'GET') || (productListingCollection && method === 'GET')) {
        const workspaceId = decodeURIComponent((listingCollection ?? productListingCollection)![1]);
        await requireMembership(pool, actor.user.id, workspaceId);
        const values: unknown[] = [workspaceId];
        const conditions = ['l.workspace_id=$1'];
        const productId = productListingCollection ? decodeURIComponent(productListingCollection[2]) : url.searchParams.get('productId');
        const health = url.searchParams.get('health');
        const retailer = url.searchParams.get('retailer');
        if (productId) { values.push(productId); conditions.push(`l.product_id=$${values.length}`); }
        if (health) {
          const normalized = health.toUpperCase();
          if (!LISTING_HEALTH.has(normalized)) throw new HttpError(400, 'Unknown listing health filter', 'INVALID_INPUT');
          values.push(normalized); conditions.push(`l.health=$${values.length}`);
        }
        if (retailer) { values.push(retailer); conditions.push(`l.retailer ILIKE '%' || $${values.length} || '%'`); }
        const rows = await pool.query(`
          SELECT l.id,l.product_id,l.url,l.retailer,l.health,l.current_price::text,l.current_currency,l.current_stock_status,
            l.last_crawl_at,l.last_successful_crawl_at,l.failure_count,l.last_failure_code,
            latest.source_method,latest.confidence::text
          FROM competitor_listings l
          LEFT JOIN LATERAL (
            SELECT source_method,confidence FROM price_observations o
            WHERE o.workspace_id=l.workspace_id AND o.competitor_listing_id=l.id
            ORDER BY o.verified_at DESC,o.id DESC LIMIT 1
          ) latest ON true
          WHERE ${conditions.join(' AND ')}
          ORDER BY l.created_at ASC,l.id ASC
        `, values);
        return json(res, 200, { listings:rows.rows.map((row) => listingFromRow(row)) });
      }

      const listingRoute = path.match(/^\/v1\/workspaces\/([^/]+)\/listings\/([^/]+)$/);
      if (listingRoute && method === 'GET') {
        const workspaceId = decodeURIComponent(listingRoute[1]);
        const listingId = decodeURIComponent(listingRoute[2]);
        await requireMembership(pool, actor.user.id, workspaceId);
        const result = await pool.query(`
          SELECT l.id,l.product_id,l.url,l.retailer,l.health,l.current_price::text,l.current_currency,l.current_stock_status,
            l.last_crawl_at,l.last_successful_crawl_at,l.failure_count,l.last_failure_code,
            latest.source_method,latest.confidence::text
          FROM competitor_listings l
          LEFT JOIN LATERAL (
            SELECT source_method,confidence FROM price_observations o
            WHERE o.workspace_id=l.workspace_id AND o.competitor_listing_id=l.id
            ORDER BY o.verified_at DESC,o.id DESC LIMIT 1
          ) latest ON true
          WHERE l.id=$1 AND l.workspace_id=$2
        `, [listingId,workspaceId]);
        const row = result.rows[0];
        if (!row) throw new HttpError(404, 'Listing not found', 'NOT_FOUND');
        return json(res, 200, { listing:listingFromRow(row) });
      }

      const historyRoute = path.match(/^\/v1\/workspaces\/([^/]+)\/listings\/([^/]+)\/history$/);
      if (historyRoute && method === 'GET') {
        const workspaceId = decodeURIComponent(historyRoute[1]);
        const listingId = decodeURIComponent(historyRoute[2]);
        await requireMembership(pool, actor.user.id, workspaceId);
        const exists = await pool.query('SELECT 1 FROM competitor_listings WHERE id=$1 AND workspace_id=$2', [listingId,workspaceId]);
        if (exists.rowCount !== 1) throw new HttpError(404, 'Listing not found', 'NOT_FOUND');
        const observations = await pool.query(`
          SELECT id,crawl_run_id,verified_at,currency,price::text,stock_status,seller_name,source_method,confidence::text
          FROM price_observations WHERE competitor_listing_id=$1 AND workspace_id=$2
          ORDER BY verified_at DESC,id DESC
        `, [listingId,workspaceId]);
        const changes = await pool.query(`
          SELECT id,observation_id,previous_observation_id,type,previous_value,current_value,created_at
          FROM change_events WHERE listing_id=$1 AND workspace_id=$2 ORDER BY created_at DESC,id DESC
        `, [listingId,workspaceId]);
        return json(res, 200, {
          observations:observations.rows.map((row) => ({
            id:row.id,crawlRunId:row.crawl_run_id,verifiedAt:row.verified_at,currency:row.currency,
            price:Number(row.price),stockStatus:row.stock_status,sellerName:row.seller_name,
            sourceMethod:row.source_method,confidence:Number(row.confidence),
          })),
          changes:changes.rows.map((row) => ({
            id:row.id,observationId:row.observation_id,previousObservationId:row.previous_observation_id,
            type:row.type,previousValue:row.previous_value,currentValue:row.current_value,createdAt:row.created_at,
          })),
        });
      }

      const crawlStatusRoute = path.match(/^\/v1\/workspaces\/([^/]+)\/crawls\/([^/]+)$/);
      if (crawlStatusRoute && method === 'GET') {
        const workspaceId = decodeURIComponent(crawlStatusRoute[1]);
        const crawlRunId = decodeURIComponent(crawlStatusRoute[2]);
        await requireMembership(pool, actor.user.id, workspaceId);
        const result = await pool.query<{id:string;status:string;attempt:number;started_at:Date|null;finished_at:Date|null;failure_code:string|null}>(`
          SELECT id,status,attempt,started_at,finished_at,failure_code
          FROM crawl_runs WHERE id=$1 AND workspace_id=$2
        `, [crawlRunId,workspaceId]);
        const row = result.rows[0];
        if (!row) throw new HttpError(404, 'Crawl run not found', 'NOT_FOUND');
        return json(res, 200, { crawl:{
          id:row.id,
          status:row.status === 'QUEUED' ? 'RUNNING' : row.status,
          phase:row.status,
          attempt:row.attempt,
          startedAt:row.started_at,
          finishedAt:row.finished_at,
          failureCode:row.failure_code,
        } });
      }

      const crawlRoute = path.match(/^\/v1\/workspaces\/([^/]+)\/listings\/([^/]+)\/crawl$/);
      if (crawlRoute && method === 'POST') {
        const workspaceId = decodeURIComponent(crawlRoute[1]);
        const listingId = decodeURIComponent(crawlRoute[2]);
        await requireMembership(pool, actor.user.id, workspaceId);
        const result = await pool.query<{product_id:string;url:string}>(
          'SELECT product_id,url FROM competitor_listings WHERE id=$1 AND workspace_id=$2', [listingId,workspaceId],
        );
        const listing = result.rows[0];
        if (!listing) throw new HttpError(404, 'Listing not found', 'NOT_FOUND');
        const crawlRunId = `run_${randomUUID()}`;
        const jobKey = `manual:${listingId}:${crawlRunId}`;
        await pool.query(`
          INSERT INTO crawl_runs(id,job_key,workspace_id,listing_id,status,attempt,started_at)
          VALUES($1,$2,$3,$4,'QUEUED',0,NULL)
        `, [crawlRunId,jobKey,workspaceId,listingId]);
        try {
          const job = await enqueueCrawl(queue, { workspaceId,productId:listing.product_id,listingId,url:listing.url,crawlRunId,jobKey });
          return json(res, 202, { crawl:{ crawlRunId,jobKey,queueJobId:job.id,status:'RUNNING' } });
        } catch (error) {
          await pool.query(`
            UPDATE crawl_runs SET status='FAILED',finished_at=now(),failure_code='QUEUE_ENQUEUE_FAILED'
            WHERE id=$1 AND workspace_id=$2
          `, [crawlRunId,workspaceId]);
          throw new HttpError(503, 'Unable to enqueue crawl', 'QUEUE_ENQUEUE_FAILED');
        }
      }

      throw new HttpError(404, 'Route not found', 'NOT_FOUND');
    } catch (error) {
      if (error instanceof HttpError) {
        const headers: Record<string,string> = {};
        if (error.retryAfterSeconds) headers['retry-after'] = String(error.retryAfterSeconds);
        return json(res, error.status, { error:{ code:error.code,message:error.message } }, headers);
      }
      console.error('api_request_failed', error);
      return json(res, 500, { error:{ code:'INTERNAL_ERROR',message:'Internal server error' } });
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
      await new Promise<void>((resolve,reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
