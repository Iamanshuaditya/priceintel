import { availabilityToStockStatus, extractJsonLdCandidates, parsePriceUSFirst } from '../jsonld.ts';
import type { AdapterCandidate, RetailerAdapter } from './types.ts';
import { withProvenance } from './types.ts';
import { attrValue, attribute, hostnameOf, scriptJson } from './helpers.ts';

function shopifyCurrency(html: string) {
  const meta = attrValue(html, 'meta', 'property', 'og:price:currency', 'content');
  if (meta && /^[A-Za-z]{3}$/.test(meta.trim())) return meta.trim().toUpperCase();
  const active = html.match(/Shopify\.currency\s*=\s*\{[^}]*active\s*:\s*["']([A-Za-z]{3})["']/i)?.[1];
  return active?.toUpperCase();
}

function productJsonCandidates(html: string, adapter: RetailerAdapter): AdapterCandidate[] {
  const currency = shopifyCurrency(html);
  if (!currency) return [];
  const blocks = scriptJson(html, (tag) => {
    const type = attribute(tag, 'type')?.toLowerCase();
    const id = attribute(tag, 'id')?.toLowerCase() ?? '';
    return type === 'application/json' && (id.includes('productjson') || /\bdata-product-json(?:=|\s|>)/i.test(tag));
  });
  const candidates: AdapterCandidate[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const product = block as Record<string, unknown>;
    const variants = Array.isArray(product.variants)
      ? product.variants.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
      : [];
    const prices = variants
      .map((variant) => typeof variant.price === 'number' ? variant.price : Number.NaN)
      .filter(Number.isFinite);
    const uniquePrices = new Set(prices);
    const priceVaries = product.price_varies === true || uniquePrices.size > 1;
    if (priceVaries) continue;
    const cents = typeof product.price === 'number'
      ? product.price
      : (uniquePrices.size === 1 ? [...uniquePrices][0] : undefined);
    if (typeof cents !== 'number' || !Number.isFinite(cents) || cents < 0) continue;
    const sellerName = typeof product.vendor === 'string' && product.vendor.trim() ? product.vendor.trim() : undefined;
    const available = typeof product.available === 'boolean'
      ? product.available
      : (variants.length ? variants.some((variant) => variant.available === true) : undefined);
    candidates.push({
      price: cents / 100,
      currency,
      stockStatus: available === true ? 'IN_STOCK' : available === false ? 'OUT_OF_STOCK' : 'UNKNOWN',
      sellerName,
      sourceMethod: 'RETAILER_ADAPTER',
      confidence: 0.98,
      provenance: {
        adapterId: adapter.id,
        adapterVersion: adapter.version,
        sourcePath: 'script[type="application/json"]#ProductJson|[data-product-json]',
      },
    });
  }
  return candidates;
}

function openGraphCandidate(html: string, adapter: RetailerAdapter): AdapterCandidate[] {
  const amount = attrValue(html, 'meta', 'property', 'og:price:amount', 'content');
  const currency = shopifyCurrency(html);
  const price = parsePriceUSFirst(amount);
  if (price === undefined || !currency) return [];
  const availability = attrValue(html, 'meta', 'property', 'product:availability', 'content');
  return [{
    price,
    currency,
    stockStatus: availabilityToStockStatus(availability),
    sourceMethod: 'RETAILER_ADAPTER',
    confidence: 0.75,
    provenance: {
      adapterId: adapter.id,
      adapterVersion: adapter.version,
      sourcePath: 'meta[property="og:price:amount"]',
    },
  }];
}

export const shopifyAdapter: RetailerAdapter = {
  id: 'shopify',
  version: '1.0.0',
  priority: 60,
  canHandle(artifact) {
    const host = hostnameOf(artifact.finalUrl);
    return host.endsWith('.myshopify.com')
      || /cdn\.shopify\.com|shopify-section|Shopify\.theme|Shopify\.routes/i.test(artifact.html);
  },
  extract(artifact) {
    const direct = productJsonCandidates(artifact.html, shopifyAdapter);
    const jsonLd = extractJsonLdCandidates(artifact.html).map((candidate) => ({
      ...withProvenance(candidate, shopifyAdapter, 'script[type="application/ld+json"]'),
      confidence: Math.max(candidate.confidence, 0.97),
    }));
    return [...direct, ...jsonLd, ...openGraphCandidate(artifact.html, shopifyAdapter)];
  },
};
