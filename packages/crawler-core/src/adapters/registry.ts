import { selectValidatedCandidate } from '../jsonld.ts';
import { bestBuyAdapter } from './bestbuy.ts';
import { genericJsonLdAdapter } from './generic-jsonld.ts';
import { gymsharkAdapter } from './gymshark.ts';
import { shopifyAdapter } from './shopify.ts';
import type {
  AdapterCandidate,
  AdapterExtractionResult,
  FetchArtifact,
  RetailerAdapter,
  SupplementaryArtifact,
  SupplementaryBudget,
  SupplementaryRequest,
} from './types.ts';
import { defaultSupplementaryBudget } from './types.ts';
import { walmartAdapter } from './walmart.ts';

export const defaultRetailerAdapters: RetailerAdapter[] = [
  gymsharkAdapter,
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
  return { candidates, attempts, primaryCandidateCount:candidates.length };
}

export function selectAdapterCandidate(candidates: AdapterCandidate[]): AdapterCandidate {
  const selected = selectValidatedCandidate(candidates);
  return selected as AdapterCandidate;
}

export type SupplementaryFetcher = (request: SupplementaryRequest) => Promise<FetchArtifact>;

function assertSupplementaryRequest(primary: FetchArtifact, request: SupplementaryRequest) {
  const url = new URL(request.url, primary.finalUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Supplementary request must use HTTP(S)'), { code:'SUPPLEMENTARY_PROTOCOL_BLOCKED' });
  }
  if (request.sameOrigin !== false && url.origin !== new URL(primary.finalUrl).origin) {
    throw Object.assign(new Error('Supplementary request must remain same-origin'), { code:'SUPPLEMENTARY_ORIGIN_BLOCKED' });
  }
  return url.toString();
}

function canSelect(candidates: AdapterCandidate[]) {
  try { return selectAdapterCandidate(candidates); }
  catch { return undefined; }
}

export async function extractWithAdapterSupplements(
  primary: FetchArtifact,
  fetchSupplementary: SupplementaryFetcher,
  adapters: RetailerAdapter[] = defaultRetailerAdapters,
  budget: SupplementaryBudget = defaultSupplementaryBudget,
): Promise<AdapterExtractionResult> {
  const primaryResult = extractWithAdapters(primary, adapters);
  // Do not return merely because a primary candidate can be selected. A matched
  // adapter may deliberately request bounded supplementary evidence to confirm a
  // weak candidate or resolve a primary disagreement.
  const start = Date.now();
  let requestsUsed = 0;
  let bytesUsed = 0;
  const supplementaryAttempts: NonNullable<AdapterExtractionResult['supplementaryAttempts']> = [];
  const allCandidates = [...primaryResult.candidates];

  for (const adapter of adapters) {
    const matched = primaryResult.attempts.some((attempt) => attempt.adapterId === adapter.id && attempt.matched);
    if (!matched || !adapter.supplementaryRequests || !adapter.extractSupplementary) continue;

    const adapterPrimaryCandidates = primaryResult.candidates.filter((candidate) => candidate.provenance.adapterId === adapter.id);
    const requests = adapter.supplementaryRequests(primary, adapterPrimaryCandidates);
    const artifacts: SupplementaryArtifact[] = [];

    for (const rawRequest of requests) {
      if (requestsUsed >= budget.maxRequests) break;
      const elapsed = Date.now() - start;
      if (elapsed >= budget.maxTotalMs || bytesUsed >= budget.maxCumulativeBytes) break;

      requestsUsed += 1;
      let request: SupplementaryRequest | undefined;
      try {
        request = {
          ...rawRequest,
          url: assertSupplementaryRequest(primary, rawRequest),
          sameOrigin: rawRequest.sameOrigin ?? true,
          maxBytes: Math.min(
            rawRequest.maxBytes ?? budget.defaultMaxBytes,
            budget.maxCumulativeBytes - bytesUsed,
          ),
          timeoutMs: Math.min(
            rawRequest.timeoutMs ?? budget.defaultTimeoutMs,
            Math.max(1, budget.maxTotalMs - elapsed),
          ),
        };
        const fetched = await fetchSupplementary(request);
        if (fetched.bytesDownloaded > (request.maxBytes ?? budget.defaultMaxBytes)) {
          throw Object.assign(new Error('Supplementary response exceeded request byte budget'), { code:'SUPPLEMENTARY_TOO_LARGE' });
        }
        bytesUsed += fetched.bytesDownloaded;
        const artifact: SupplementaryArtifact = {
          ...fetched,
          requestId:request.id,
          purpose:request.purpose,
        };
        artifacts.push(artifact);
        supplementaryAttempts.push({
          adapterId:adapter.id,
          adapterVersion:adapter.version,
          requestId:request.id,
          purpose:request.purpose,
          url:request.url,
          status:fetched.status,
          bytesDownloaded:fetched.bytesDownloaded,
          candidateCount:0,
        });
      } catch (error) {
        supplementaryAttempts.push({
          adapterId:adapter.id,
          adapterVersion:adapter.version,
          requestId:rawRequest.id,
          purpose:rawRequest.purpose,
          url:request?.url ?? rawRequest.url,
          bytesDownloaded:0,
          candidateCount:0,
          errorCode:errorCode(error),
        });
      }
    }

    if (!artifacts.length) continue;
    try {
      const extracted = adapter.extractSupplementary(primary, artifacts);
      allCandidates.push(...extracted);
      for (const attempt of supplementaryAttempts.filter((item) => item.adapterId === adapter.id && !item.errorCode)) {
        attempt.candidateCount = extracted.length;
      }
    } catch (error) {
      supplementaryAttempts.push({
        adapterId:adapter.id,
        adapterVersion:adapter.version,
        requestId:'extract-supplementary',
        purpose:'extract-supplementary',
        url:primary.finalUrl,
        bytesDownloaded:0,
        candidateCount:0,
        errorCode:errorCode(error),
      });
    }

    if (canSelect(allCandidates)) break;
  }

  return { ...primaryResult, candidates:allCandidates, supplementaryAttempts };
}
