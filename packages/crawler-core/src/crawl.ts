import type { PriceObservation } from '../../domain/src/index.ts';
import { extractWithAdapterSupplements, selectAdapterCandidate } from './adapters/registry.ts';
import type { FetchArtifact, SupplementaryRequest } from './adapters/types.ts';

export interface CrawlInput {
  workspaceId: string;
  productId: string;
  listingId: string;
  url: string;
  crawlRunId: string;
  now?: Date;
}

export interface HtmlFetchOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export type HtmlFetcher = (url: string, options?: HtmlFetchOptions) => Promise<{
  html: string;
  finalUrl?: string;
  status?: number;
  contentType?: string;
}>;

function artifactFromFetch(requestedUrl: string, fetchedAt: Date, fetched: Awaited<ReturnType<HtmlFetcher>>): FetchArtifact {
  return {
    requestedUrl,
    finalUrl: fetched.finalUrl ?? requestedUrl,
    html: fetched.html,
    fetchedAt,
    status: fetched.status,
    contentType: fetched.contentType,
    bytesDownloaded: Buffer.byteLength(fetched.html),
  };
}

export async function crawlStructuredProduct(input: CrawlInput, fetchHtml: HtmlFetcher): Promise<PriceObservation> {
  const fetchedAt = input.now ?? new Date();
  const fetched = await fetchHtml(input.url);
  const primary = artifactFromFetch(input.url, fetchedAt, fetched);
  const extraction = await extractWithAdapterSupplements(primary, async (request: SupplementaryRequest) => {
    const supplemental = await fetchHtml(request.url, {
      timeoutMs:request.timeoutMs,
      maxResponseBytes:request.maxBytes,
    });
    return artifactFromFetch(request.url, fetchedAt, supplemental);
  });
  const candidate = selectAdapterCandidate(extraction.candidates);
  return {
    id: `obs_${input.crawlRunId}`,
    workspaceId: input.workspaceId,
    productId: input.productId,
    competitorListingId: input.listingId,
    fetchedAt,
    verifiedAt: fetchedAt,
    currency: candidate.currency,
    price: candidate.price,
    stockStatus: candidate.stockStatus,
    sellerName: candidate.sellerName,
    sourceMethod: candidate.sourceMethod,
    extractorVersion: `${candidate.provenance.adapterId}@${candidate.provenance.adapterVersion}`,
    confidence: candidate.confidence,
    crawlRunId: input.crawlRunId,
  };
}
