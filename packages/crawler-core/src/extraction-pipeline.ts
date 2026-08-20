import {
  defaultRetailerAdapters,
  extractWithAdapterSupplements,
  selectAdapterCandidate,
  type SupplementaryFetcher,
} from './adapters/registry.ts';
import type {
  AdapterCandidate,
  AdapterExtractionResult,
  FetchArtifact,
  RetailerAdapter,
  SupplementaryBudget,
} from './adapters/types.ts';
import { defaultSupplementaryBudget } from './adapters/types.ts';

export interface ExtractionPipelineResult {
  extraction: AdapterExtractionResult;
  candidate?: AdapterCandidate;
  selectionError?: unknown;
}

export async function executeExtractionPipeline(
  primary: FetchArtifact,
  fetchSupplementary: SupplementaryFetcher,
  adapters: RetailerAdapter[] = defaultRetailerAdapters,
  budget: SupplementaryBudget = defaultSupplementaryBudget,
): Promise<ExtractionPipelineResult> {
  const extraction = await extractWithAdapterSupplements(primary, fetchSupplementary, adapters, budget);
  try {
    return {
      extraction,
      candidate:selectAdapterCandidate(extraction.candidates),
    };
  } catch (selectionError) {
    return { extraction, selectionError };
  }
}

export function requireExtractionCandidate(result: ExtractionPipelineResult): AdapterCandidate {
  if (result.candidate) return result.candidate;
  if (result.selectionError) throw result.selectionError;
  throw Object.assign(new Error('No valid price candidate'), { code:'PARSE_FAILED' });
}
