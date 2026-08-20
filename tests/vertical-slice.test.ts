import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureServer } from '../apps/fixture-server/src/server.ts';
import { crawlStructuredProduct } from '../packages/crawler-core/src/crawl.ts';
import { InMemoryMonitoringStore } from '../packages/domain/src/index.ts';

test('first vertical backend spine + price change + failure honesty', async (t) => {
  const fixture = createFixtureServer({ price: 100, stock: true });
  const base = await fixture.listen();
  t.after(async () => fixture.close());

  // Test-only local fetcher. Production `secureFetch` intentionally blocks localhost.
  const fetchHtml = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: `HTTP_${response.status}` });
    return { html: await response.text(), finalUrl: response.url };
  };

  const store = new InMemoryMonitoringStore();
  store.createWorkspace({ id:'ws_1', name:'Acme Audio' });
  store.createProduct('ws_1', { id:'prod_1', workspaceId:'ws_1', sku:'ACME-HEAD-1', title:'Acme Headphones', currentPrice:109, currency:'USD' });
  store.createListing('ws_1', { id:'list_1', workspaceId:'ws_1', productId:'prod_1', url:`${base}/product/jsonld`, retailer:'fixture.local', health:'STALE', failureCount:0 });

  const firstAt = new Date('2026-08-20T01:00:00Z');
  const first = await crawlStructuredProduct({ workspaceId:'ws_1', productId:'prod_1', listingId:'list_1', url:`${base}/product/jsonld`, crawlRunId:'run_1', now:firstAt }, fetchHtml);
  store.recordSuccessfulObservation('ws_1', first);
  assert.equal(first.price, 100);
  assert.equal(first.stockStatus, 'IN_STOCK');
  assert.equal(store.getListing('ws_1','list_1')?.health, 'HEALTHY');
  assert.equal(store.getObservations('ws_1','list_1').length, 1);

  fixture.setState({ price: 90, stock: false });
  const secondAt = new Date('2026-08-20T02:00:00Z');
  const second = await crawlStructuredProduct({ workspaceId:'ws_1', productId:'prod_1', listingId:'list_1', url:`${base}/product/jsonld`, crawlRunId:'run_2', now:secondAt }, fetchHtml);
  store.recordSuccessfulObservation('ws_1', second);
  assert.equal(second.stockStatus, 'OUT_OF_STOCK');
  assert.equal(store.getObservations('ws_1','list_1').length, 2);
  assert.deepEqual(store.getChanges('ws_1','list_1').map((c)=>c.type).sort(), ['PRICE_CHANGED','STOCK_CHANGED']);

  const lastSuccessBeforeFailure = store.getListing('ws_1','list_1')?.lastSuccessfulCrawlAt?.toISOString();
  fixture.setState({ malformed: true });
  const failAt = new Date('2026-08-20T03:00:00Z');
  await assert.rejects(
    crawlStructuredProduct({ workspaceId:'ws_1', productId:'prod_1', listingId:'list_1', url:`${base}/product/jsonld`, crawlRunId:'run_3', now:failAt }, fetchHtml),
    (e: unknown) => (e as {code?:string}).code === 'PARSE_FAILED',
  );
  store.recordFailure('ws_1','list_1',failAt,'PARSE_FAILED','PARSE_FAILED');

  assert.equal(store.getObservations('ws_1','list_1').length, 2, 'failure must not append fake observation');
  assert.equal(store.getListing('ws_1','list_1')?.lastSuccessfulCrawlAt?.toISOString(), lastSuccessBeforeFailure, 'failure must not advance last success');
  assert.equal(store.getListing('ws_1','list_1')?.lastCrawlAt?.toISOString(), failAt.toISOString());
  assert.equal(store.getListing('ws_1','list_1')?.health, 'PARSE_FAILED');
});
