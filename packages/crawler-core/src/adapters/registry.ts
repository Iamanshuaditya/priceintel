import { selectValidatedCandidate } from '../jsonld.ts';
import { bestBuyAdapter } from './bestbuy.ts';
import { genericJsonLdAdapter } from './generic-jsonld.ts';
import { shopifyAdapter } from './shopify.ts';
import type { AdapterCandidate, AdapterExtractionResult, FetchArtifact, RetailerAdapter } from './types.ts';
import { walmartAdapter } from './walmart.ts';

export const defaultRetailerAdapters: RetailerAdapter[] = [
  walmartAdapter,
  bestBuyAdapter,
  shopifyAdapter,
  genericJsonLdAdapter,
].sort((a, b) => b.priority - a.priority);

function errorCode(error: unknown) {
  return (error as {code?:string}).code ?? (error instanceof Error ? error.name : 'ADAPTER_ERROR');
}

export function extractWithAdapters(
  artifact: FetchArtifact,
  adapters: RetailerAdapter[] = defaultRetailerAdapters,
): AdapterExtractionResult {
  const candidates: AdapterCandidate[] = [];
  const attempts: AdapterExtractionResult['attempts'] = [];
  for (const adapter of adapters) {
    let matched = false;
    try {
      matched = adapter.canHandle(artifact);
      if (!matched) {
        attempts.push({ adapterId:adapter.id, adapterVersion:adapter.version, matched:false, candidateCount:0 });
        continue;
      }
      const extracted = adapter.extract(artifact);
      candidates.push(...extracted);
      attempts.push({ adapterId:adapter.id, adapterVersion:adapter.version, matched:true, candidateCount:extracted.length });
    } catch (error) {
      attempts.push({ adapterId:adapter.id, adapterVersion:adapter.version, matched, candidateCount:0, errorCode:errorCode(error) });
    }
  }
  return { candidates, attempts };
}

export function selectAdapterCandidate(candidates: AdapterCandidate[]): AdapterCandidate {
  const selected = selectValidatedCandidate(candidates);
  return selected as AdapterCandidate;
}
