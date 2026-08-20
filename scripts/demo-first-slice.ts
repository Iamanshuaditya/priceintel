import { createFixtureServer } from '../apps/fixture-server/src/server.ts';
import { crawlStructuredProduct } from '../packages/crawler-core/src/crawl.ts';
import { InMemoryMonitoringStore } from '../packages/domain/src/index.ts';

const fixture = createFixtureServer({ price: 100 });
const base = await fixture.listen();
const fetchHtml = async (url: string) => { const r = await fetch(url); return { html: await r.text(), finalUrl: r.url }; };
const store = new InMemoryMonitoringStore();
store.createWorkspace({id:'demo',name:'Acme Audio'});
store.createProduct('demo',{id:'p1',workspaceId:'demo',sku:'HEAD-1',title:'Headphones',currentPrice:109,currency:'USD'});
store.createListing('demo',{id:'l1',workspaceId:'demo',productId:'p1',url:`${base}/product/jsonld`,retailer:'fixture.local',health:'STALE',failureCount:0});

for (const [run, price] of [['r1',100],['r2',90]] as const) {
  fixture.setState({price});
  const observation = await crawlStructuredProduct({workspaceId:'demo',productId:'p1',listingId:'l1',url:`${base}/product/jsonld`,crawlRunId:run}, fetchHtml);
  store.recordSuccessfulObservation('demo', observation);
}
console.log(JSON.stringify({ listing:store.getListing('demo','l1'), observations:store.getObservations('demo','l1'), changes:store.getChanges('demo','l1') }, null, 2));
await fixture.close();
