import { extractJsonLdCandidates } from '../jsonld.ts';
import type { AdapterCandidate, RetailerAdapter, SupplementaryArtifact, SupplementaryRequest } from './types.ts';
import { withProvenance } from './types.ts';
import { attrValue, attribute, hostnameOf, scriptJson } from './helpers.ts';

function shopifyCurrency(html: string) {
  const meta = attrValue(html, 'meta', 'property', 'og:price:currency', 'content');
  if (meta && /^[A-Za-z]{3}$/.test(meta.trim())) return meta.trim().toUpperCase();
  const active = html.match(/Shopify\.currency\s*=\s*\{[^}]*active\s*:\s*["']([A-Za-z]{3})["']/i)?.[1];
  return active?.toUpperCase();
}

function numberInSubunits(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function variantPriceAnalysis(variants: Record<string, unknown>[]) {
  if (!variants.length) return {
    relevant:[] as Record<string, unknown>[],
    prices:[] as number[],
    filteredUnavailable:false,
  };

  const availabilityComplete = variants.every((variant) => typeof variant.available === 'boolean');
  const availableVariants = availabilityComplete
    ? variants.filter((variant) => variant.available === true)
    : [];
  const filteredUnavailable = availabilityComplete
    && availableVariants.length > 0
    && availableVariants.length < variants.length;
  const relevant = filteredUnavailable ? availableVariants : variants;
  const prices = relevant.map((variant) => numberInSubunits(variant.price));
  if (prices.some((price) => price === undefined)) return undefined;
  return {
    relevant,
    prices:prices as number[],
    filteredUnavailable,
  };
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
    const analysis = variantPriceAnalysis(variants);
    if (!analysis) continue;
    const uniquePrices = new Set(analysis.prices);
    if (uniquePrices.size > 1) continue;
    const cents = uniquePrices.size === 1
      ? [...uniquePrices][0]
      : numberInSubunits(product.price);
    if (cents === undefined) continue;
    const sellerName = typeof product.vendor === 'string' && product.vendor.trim() ? product.vendor.trim() : undefined;
    const available = analysis.filteredUnavailable
      ? true
      : (typeof product.available === 'boolean'
          ? product.available
          : (variants.length ? variants.some((variant) => variant.available === true) : undefined));
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
        sourcePath: `script[type="application/json"]#ProductJson|[data-product-json]${analysis.filteredUnavailable ? '#available-variants' : ''}`,
      },
    });
  }
  return candidates;
}

function parseJsonObject(raw: string) {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function ajaxUrls(primaryUrl: string) {
  const url = new URL(primaryUrl);
  const match = url.pathname.match(/^(.*\/products\/)([^/]+?)\/?$/i);
  if (!match) return undefined;
  const prefix = match[1];
  const handle = match[2].replace(/\.js$/i, '');
  const product = new URL(url.origin);
  product.pathname = `${prefix}${handle}.js`;
  const routeRoot = prefix.slice(0, -'products/'.length);
  const cart = new URL(url.origin);
  cart.pathname = `${routeRoot}cart.js`;
  return { product:product.toString(), cart:cart.toString() };
}

function currencyFromSupplements(primary: {html:string}, artifacts: SupplementaryArtifact[]) {
  const primaryCurrency = shopifyCurrency(primary.html);
  if (primaryCurrency) return primaryCurrency;
  const cart = artifacts.find((artifact) => artifact.requestId === 'shopify-cart');
  if (!cart) return undefined;
  const parsed = parseJsonObject(cart.html);
  const currency = typeof parsed?.currency === 'string' ? parsed.currency.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(currency) ? currency : undefined;
}

function ajaxProductCandidate(primaryUrl: string, product: Record<string, unknown>, currency: string): AdapterCandidate[] {
  const variants = Array.isArray(product.variants)
    ? product.variants.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
  const requestedVariant = new URL(primaryUrl).searchParams.get('variant');
  let chosen: Record<string, unknown> | undefined;
  let sourcePath = 'supplementary:GET /products/{handle}.js';

  if (requestedVariant) {
    chosen = variants.find((variant) => String(variant.id ?? '') === requestedVariant);
    if (!chosen) return [];
    sourcePath += `#variant=${requestedVariant}`;
  } else {
    const analysis = variantPriceAnalysis(variants);
    if (!analysis) return [];
    const unique = new Set(analysis.prices);
    if (unique.size > 1) return [];
    if (analysis.relevant.length) chosen = analysis.relevant[0];
    if (analysis.filteredUnavailable) sourcePath += '#available-variants';
  }

  const cents = chosen ? numberInSubunits(chosen.price) : numberInSubunits(product.price);
  if (cents === undefined) return [];
  const available = chosen && typeof chosen.available === 'boolean'
    ? chosen.available
    : (typeof product.available === 'boolean' ? product.available : undefined);
  const sellerName = typeof product.vendor === 'string' && product.vendor.trim() ? product.vendor.trim() : undefined;

  return [{
    price:cents / 100,
    currency,
    stockStatus:available === true ? 'IN_STOCK' : available === false ? 'OUT_OF_STOCK' : 'UNKNOWN',
    sellerName,
    sourceMethod:'RETAILER_ADAPTER',
    confidence:0.99,
    provenance:{
      adapterId:shopifyAdapter.id,
      adapterVersion:shopifyAdapter.version,
      sourcePath,
    },
  }];
}

function needsSupplementaryEvidence(primaryCandidates: AdapterCandidate[]) {
  if (!primaryCandidates.length) return true;
  const bestConfidence = Math.max(...primaryCandidates.map((candidate) => candidate.confidence));
  const best = primaryCandidates.filter((candidate) => candidate.confidence === bestConfidence);
  const values = new Set(best.map((candidate) => `${candidate.price}|${candidate.currency}|${candidate.stockStatus}`));
  return values.size > 1;
}

export const shopifyAdapter: RetailerAdapter = {
  id: 'shopify',
  version: '1.3.0',
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
    // OpenGraph price is intentionally not a standalone observation candidate. On
    // variant-bearing Shopify pages it can represent a low/default variant and
    // previously caused a confidently wrong product-level observation.
    return [...direct, ...jsonLd];
  },
  supplementaryRequests(artifact, primaryCandidates): SupplementaryRequest[] {
    if (!needsSupplementaryEvidence(primaryCandidates)) return [];
    const urls = ajaxUrls(artifact.finalUrl);
    if (!urls) return [];
    const requests: SupplementaryRequest[] = [{
      id:'shopify-product',
      url:urls.product,
      purpose:'Shopify Ajax Product JSON',
      sameOrigin:true,
      maxBytes:1024 * 1024,
      timeoutMs:4_000,
    }];
    if (!shopifyCurrency(artifact.html)) {
      requests.push({
        id:'shopify-cart',
        url:urls.cart,
        purpose:'Shopify presentment currency',
        sameOrigin:true,
        maxBytes:256 * 1024,
        timeoutMs:3_000,
      });
    }
    return requests;
  },
  extractSupplementary(primary, artifacts) {
    const productArtifact = artifacts.find((artifact) => artifact.requestId === 'shopify-product');
    if (!productArtifact) return [];
    const product = parseJsonObject(productArtifact.html);
    const currency = currencyFromSupplements(primary, artifacts);
    if (!product || !currency) return [];
    return ajaxProductCandidate(primary.finalUrl, product, currency);
  },
};
