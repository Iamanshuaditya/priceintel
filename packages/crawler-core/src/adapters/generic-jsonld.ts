import { extractJsonLdCandidates } from '../jsonld.ts';
import type { RetailerAdapter } from './types.ts';
import { withProvenance } from './types.ts';

export const genericJsonLdAdapter: RetailerAdapter = {
  id: 'generic-jsonld',
  version: '1.0.0',
  priority: 0,
  canHandle: () => true,
  extract(artifact) {
    return extractJsonLdCandidates(artifact.html).map((candidate) =>
      withProvenance(candidate, genericJsonLdAdapter, 'script[type="application/ld+json"]'),
    );
  },
};
