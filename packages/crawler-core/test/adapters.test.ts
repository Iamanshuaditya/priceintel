import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWithAdapterSupplements, extractWithAdapters, selectAdapterCandidate } from '../src/adapters/registry.ts';
import type { FetchArtifact, RetailerAdapter } from '../src/adapters/types.ts';

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

function jsonLd(price: number, availability = 'https://schema.org/InStock') {
  return `<script type="application/ld+json">${JSON.stringify({
    '@context':'https://schema.org', '@type':'Product',
    offers:{ '@type':'Offer', price, priceCurrency:'USD', availability },
  })}</script>`;
}

test('generic structured extraction has explicit provenance', () => {
  const result = extractWithAdapters(artifact('https://example.com/products/widget', jsonLd(100)));
  const selected = selectAdapterCandidate(result.candidates);
  assert.equal(selected.price, 100);
  assert.equal(selected.provenance.adapterId, 'generic-jsonld');
  assert.equal(selected.provenance.adapterVersion, '1.0.0');
});

test('supplementary architecture enforces maximum request count', async () => {
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
});

test('supplementary requests remain same-origin by default', async () => {
  const custom: RetailerAdapter = {
    id:'origin-test', version:'1', priority:1000,
    canHandle:()=>true,
    extract:()=>[],
    supplementaryRequests:()=>[{id:'cross',url:'https://other.example/data',purpose:'cross-origin fixture'}],
    extractSupplementary:()=>[],
  };
  let calls = 0;
  const result = await extractWithAdapterSupplements(
    artifact('https://example.com/products/widget', '<html></html>'),
    async (request) => { calls += 1; return artifact(request.url, '{}'); },
    [custom],
  );
  assert.equal(calls, 0);
  assert.equal(result.supplementaryAttempts?.[0]?.errorCode, 'SUPPLEMENTARY_ORIGIN_BLOCKED');
});

test('Walmart adapter prefers embedded current product price over lower-confidence structured value', () => {
  const nextData = {
    props:{ pageProps:{ initialData:{ data:{ product:{
      priceInfo:{ currentPrice:{ price:499, currencyUnit:'USD' } },
      availabilityStatus:'IN_STOCK', sellerDisplayName:'Walmart.com',
    } } } } },
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>${jsonLd(49)}`;
  const result = extractWithAdapters(artifact('https://www.walmart.com/ip/fixture/123', html));
  const selected = selectAdapterCandidate(result.candidates);
  assert.equal(selected.price, 499);
  assert.equal(selected.stockStatus, 'IN_STOCK');
  assert.equal(selected.provenance.adapterId, 'walmart');
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
});
