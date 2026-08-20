export interface ExtractionCandidate {
  price: number;
  currency: string;
  inStock: boolean;
  sellerName?: string;
  sourceMethod: 'JSON_LD';
  confidence: number;
}

function parsePrice(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function availabilityToStock(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const v = value.toLowerCase();
  if (v.includes('outofstock') || v.includes('soldout') || v.includes('discontinued')) return false;
  return true;
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
        const price = parsePrice(rawPrice);
        const currency = String(offer.priceCurrency ?? '').trim().toUpperCase();
        if (price === undefined || !/^[A-Z]{3}$/.test(currency)) continue;
        const seller = offer.seller;
        const sellerName = typeof seller === 'string' ? seller : (seller && typeof seller === 'object' ? String((seller as Record<string,unknown>).name ?? '') : '');
        candidates.push({
          price, currency,
          inStock: availabilityToStock(offer.availability),
          sellerName: sellerName || undefined,
          sourceMethod: 'JSON_LD',
          confidence: 0.95,
        });
      }
    }
  }
  const unique = new Map(candidates.map((c) => [`${c.price}|${c.currency}|${c.inStock}|${c.sellerName ?? ''}`, c]));
  return [...unique.values()];
}

export function selectValidatedCandidate(candidates: ExtractionCandidate[]): ExtractionCandidate {
  if (candidates.length === 0) throw Object.assign(new Error('No valid price candidate'), { code: 'PARSE_FAILED' });
  const bestConfidence = Math.max(...candidates.map((c) => c.confidence));
  const best = candidates.filter((c) => c.confidence === bestConfidence);
  const values = new Set(best.map((c) => `${c.price}|${c.currency}|${c.inStock}`));
  if (values.size > 1) throw Object.assign(new Error('Top extraction candidates disagree'), { code: 'CANDIDATE_DISAGREEMENT' });
  return best[0];
}
