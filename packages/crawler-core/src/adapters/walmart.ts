import { availabilityToStockStatus, extractJsonLdCandidates, parsePriceUSFirst } from '../jsonld.ts';
import type { AdapterCandidate, RetailerAdapter } from './types.ts';
import { withProvenance } from './types.ts';
import { attribute, hostnameOf, objectAtPath, scriptJson } from './helpers.ts';

function nextDataProduct(html: string) {
  const blocks = scriptJson(html, (tag) => attribute(tag, 'id') === '__NEXT_DATA__');
  for (const block of blocks) {
    const paths = [
      ['props','pageProps','initialData','data','product'],
      ['props','pageProps','initialData','product'],
      ['props','pageProps','product'],
    ];
    for (const path of paths) {
      const product = objectAtPath(block, path);
      if (product) return { product, sourcePath:path.join('.') };
    }
  }
  return undefined;
}

function embeddedCandidate(html: string, adapter: RetailerAdapter): AdapterCandidate[] {
  const found = nextDataProduct(html);
  if (!found) return [];
  const priceInfo = found.product.priceInfo && typeof found.product.priceInfo === 'object' && !Array.isArray(found.product.priceInfo)
    ? found.product.priceInfo as Record<string, unknown>
    : undefined;
  const currentPrice = priceInfo?.currentPrice && typeof priceInfo.currentPrice === 'object' && !Array.isArray(priceInfo.currentPrice)
    ? priceInfo.currentPrice as Record<string, unknown>
    : undefined;
  const price = parsePriceUSFirst(currentPrice?.price ?? currentPrice?.priceString);
  if (price === undefined) return [];
  const currencyRaw = String(currentPrice?.currencyUnit ?? currentPrice?.currency ?? 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyRaw)) return [];
  const sellerName = typeof found.product.sellerDisplayName === 'string' && found.product.sellerDisplayName.trim()
    ? found.product.sellerDisplayName.trim()
    : undefined;
  return [{
    price,
    currency: currencyRaw,
    stockStatus: availabilityToStockStatus(found.product.availabilityStatus ?? found.product.availabilityStatusDisplayValue),
    sellerName,
    sourceMethod: 'RETAILER_ADAPTER',
    confidence: 0.99,
    provenance: {
      adapterId: adapter.id,
      adapterVersion: adapter.version,
      sourcePath: `${found.sourcePath}.priceInfo.currentPrice`,
    },
  }];
}

export const walmartAdapter: RetailerAdapter = {
  id: 'walmart',
  version: '1.0.0',
  priority: 100,
  canHandle(artifact) {
    const host = hostnameOf(artifact.finalUrl);
    return host === 'walmart.com' || host.endsWith('.walmart.com');
  },
  extract(artifact) {
    const embedded = embeddedCandidate(artifact.html, walmartAdapter);
    const structured = extractJsonLdCandidates(artifact.html).map((candidate) => ({
      ...withProvenance(candidate, walmartAdapter, 'script[type="application/ld+json"]'),
      confidence: Math.max(candidate.confidence, 0.97),
    }));
    return [...embedded, ...structured];
  },
};
