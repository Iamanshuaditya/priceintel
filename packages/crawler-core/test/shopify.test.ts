import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWithAdapterSupplements, extractWithAdapters, selectAdapterCandidate } from '../src/adapters/registry.ts';
import { shopifyAdapter } from '../src/adapters/shopify.ts';
import type { FetchArtifact } from '../src/adapters/types.ts';

function artifact(url: string, html: string): FetchArtifact {
  return {
    requestedUrl:url,
    finalUrl:url,
    html,
    fetchedAt:new Date('2026-08-20T00:00:00Z'),
    status:200,
    contentType:'text/html',
    bytesDownloaded:Buffer.byteLength(html),
  };
}

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
  assert.equal(selected.provenance.adapterId, 'shopify');
});

test('Shopify theme product JSON refuses varying variant prices', () => {
  const html = `
    <meta property="og:price:currency" content="USD">
    <script>Shopify.theme = {name:'fixture'};</script>
    <script type="application/json" id="ProductJson-product-template">${JSON.stringify({
      price:1000, price_varies:true, available:true,
      variants:[{price:1000,available:true},{price:2000,available:true}],
    })}</script>`;
  assert.equal(shopifyAdapter.extract(artifact('https://fixture-shop.example/products/widget', html)).length, 0);
});

test('Shopify OpenGraph price alone is not a product observation', () => {
  const html = `
    <meta property="og:price:amount" content="14.98">
    <meta property="og:price:currency" content="USD">
    <script>Shopify.theme={name:'fixture'}</script>`;
  assert.equal(shopifyAdapter.extract(artifact('https://fixture-shop.example/products/widget', html)).length, 0);
});

test('Shopify 1.2 uses bounded same-origin product Ajax JSON when primary has no candidate', async () => {
  const primary = artifact(
    'https://fixture-shop.example/en/products/widget',
    '<meta property="og:price:currency" content="USD"><script>Shopify.theme={name:"fixture"}</script>',
  );
  const seen: string[] = [];
  const result = await extractWithAdapterSupplements(primary, async (request) => {
    seen.push(request.url);
    return artifact(request.url, JSON.stringify({
      vendor:'Fixture Vendor', price:12900, price_varies:false, available:true,
      variants:[{id:1,price:12900,available:true},{id:2,price:12900,available:true}],
    }));
  });
  const selected = selectAdapterCandidate(result.candidates);
  assert.deepEqual(seen, ['https://fixture-shop.example/en/products/widget.js']);
  assert.equal(selected.price, 129);
  assert.equal(selected.currency, 'USD');
  assert.equal(selected.provenance.adapterId, 'shopify');
  assert.equal(selected.provenance.adapterVersion, '1.2.0');
  assert.match(selected.provenance.sourcePath, /products\/\{handle\}\.js/);
});

test('Shopify supplementary evidence can resolve a primary disagreement', async () => {
  const primary = artifact(
    'https://fixture-shop.example/products/widget',
    `<meta property="og:price:currency" content="USD"><script>Shopify.theme={}</script>
     <script type="application/ld+json">${JSON.stringify({
       '@context':'https://schema.org', '@type':'Product',
       offers:[
         {'@type':'Offer',price:10,priceCurrency:'USD',availability:'https://schema.org/InStock'},
         {'@type':'Offer',price:20,priceCurrency:'USD',availability:'https://schema.org/InStock'},
       ],
     })}</script>`,
  );
  const seen: string[] = [];
  const result = await extractWithAdapterSupplements(primary, async (request) => {
    seen.push(request.url);
    return artifact(request.url, JSON.stringify({
      price:1500, price_varies:false, available:true,
      variants:[{id:1,price:1500,available:true}],
    }));
  });
  const selected = selectAdapterCandidate(result.candidates);
  assert.deepEqual(seen, ['https://fixture-shop.example/products/widget.js']);
  assert.equal(selected.price, 15);
  assert.equal(selected.provenance.adapterVersion, '1.2.0');
});

test('Shopify Ajax refuses ambiguous variant prices without explicit variant', async () => {
  const primary = artifact(
    'https://fixture-shop.example/products/widget',
    '<meta property="og:price:currency" content="USD"><script>Shopify.theme={}</script>',
  );
  const result = await extractWithAdapterSupplements(primary, async (request) => artifact(request.url, JSON.stringify({
    price:1000, price_varies:true,
    variants:[{id:11,price:1000,available:true},{id:22,price:2000,available:true}],
  })));
  assert.throws(() => selectAdapterCandidate(result.candidates), (error: unknown) => (error as {code?:string}).code === 'PARSE_FAILED');
});

test('Shopify Ajax may select explicitly requested variant', async () => {
  const primary = artifact(
    'https://fixture-shop.example/products/widget?variant=22',
    '<meta property="og:price:currency" content="USD"><script>Shopify.theme={}</script>',
  );
  const result = await extractWithAdapterSupplements(primary, async (request) => artifact(request.url, JSON.stringify({
    price:1000, price_varies:true,
    variants:[{id:11,price:1000,available:true},{id:22,price:2000,available:false}],
  })));
  const selected = selectAdapterCandidate(result.candidates);
  assert.equal(selected.price, 20);
  assert.equal(selected.stockStatus, 'OUT_OF_STOCK');
  assert.match(selected.provenance.sourcePath, /variant=22/);
});
