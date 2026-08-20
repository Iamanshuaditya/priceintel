import type { PriceObservation } from '../../domain/src/index.ts';
import { extractWithAdapters, selectAdapterCandidate } from './adapters/registry.ts';

export interface CrawlInput {
  workspaceId: string;
  productId: string;
  listingId: string;
  url: string;
  crawlRunId: string;
  now?: Date;
}

export type HtmlFetcher = (url: string) => Promise<{
  html: string;
  finalUrl?: string;
  status?: number;
  contentType?: string;
}>;

export async function crawlStructuredProduct(input: CrawlInput, fetchHtml: HtmlFetcher): Promise<PriceObservation> {
  const fetchedAt = input.now ?? new Date();
  const fetched = await fetchHtml(input.url);
  const artifact = {
    requestedUrl: input.url,
    finalUrl: fetched.finalUrl ?? input.url,
    html: fetched.html,
    fetchedAt,
    status: fetched.status,
    contentType: fetched.contentType,
    bytesDownloaded: Buffer.byteLength(fetched.html),
  };
  const extraction = extractWithAdapters(artifact);
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
