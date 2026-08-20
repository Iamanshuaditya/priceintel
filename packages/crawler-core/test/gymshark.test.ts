import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWithAdapters, selectAdapterCandidate } from '../src/adapters/registry.ts';
import { gymsharkAdapter } from '../src/adapters/gymshark.ts';
import type { FetchArtifact } from '../src/adapters/types.ts';

function artifact(url: string, productData: unknown, extra = ''): FetchArtifact {
  const nextData = { props:{ pageProps:{ productData } } };
  const html = `${extra}<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`;
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

test('Gymshark custom-storefront adapter preserves exact decimal page price and unanimous variant currency', () => {
  const input = artifact('https://www.gymshark.com/products/power-shirt', {
    product:{ price:25.2, compareAtPrice:36, inStock:true },
    variants:[
      { currencyCode:'USD', price:36 },
      { currencyCode:'USD', price:36 },
    ],
  });
  const [candidate] = gymsharkAdapter.extract(input);
  assert.equal(candidate.price, 25.2);
  assert.equal(candidate.currency, 'USD');
  assert.equal(candidate.stockStatus, 'IN_STOCK');
  assert.equal(candidate.provenance.adapterId, 'gymshark');
  assert.equal(candidate.provenance.sourcePath, 'script#__NEXT_DATA__.props.pageProps.productData.product');
});

test('Gymshark adapter refuses ambiguous variant currency', () => {
  const input = artifact('https://row.gymshark.com/products/leggings', {
    product:{ price:49.5, inStock:true },
    variants:[{currencyCode:'USD'},{currencyCode:'EUR'}],
  });
  assert.equal(gymsharkAdapter.extract(input).length, 0);
});

test('Gymshark Next data beats lower-confidence rounded ProductGroup data without changing generic JSON-LD behavior', () => {
  const structured = `<script type="application/ld+json">${JSON.stringify({
    '@context':'https://schema.org',
    '@type':'ProductGroup',
    hasVariant:[
      {'@type':'Product',offers:{'@type':'Offer',price:25,priceCurrency:'USD',availability:'https://schema.org/InStock'}},
      {'@type':'Product',offers:{'@type':'Offer',price:25,priceCurrency:'USD',availability:'https://schema.org/InStock'}},
    ],
  })}</script>`;
  const input = artifact('https://www.gymshark.com/products/power-shirt', {
    product:{ price:25.2, inStock:true },
    variants:[{currencyCode:'USD'},{currencyCode:'USD'}],
  }, structured);
  const result = extractWithAdapters(input);
  const selected = selectAdapterCandidate(result.candidates);
  assert.equal(selected.price, 25.2);
  assert.equal(selected.provenance.adapterId, 'gymshark');
  assert.ok(result.candidates.some((candidate) => candidate.provenance.adapterId === 'generic-jsonld' && candidate.price === 25));
});

test('Gymshark adapter does not claim unrelated Next.js storefronts', () => {
  const input = artifact('https://example.com/products/widget', {
    product:{price:25.2,inStock:true},
    variants:[{currencyCode:'USD'}],
  });
  assert.equal(gymsharkAdapter.canHandle(input), false);
});
