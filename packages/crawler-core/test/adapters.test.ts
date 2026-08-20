import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWithAdapterSupplements, extractWithAdapters, selectAdapterCandidate } from '../src/adapters/registry.ts';
import { shopifyAdapter } from '../src/adapters/shopify.ts';
import type { FetchArtifact, RetailerAdapter } from '../src/adapters/types.ts';

function artifact(url: string, html: string): FetchArtifact {
  return {
    requestedUrl: url,
    finalUrl: url,
    html,
    fetchedAt: new Date('2026-08-20T00:00:00Z'),
    status: 200,
    contentType: 'text/html',
    bytesDownloaded: Buffer.byteLength(html),
  };
}

function jsonLd(price: number, availability = 'https://schema.org/InStock') {
  return `<script type="application/ld+json">${JSON.stringify({
    '@context':'https://schema.org',
    '@type':'Product',
    offers:{ '@type':'Offer', price, priceCurrency:'USD', availability },
  })}</script>`;
}

test('generic structured extraction is now an adapter with explicit provenance', () => {
  const result = extractWithAdapters(artifact('https://example.com/products/widget', jsonLd(100)));
  const selected = selectAdapterCandidate(result.candidates);
  assert.equal(selected.price, 100);
  assert.equal(selected.provenance.adapterId, 'generic-jsonld');
  assert.equal(selected.provenance.adapterVersion, '1.0.0');
  assert.equal(selected.provenance.sourcePath, 'script[type="application/ld+json"]');
});

test('Shopify adapter handles conservative non-varying theme product JSON', () => {
  const html = `
    <meta property="og:price:currency" content="USD">
    <script>window.Shopify = {}; Shopify.theme = {name:'fixture'};</script>
    <script type="application/json" id="ProductJson-product-template">${JSON.stringify({
      title:'Theme Widget', vendor:'Fixture Vendor', price:12900, price_varies:false, available:true,
      variants:[{price:12900,available:true},{price:12900,available:true}],
    })}</script>`;
  const selected = selectAdapterCandidate(extractWithAdapters(artifact('https://fixture-shop.example/products/widget', html)).candidates);
  assert.equal(selected.price, 129);
  assert.equal(selected.stockStatus, 'IN_STOCK');
  assert.equal(selected.sellerName, 'Fixture Vendor');
  assert.equal(selected.sourceMethod, 'RETAILER_ADAPTER');
  assert.equal(selected.provenance.adapterId, 'shopify');
});

test('Shopify theme product JSON refuses a varying-variant root price', () => {
  const html = `
    <meta property="og:price:currency" content="USD">
    <script>Shopify.theme = {name:'fixture'};</script>
    <script type="application/json" id="ProductJson-product-template">${JSON.stringify({
      price:1000, price_varies:true, available:true,
      variants:[{price:1000,available:true},{price:2000,available:true}],
    })}</script>`;
  assert.equal(shopifyAdapter.extract(artifact('https://fixture-shop.example/products/widget', html)).length, 0);
});

test('Shopify 1.1 uses bounded same-origin product Ajax JSON when primary HTML has no candidate', async () => {
  const primary = artifact(
    'https://fixture-shop.example/en/products/widget',
    '<meta property="og:price:currency" content="USD"><script>Shopify.theme={name:"fixture"}</script>',
  );
  const seen: string[] = [];
  const result = await extractWithAdapterSupplements(primary, async (request) => {
    seen.push(request.url);
    const body = JSON.stringify({
      vendor:'Fixture Vendor',
      price:12900,
      price_varies:false,
      available:true,
      variants:[{id:1,price:12900,available:true},{id:2,price:12900,available:true}],
    });
    return artifact(request.url, body);
  });
  const selected = selectAdapterCandidate(result.candidates);
  assert.deepEqual(seen, ['https://fixture-shop.example/en/products/widget.js']);
  assert.equal(selected.price, 129);
  assert.equal(selected.currency, 'USD');
  assert.equal(selected.provenance.adapterId, 'shopify');
  assert.equal(selected.provenance.adapterVersion, '1.1.0');
  assert.match(selected.provenance.sourcePath, /products\/\{handle\}\.js/);
});

test('Shopify Ajax fallback refuses ambiguous variant prices without an explicit variant', async () => {
  const primary = artifact(
    'https://fixture-shop.example/products/widget',
    '<meta property="og:price:currency" content="USD"><script>Shopify.theme={}</script>',
  );
  const result = await extractWithAdapterSupplements(primary, async (request) => artifact(request.url, JSON.stringify({
    price:1000,
    price_varies:true,
    variants:[{id:11,price:1000,available:true},{id:22,price:2000,available:true}],
  })));
  assert.throws(() => selectAdapterCandidate(result.candidates), (error: unknown) => (error as {code?:string}).code === 'PARSE_FAILED');
});

test('Shopify Ajax fallback may select an explicitly requested variant', async () => {
  const primary = artifact(
    'https://fixture-shop.example/products/widget?variant=22',
    '<meta property="og:price:currency" content="USD"><script>Shopify.theme={}</script>',
  );
  const result = await extractWithAdapterSupplements(primary, async (request) => artifact(request.url, JSON.stringify({
    price:1000,
    price_varies:true,
    variants:[{id:11,price:1000,available:true},{id:22,price:2000,available:false}],
  })));
  const selected = selectAdapterCandidate(result.candidates);
  assert.equal(selected.price, 20);
  assert.equal(selected.stockStatus, 'OUT_OF_STOCK');
  assert.match(selected.provenance.sourcePath, /variant=22/);
});

test('supplementary architecture enforces maximum request count and same-origin by default', async () => {
  const custom: RetailerAdapter = {
    id:'supp-test', version:'1', priority:1000,
    canHandle:()=>true,
    extract:()=>[],
    supplementaryRequests:()=>[
      {id:'one',url:'https://example.com/one',purpose:'one'},
      {id:'two',url:'https://example.com/two',purpose:'two'},
      {id:'three',url:'https://example.com/three',purpose:'three'},
    ],
    extractSupplementary:()=>[],
  };
  let calls = 0;
  const result = await extractWithAdapterSupplements(
    artifact('https://example.com/products/widget', '<html></html>'),
    async (request) => { calls += 1; return artifact(request.url, '{}'); },
    [custom],
  );
  assert.equal(calls, 2);
  assert.equal(result.supplementaryAttempts?.length, 2);

  const crossOrigin: RetailerAdapter = {
    ...custom,
    supplementaryRequests:()=>[{id:'bad',url:'https://evil.example/data',purpose:'bad'}],
  };
  let crossCalls = 0;
  const blocked = await extractWithAdapterSupplements(
    artifact('https://example.com/products/widget', '<html></html>'),
    async (request) => { crossCalls += 1; return artifact(request.url, '{}'); },
    [crossOrigin],
  );
  assert.equal(crossCalls, 0);
  assert.equal(blocked.supplementaryAttempts?.[0]?.errorCode, 'SUPPLEMENTARY_ORIGIN_BLOCKED');
});

test('Walmart adapter prefers embedded current product price over lower-confidence structured financing-like value', () => {
  const nextData = {
    props:{ pageProps:{ initialData:{ data:{ product:{
      priceInfo:{ currentPrice:{ price:499, currencyUnit:'USD' } },
      availabilityStatus:'IN_STOCK',
      sellerDisplayName:'Walmart.com',
    } } } } },
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>${jsonLd(49)}`;
  const result = extractWithAdapters(artifact('https://www.walmart.com/ip/fixture/123', html));
  const selected = selectAdapterCandidate(result.candidates);
  assert.equal(selected.price, 499);
  assert.equal(selected.stockStatus, 'IN_STOCK');
  assert.equal(selected.provenance.adapterId, 'walmart');
  assert.ok(result.attempts.some((attempt) => attempt.adapterId === 'generic-jsonld' && attempt.matched));
});

test('Best Buy adapter can use itemprop metadata when structured data is absent', () => {
  const html = `
    <meta itemprop="price" content="89.99">
    <meta itemprop="priceCurrency" content="USD">
    <link itemprop="availability" href="https://schema.org/InStock">`;
  const selected = selectAdapterCandidate(extractWithAdapters(artifact('https://www.bestbuy.com/site/fixture/123.p', html)).candidates);
  assert.equal(selected.price, 89.99);
  assert.equal(selected.stockStatus, 'IN_STOCK');
  assert.equal(selected.provenance.adapterId, 'bestbuy');
  assert.equal(selected.sourceMethod, 'RETAILER_ADAPTER');
});
