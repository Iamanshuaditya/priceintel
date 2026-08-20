import { availabilityToStockStatus, extractJsonLdCandidates, parsePriceUSFirst } from '../jsonld.ts';
import type { AdapterCandidate, RetailerAdapter } from './types.ts';
import { withProvenance } from './types.ts';
import { attrValue, hostnameOf } from './helpers.ts';

function itemPropCandidate(html: string, adapter: RetailerAdapter): AdapterCandidate[] {
  const rawPrice = attrValue(html, 'meta', 'itemprop', 'price', 'content');
  const rawCurrency = attrValue(html, 'meta', 'itemprop', 'priceCurrency', 'content')
    ?? attrValue(html, 'meta', 'property', 'og:price:currency', 'content');
  const price = parsePriceUSFirst(rawPrice);
  const currency = rawCurrency?.trim().toUpperCase();
  if (price === undefined || !currency || !/^[A-Z]{3}$/.test(currency)) return [];
  const availability = attrValue(html, 'link', 'itemprop', 'availability', 'href')
    ?? attrValue(html, 'meta', 'itemprop', 'availability', 'content');
  return [{
    price,
    currency,
    stockStatus: availabilityToStockStatus(availability),
    sourceMethod: 'RETAILER_ADAPTER',
    confidence: 0.92,
    provenance: {
      adapterId: adapter.id,
      adapterVersion: adapter.version,
      sourcePath: 'meta[itemprop="price"]',
    },
  }];
}

export const bestBuyAdapter: RetailerAdapter = {
  id: 'bestbuy',
  version: '1.0.0',
  priority: 90,
  canHandle(artifact) {
    const host = hostnameOf(artifact.finalUrl);
    return host === 'bestbuy.com' || host.endsWith('.bestbuy.com');
  },
  extract(artifact) {
    const structured = extractJsonLdCandidates(artifact.html).map((candidate) => ({
      ...withProvenance(candidate, bestBuyAdapter, 'script[type="application/ld+json"]'),
      confidence: Math.max(candidate.confidence, 0.97),
    }));
    return [...structured, ...itemPropCandidate(artifact.html, bestBuyAdapter)];
  },
};
