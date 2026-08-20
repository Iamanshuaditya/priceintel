import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonLdCandidates, parsePriceUSFirst, selectValidatedCandidate } from '../src/jsonld.ts';

function page(offer: string) { return `<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"X","offers":${offer}}</script></html>`; }

test('extracts normalized JSON-LD price, currency, stock and seller', () => {
  const [candidate] = extractJsonLdCandidates(page('{"@type":"Offer","price":"$1,299.90","priceCurrency":"usd","availability":"https://schema.org/InStock","seller":{"name":"Shop"}}'));
  assert.deepEqual(candidate, { price:1299.9, currency:'USD', stockStatus:'IN_STOCK', sellerName:'Shop', sourceMethod:'JSON_LD', confidence:0.95 });
});

test('out of stock is normalized', () => {
  const [candidate] = extractJsonLdCandidates(page('{"@type":"Offer","price":"90.00","priceCurrency":"USD","availability":"https://schema.org/OutOfStock"}'));
  assert.equal(candidate.stockStatus, 'OUT_OF_STOCK');
});

test('missing availability remains UNKNOWN instead of inventing stock', () => {
  const [candidate] = extractJsonLdCandidates(page('{"@type":"Offer","price":"90.00","priceCurrency":"USD"}'));
  assert.equal(candidate.stockStatus, 'UNKNOWN');
});

test('US-first price parser accepts US grouping but rejects comma-decimal ambiguity', () => {
  assert.equal(parsePriceUSFirst('$1,299.99'), 1299.99);
  assert.equal(parsePriceUSFirst('1,299'), 1299);
  assert.equal(parsePriceUSFirst('€1.299,99'), undefined);
  assert.equal(parsePriceUSFirst('99,99'), undefined);
});

test('invalid/malformed JSON-LD produces no candidate', () => {
  assert.equal(extractJsonLdCandidates('<script type="application/ld+json">{broken</script>').length, 0);
});

test('disagreement is explicit rather than arbitrary', () => {
  const candidates = extractJsonLdCandidates(page('[{"@type":"Offer","price":"90","priceCurrency":"USD"},{"@type":"Offer","price":"91","priceCurrency":"USD"}]'));
  assert.throws(() => selectValidatedCandidate(candidates), (error: unknown) => (error as {code?:string}).code === 'CANDIDATE_DISAGREEMENT');
});
