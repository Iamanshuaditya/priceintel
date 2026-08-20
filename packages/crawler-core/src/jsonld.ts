import type { SourceMethod, StockStatus } from '../../domain/src/index.ts';

export interface ExtractionCandidate {
  price: number;
  currency: string;
  stockStatus: StockStatus;
  sellerName?: string;
  sourceMethod: SourceMethod;
  confidence: number;
}

export function parsePriceUSFirst(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[^0-9.,-]/g, '');
  if (!cleaned || cleaned.startsWith('-')) return undefined;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized = cleaned;

  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) return undefined;
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) return undefined;
    normalized = cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    if (!/^\d{1,3}(,\d{3})+$/.test(cleaned)) return undefined;
    normalized = cleaned.replace(/,/g, '');
  } else if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return undefined;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function availabilityToStockStatus(value: unknown): StockStatus {
  if (typeof value !== 'string') return 'UNKNOWN';
  const v = value.toLowerCase().replace(/[^a-z]/g, '');
  if (v.includes('outofstock') || v.includes('soldout') || v.includes('discontinued') || v === 'unavailable') return 'OUT_OF_STOCK';
  if (v.includes('instock') || v.includes('limitedavailability') || v === 'available') return 'IN_STOCK';
  return 'UNKNOWN';
}

function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  const nested = Array.isArray(obj['@graph']) ? objects(obj['@graph']) : [];
  return [obj, ...nested];
}

function typeIs(obj: Record<string, unknown>, expected: string) {
  const t = obj['@type'];
  const normalized = expected.toLowerCase();
  return Array.isArray(t)
    ? t.some((x) => String(x).toLowerCase() === normalized)
    : String(t).toLowerCase() === normalized;
}

function productType(obj: Record<string, unknown>) {
  return typeIs(obj, 'Product');
}

function productGroupType(obj: Record<string, unknown>) {
  return typeIs(obj, 'ProductGroup');
}

function offerObjects(value: unknown): Record<string, unknown>[] {
  return objects(value).filter((o) => {
    const t = String(o['@type'] ?? '').toLowerCase();
    return t === 'offer' || t === 'aggregateoffer' || 'price' in o || 'lowPrice' in o;
  });
}

function candidateFromOffer(offer: Record<string, unknown>): ExtractionCandidate | undefined {
  const rawPrice = offer.price ?? offer.lowPrice;
  const price = parsePriceUSFirst(rawPrice);
  const currency = String(offer.priceCurrency ?? '').trim().toUpperCase();
  if (price === undefined || !/^[A-Z]{3}$/.test(currency)) return undefined;
  const seller = offer.seller;
  const sellerName = typeof seller === 'string'
    ? seller
    : (seller && typeof seller === 'object' ? String((seller as Record<string,unknown>).name ?? '') : '');
  return {
    price,
    currency,
    stockStatus: availabilityToStockStatus(offer.availability),
    sellerName: sellerName || undefined,
    sourceMethod: 'JSON_LD',
    confidence: 0.95,
  };
}

function productCandidates(product: Record<string, unknown>) {
  return offerObjects(product.offers)
    .map(candidateFromOffer)
    .filter((candidate): candidate is ExtractionCandidate => Boolean(candidate));
}

function aggregateGroupStock(candidates: ExtractionCandidate[]): StockStatus {
  if (candidates.some((candidate) => candidate.stockStatus === 'IN_STOCK')) return 'IN_STOCK';
  if (candidates.length && candidates.every((candidate) => candidate.stockStatus === 'OUT_OF_STOCK')) return 'OUT_OF_STOCK';
  return 'UNKNOWN';
}

function productGroupCandidate(group: Record<string, unknown>): ExtractionCandidate | undefined {
  const variants = objects(group.hasVariant).filter(productType);
  if (!variants.length) return undefined;

  const selected: ExtractionCandidate[] = [];
  for (const variant of variants) {
    const candidates = productCandidates(variant);
    if (!candidates.length) return undefined;
    try { selected.push(selectValidatedCandidate(candidates)); }
    catch { return undefined; }
  }

  const priceCurrencies = new Set(selected.map((candidate) => `${candidate.price}|${candidate.currency}`));
  if (priceCurrencies.size !== 1) return undefined;
  const first = selected[0];
  const sellers = new Set(selected.map((candidate) => candidate.sellerName).filter(Boolean));
  return {
    price:first.price,
    currency:first.currency,
    stockStatus:aggregateGroupStock(selected),
    sellerName:sellers.size === 1 ? [...sellers][0] : undefined,
    sourceMethod:'JSON_LD',
    confidence:Math.min(...selected.map((candidate) => candidate.confidence), 0.95),
  };
}

export function extractJsonLdCandidates(html: string): ExtractionCandidate[] {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const candidates: ExtractionCandidate[] = [];
  for (const match of scripts) {
    let parsed: unknown;
    try { parsed = JSON.parse(match[1]); } catch { continue; }
    const roots = objects(parsed);
    for (const product of roots.filter(productType)) candidates.push(...productCandidates(product));
    for (const group of roots.filter(productGroupType)) {
      const candidate = productGroupCandidate(group);
      if (candidate) candidates.push(candidate);
    }
  }
  const unique = new Map(candidates.map((c) => [`${c.price}|${c.currency}|${c.stockStatus}|${c.sellerName ?? ''}`, c]));
  return [...unique.values()];
}

export function selectValidatedCandidate<T extends ExtractionCandidate>(candidates: T[]): T {
  if (candidates.length === 0) throw Object.assign(new Error('No valid price candidate'), { code: 'PARSE_FAILED' });
  const bestConfidence = Math.max(...candidates.map((c) => c.confidence));
  const best = candidates.filter((c) => c.confidence === bestConfidence);
  const values = new Set(best.map((c) => `${c.price}|${c.currency}|${c.stockStatus}`));
  if (values.size > 1) throw Object.assign(new Error('Top extraction candidates disagree'), { code: 'CANDIDATE_DISAGREEMENT' });
  return best[0];
}
