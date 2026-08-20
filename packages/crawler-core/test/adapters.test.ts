import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWithAdapters, selectAdapterCandidate } from '../src/adapters/registry.ts';
import { shopifyAdapter } from '../src/adapters/shopify.ts';
import type { FetchArtifact } from '../src/adapters/types.ts';

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
