import test from 'node:test';
import assert from 'node:assert/strict';
import { QueueEvents } from 'bullmq';
import { createFixtureServer } from '../../apps/fixture-server/src/server.ts';
import { createApiServer } from '../../apps/api/src/server.ts';
import { migrateApplication, truncateApplication } from '../../apps/api/src/storage.ts';
import { createDatabasePool } from '../../packages/db/src/index.ts';
import {
  CRAWL_QUEUE_NAME,
  createCrawlQueue,
  createCrawlWorker,
  redisConnectionFromUrl,
} from '../../packages/jobs/src/crawl-queue.ts';
import { buildCrawlProcessor } from '../../packages/jobs/src/worker.ts';

interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
}

async function api<T = Record<string, unknown>>(
  base: string,
  path: string,
  input: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const response = await fetch(`${base}${path}`, {
    method: input.method ?? 'GET',
    headers: {
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  return { status: response.status, body: await response.json() as T };
}

async function register(base: string, email: string) {
  const result = await api<{token:string;user:{id:string;email:string}}>(base, '/v1/auth/register', {
    method:'POST', body:{ email, password:'correct horse battery staple' },
  });
  assert.equal(result.status, 201);
  return result.body;
}

async function waitForQueueJob(queue: ReturnType<typeof createCrawlQueue>, events: QueueEvents, jobId: string) {
  const job = await queue.getJob(jobId);
  assert.ok(job, `queue job ${jobId} should exist`);
  return job.waitUntilFinished(events, 15_000);
}

test('API enforces owner/member workspace authorization server-side', async (t) => {
  const pool = createDatabasePool();
  const queueName = `${CRAWL_QUEUE_NAME}-authz-${Date.now()}`;
  const queue = createCrawlQueue(undefined, queueName);
  const apiServer = createApiServer({ pool, queue });
  const base = await apiServer.listen();
  t.after(async () => { await apiServer.close(); await queue.close(); await pool.end(); });

  await migrateApplication(pool);
  await truncateApplication(pool);

  const owner = await register(base, 'owner@example.com');
  const member = await register(base, 'member@example.com');
  const outsider = await register(base, 'outsider@example.com');

  const workspaceResult = await api<{workspace:{id:string;role:string}}>(base, '/v1/workspaces', {
    method:'POST', token:owner.token, body:{ name:'Acme' },
  });
  assert.equal(workspaceResult.status, 201);
  assert.equal(workspaceResult.body.workspace.role, 'OWNER');
  const workspaceId = workspaceResult.body.workspace.id;

  const addMember = await api(base, `/v1/workspaces/${workspaceId}/members`, {
    method:'POST', token:owner.token, body:{ email:'member@example.com', role:'MEMBER' },
  });
  assert.equal(addMember.status, 201);

  const memberCreatesProduct = await api(base, `/v1/workspaces/${workspaceId}/products`, {
    method:'POST', token:member.token, body:{ sku:'MEMBER-1', title:'Member Product', currency:'USD' },
  });
  assert.equal(memberCreatesProduct.status, 201, 'member should be allowed to operate within an assigned workspace');

  const memberManagesMembership = await api(base, `/v1/workspaces/${workspaceId}/members`, {
    method:'POST', token:member.token, body:{ email:'outsider@example.com' },
  });
  assert.equal(memberManagesMembership.status, 403, 'only OWNER may manage workspace membership');

  const outsiderReads = await api(base, `/v1/workspaces/${workspaceId}/products`, { token:outsider.token });
  assert.equal(outsiderReads.status, 403, 'valid user outside workspace must be forbidden');

  const unauthenticated = await api(base, `/v1/workspaces/${workspaceId}/products`);
  assert.equal(unauthenticated.status, 401);
});

test('API-backed PriceIntel vertical: register -> catalog -> queue -> worker -> current/history -> failure honesty', async (t) => {
  const pool = createDatabasePool();
  await migrateApplication(pool);
  await truncateApplication(pool);

  const fixture = createFixtureServer({ price:100, stock:true });
  const fixtureBase = await fixture.listen();
  const queueName = `${CRAWL_QUEUE_NAME}-api-${Date.now()}`;
  const queue = createCrawlQueue(undefined, queueName);
  const events = new QueueEvents(queueName, { connection: redisConnectionFromUrl() });
  await events.waitUntilReady();

  const fetchHtml = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code:`HTTP_${response.status}` });
    return { html:await response.text(), finalUrl:response.url };
  };
  const worker = createCrawlWorker(buildCrawlProcessor(pool, fetchHtml), undefined, { queueName });
  await worker.waitUntilReady();

  const apiServer = createApiServer({ pool, queue });
  const base = await apiServer.listen();
  t.after(async () => {
    await apiServer.close();
    await worker.close();
    await events.close();
    await queue.close();
    await fixture.close();
    await pool.end();
  });

  await register(base, 'operator@example.com');
  const login = await api<{token:string}>(base, '/v1/auth/login', {
    method:'POST', body:{ email:'operator@example.com', password:'correct horse battery staple' },
  });
  assert.equal(login.status, 200, 'registered user should be able to log in with hashed password verification');
  const token = login.body.token;

  const workspaceResult = await api<{workspace:{id:string}}>(base, '/v1/workspaces', {
    method:'POST', token, body:{ name:'Acme Audio' },
  });
  assert.equal(workspaceResult.status, 201);
  const workspaceId = workspaceResult.body.workspace.id;

  const productResult = await api<{product:{id:string}}>(base, `/v1/workspaces/${workspaceId}/products`, {
    method:'POST', token, body:{ sku:'ACME-HEAD-1', title:'Acme Headphones', currency:'USD', currentPrice:109 },
  });
  assert.equal(productResult.status, 201);
  const productId = productResult.body.product.id;

  const listingResult = await api<{listing:{id:string}}>(base, `/v1/workspaces/${workspaceId}/products/${productId}/listings`, {
    method:'POST', token, body:{ url:`${fixtureBase}/product/jsonld`, retailer:'fixture.local' },
  });
  assert.equal(listingResult.status, 201);
  const listingId = listingResult.body.listing.id;

  const trigger1 = await api<{crawl:{queueJobId:string}}>(base, `/v1/workspaces/${workspaceId}/listings/${listingId}/crawl`, {
    method:'POST', token,
  });
  assert.equal(trigger1.status, 202);
  await waitForQueueJob(queue, events, trigger1.body.crawl.queueJobId);

  const current1 = await api<{listing:{currentPrice:number;health:string;lastSuccessfulCrawlAt:string;lastCrawlAt:string}}>(
    base, `/v1/workspaces/${workspaceId}/listings/${listingId}`, { token },
  );
  assert.equal(current1.status, 200);
  assert.equal(current1.body.listing.currentPrice, 100);
  assert.equal(current1.body.listing.health, 'HEALTHY');
  const firstSuccessAt = current1.body.listing.lastSuccessfulCrawlAt;

  fixture.setState({ price:90 });
  const trigger2 = await api<{crawl:{queueJobId:string}}>(base, `/v1/workspaces/${workspaceId}/listings/${listingId}/crawl`, {
    method:'POST', token,
  });
  await waitForQueueJob(queue, events, trigger2.body.crawl.queueJobId);

  const current2 = await api<{listing:{currentPrice:number;health:string;lastSuccessfulCrawlAt:string}}>(
    base, `/v1/workspaces/${workspaceId}/listings/${listingId}`, { token },
  );
  assert.equal(current2.body.listing.currentPrice, 90);
  assert.equal(current2.body.listing.health, 'HEALTHY');
  assert.notEqual(current2.body.listing.lastSuccessfulCrawlAt, firstSuccessAt);
  const secondSuccessAt = current2.body.listing.lastSuccessfulCrawlAt;

  const history = await api<{
    observations:Array<{price:number}>;
    changes:Array<{type:string;previousValue:number;currentValue:number}>;
  }>(base, `/v1/workspaces/${workspaceId}/listings/${listingId}/history`, { token });
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.observations.map((item) => item.price), [90,100]);
  const priceChanges = history.body.changes.filter((change) => change.type === 'PRICE_CHANGED');
  assert.equal(priceChanges.length, 1);
  assert.equal(Number(priceChanges[0].previousValue), 100);
  assert.equal(Number(priceChanges[0].currentValue), 90);

  fixture.setState({ malformed:true });
  const trigger3 = await api<{crawl:{queueJobId:string}}>(base, `/v1/workspaces/${workspaceId}/listings/${listingId}/crawl`, {
    method:'POST', token,
  });
  await assert.rejects(waitForQueueJob(queue, events, trigger3.body.crawl.queueJobId), /PARSE_FAILED|No valid structured product candidate/i);

  const failedState = await api<{listing:{
    currentPrice:number;health:string;lastSuccessfulCrawlAt:string;lastCrawlAt:string;failureCount:number;
  }}>(base, `/v1/workspaces/${workspaceId}/listings/${listingId}`, { token });
  assert.equal(failedState.body.listing.currentPrice, 90, 'failed crawl must preserve last verified price');
  assert.equal(failedState.body.listing.health, 'PARSE_FAILED');
  assert.equal(failedState.body.listing.lastSuccessfulCrawlAt, secondSuccessAt, 'failure must not advance last successful verification');
  assert.ok(new Date(failedState.body.listing.lastCrawlAt) >= new Date(secondSuccessAt), 'last crawl should reflect the newer failed attempt');
  assert.ok(failedState.body.listing.failureCount >= 1);

  const historyAfterFailure = await api<{observations:Array<unknown>;changes:Array<unknown>}>(
    base, `/v1/workspaces/${workspaceId}/listings/${listingId}/history`, { token },
  );
  assert.equal(historyAfterFailure.body.observations.length, 2, 'failed crawl must not append fake observation');
  assert.equal(historyAfterFailure.body.changes.length, 1, 'failed crawl must not fabricate a change event');
});
