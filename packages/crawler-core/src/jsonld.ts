import type { StockStatus } from '../../domain/src/index.ts';

export interface ExtractionCandidate {
  price: number;
  currency: string;
  stockStatus: StockStatus;
  sellerName?: string;
  sourceMethod: 'JSON_LD';
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
  const v = value.toLowerCase();
  if (v.includes('outofstock') || v.includes('soldout') || v.includes('discontinued')) return 'OUT_OF_STOCK';
  if (v.includes('instock') || v.includes('limitedavailability')) return 'IN_STOCK';
  return 'UNKNOWN';
}

function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  const nested = Array.isArray(obj['@graph']) ? objects(obj['@graph']) : [];
  return [obj, ...nested];
}

function productType(obj: Record<string, unknown>) {
  const t = obj['@type'];
  return Array.isArray(t) ? t.some((x) => String(x).toLowerCase() === 'product') : String(t).toLowerCase() === 'product';
}

function offerObjects(value: unknown): Record<string, unknown>[] {
  return objects(value).filter((o) => {
    const t = String(o['@type'] ?? '').toLowerCase();
    return t === 'offer' || t === 'aggregateoffer' || 'price' in o || 'lowPrice' in o;
  });
}

export function extractJsonLdCandidates(html: string): ExtractionCandidate[] {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const candidates: ExtractionCandidate[] = [];
  for (const match of scripts) {
    let parsed: unknown;
    try { parsed = JSON.parse(match[1]); } catch { continue; }
    for (const product of objects(parsed).filter(productType)) {
      for (const offer of offerObjects(product.offers)) {
        const rawPrice = offer.price ?? offer.lowPrice;
        const price = parsePriceUSFirst(rawPrice);
        const currency = String(offer.priceCurrency ?? '').trim().toUpperCase();
        if (price === undefined || !/^[A-Z]{3}$/.test(currency)) continue;
        const seller = offer.seller;
        const sellerName = typeof seller === 'string' ? seller : (seller && typeof seller === 'object' ? String((seller as Record<string,unknown>).name ?? '') : '');
        candidates.push({
          price, currency,
          stockStatus: availabilityToStockStatus(offer.availability),
          sellerName: sellerName || undefined,
          sourceMethod: 'JSON_LD',
          confidence: 0.95,
        });
      }
    }
  }
  const unique = new Map(candidates.map((c) => [`${c.price}|${c.currency}|${c.stockStatus}|${c.sellerName ?? ''}`, c]));
  return [...unique.values()];
}

export function selectValidatedCandidate(candidates: ExtractionCandidate[]): ExtractionCandidate {
  if (candidates.length === 0) throw Object.assign(new Error('No valid price candidate'), { code: 'PARSE_FAILED' });
  const bestConfidence = Math.max(...candidates.map((c) => c.confidence));
  const best = candidates.filter((c) => c.confidence === bestConfidence);
  const values = new Set(best.map((c) => `${c.price}|${c.currency}|${c.stockStatus}`));
  if (values.size > 1) throw Object.assign(new Error('Top extraction candidates disagree'), { code: 'CANDIDATE_DISAGREEMENT' });
  return best[0];
}
