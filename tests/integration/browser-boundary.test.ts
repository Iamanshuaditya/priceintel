import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../../apps/api/src/server.ts';
import { migrateApplication, truncateApplication } from '../../apps/api/src/storage.ts';
import { createDatabasePool } from '../../packages/db/src/index.ts';
import { CRAWL_QUEUE_NAME, createCrawlQueue } from '../../packages/jobs/src/crawl-queue.ts';

async function jsonRequest(base: string, path: string, input: {
  method?: string;
  body?: unknown;
  cookie?: string;
  origin?: string;
} = {}) {
  const response = await fetch(`${base}${path}`, {
    method:input.method ?? 'GET',
    headers:{
      ...(input.cookie ? { cookie:input.cookie } : {}),
      ...(input.origin ? { origin:input.origin } : {}),
      ...(input.body === undefined ? {} : { 'content-type':'application/json' }),
    },
    body:input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const body = await response.json() as Record<string, unknown>;
  return { response, body };
}

function cookiePair(setCookie: string | null) {
  assert.ok(setCookie, 'browser auth should set a session cookie');
  return setCookie.split(';', 1)[0];
}

test('browser cookie session is HttpOnly, CSRF-protected, revocable, rate-limited, and can use listing/crawl status APIs', async (t) => {
  const pool = createDatabasePool();
  await migrateApplication(pool);
  await truncateApplication(pool);
  const queueName = `${CRAWL_QUEUE_NAME}-browser-boundary-${Date.now()}`;
  const queue = createCrawlQueue(undefined, queueName);
  const app = createApiServer({
    pool,
    queue,
    secureCookies:false,
    authRateLimits:{ register:{ ipLimit:3,emailLimit:3,windowMs:60_000 } },
  });
  const base = await app.listen();
  t.after(async () => { await app.close(); await queue.close(); await pool.end(); });

  const register = await jsonRequest(base, '/v1/auth/register', {
    method:'POST', origin:base, body:{
      email:'browser@example.com', password:'correct horse battery staple', sessionTransport:'cookie',
    },
  });
  assert.equal(register.response.status, 201);
  assert.equal('token' in register.body, false, 'cookie transport must not expose raw bearer token in JSON');
  const setCookie = register.response.headers.get('set-cookie');
  assert.match(setCookie ?? '', /priceintel_session=/);
  assert.match(setCookie ?? '', /HttpOnly/i);
  assert.match(setCookie ?? '', /SameSite=Lax/i);
  const cookie = cookiePair(setCookie);

  const me = await jsonRequest(base, '/v1/me', { cookie });
  assert.equal(me.response.status, 200, 'HttpOnly cookie should authenticate reads without bearer header');

  const csrfRejected = await jsonRequest(base, '/v1/workspaces', {
    method:'POST', cookie, origin:'https://evil.example', body:{ name:'Should Not Exist' },
  });
  assert.equal(csrfRejected.response.status, 403);
  assert.equal((csrfRejected.body.error as {code:string}).code, 'CSRF_REJECTED');

  const workspaceResult = await jsonRequest(base, '/v1/workspaces', {
    method:'POST', cookie, origin:base, body:{ name:'Browser Acme' },
  });
  assert.equal(workspaceResult.response.status, 201);
  const workspaceId = (workspaceResult.body.workspace as {id:string}).id;

  const productResult = await jsonRequest(base, `/v1/workspaces/${workspaceId}/products`, {
    method:'POST', cookie, origin:base, body:{ sku:'BROWSER-1',title:'Browser Product',currency:'USD',currentPrice:109 },
  });
  assert.equal(productResult.response.status, 201);
  const productId = (productResult.body.product as {id:string}).id;

  const listingResult = await jsonRequest(base, `/v1/workspaces/${workspaceId}/products/${productId}/listings`, {
    method:'POST', cookie, origin:base, body:{ retailer:'Fixture',url:'https://example.com/product',marketCountry:'US',locale:'en-US' },
  });
  assert.equal(listingResult.response.status, 201);
  const createdListing = listingResult.body.listing as {
    id:string;expectedCurrency:string;marketCountry:string|null;locale:string|null;
  };
  const listingId = createdListing.id;
  assert.equal(createdListing.expectedCurrency, 'USD', 'listing market currency should default from the product');
  assert.equal(createdListing.marketCountry, 'US');
  assert.equal(createdListing.locale, 'en-US');

  const listings = await jsonRequest(base, `/v1/workspaces/${workspaceId}/listings?productId=${productId}`, { cookie });
  assert.equal(listings.response.status, 200);
  const listingRows = listings.body.listings as Array<{id:string;expectedCurrency:string;marketCountry:string|null;locale:string|null}>;
  assert.equal(listingRows.length, 1);
  assert.equal(listingRows[0].id, listingId);
  assert.equal(listingRows[0].expectedCurrency, 'USD');
  assert.equal(listingRows[0].marketCountry, 'US');
  assert.equal(listingRows[0].locale, 'en-US');

  const trigger = await jsonRequest(base, `/v1/workspaces/${workspaceId}/listings/${listingId}/crawl`, {
    method:'POST', cookie, origin:base,
  });
  assert.equal(trigger.response.status, 202);
  const crawl = trigger.body.crawl as {crawlRunId:string;queueJobId:string};
  const crawlRunId = crawl.crawlRunId;
  const queuedJob = await queue.getJob(crawl.queueJobId);
  assert.ok(queuedJob, 'manual crawl should enqueue one durable identity message');
  assert.deepEqual(Object.keys(queuedJob.data).sort(), ['crawlRunId','jobKey','listingId','workspaceId']);

  const crawlStatus = await jsonRequest(base, `/v1/workspaces/${workspaceId}/crawls/${crawlRunId}`, { cookie });
  assert.equal(crawlStatus.response.status, 200);
  assert.equal((crawlStatus.body.crawl as {status:string}).status, 'RUNNING');
  assert.equal((crawlStatus.body.crawl as {phase:string}).phase, 'QUEUED');

  const logout = await jsonRequest(base, '/v1/auth/logout', { method:'POST',cookie,origin:base });
  assert.equal(logout.response.status, 200);
  assert.match(logout.response.headers.get('set-cookie') ?? '', /Max-Age=0/i);
  const afterLogout = await jsonRequest(base, '/v1/me', { cookie });
  assert.equal(afterLogout.response.status, 401, 'logout must revoke the exact persisted session');

  const second = await jsonRequest(base, '/v1/auth/register', {
    method:'POST',origin:base,body:{ email:'second@example.com',password:'correct horse battery staple',sessionTransport:'cookie' },
  });
  assert.equal(second.response.status, 201);
  const third = await jsonRequest(base, '/v1/auth/register', {
    method:'POST',origin:base,body:{ email:'third@example.com',password:'correct horse battery staple',sessionTransport:'cookie' },
  });
  assert.equal(third.response.status, 201);
  const blocked = await jsonRequest(base, '/v1/auth/register', {
    method:'POST',origin:base,body:{ email:'fourth@example.com',password:'correct horse battery staple',sessionTransport:'cookie' },
  });
  assert.equal(blocked.response.status, 429, 'rate limit must reject before unbounded scrypt work');
  assert.equal((blocked.body.error as {code:string}).code, 'RATE_LIMITED');
  assert.ok(Number(blocked.response.headers.get('retry-after')) >= 1);
});
