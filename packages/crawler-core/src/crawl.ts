import { extractJsonLdCandidates, selectValidatedCandidate } from './jsonld.ts';
import type { PriceObservation } from '../../domain/src/index.ts';

export interface CrawlInput {
  workspaceId: string;
  productId: string;
  listingId: string;
  url: string;
  crawlRunId: string;
  now?: Date;
}
export type HtmlFetcher = (url: string) => Promise<{ html: string; finalUrl?: string }>;

export async function crawlStructuredProduct(input: CrawlInput, fetchHtml: HtmlFetcher): Promise<PriceObservation> {
  const fetchedAt = input.now ?? new Date();
  const { html } = await fetchHtml(input.url);
  const candidate = selectValidatedCandidate(extractJsonLdCandidates(html));
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
    sourceMethod: 'JSON_LD',
    extractorVersion: 'jsonld-v1',
    confidence: candidate.confidence,
    crawlRunId: input.crawlRunId,
  };
}
