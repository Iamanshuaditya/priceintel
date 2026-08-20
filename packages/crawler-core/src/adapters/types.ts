import type { ExtractionCandidate } from '../jsonld.ts';

export interface FetchArtifact {
  requestedUrl: string;
  finalUrl: string;
  html: string;
  fetchedAt: Date;
  status?: number;
  contentType?: string;
  bytesDownloaded: number;
}

export interface CandidateProvenance {
  adapterId: string;
  adapterVersion: string;
  sourcePath: string;
  evidenceRef?: string;
}

export interface AdapterCandidate extends ExtractionCandidate {
  provenance: CandidateProvenance;
}

export interface AdapterAttempt {
  adapterId: string;
  adapterVersion: string;
  matched: boolean;
  candidateCount: number;
  errorCode?: string;
}

export interface SupplementaryRequest {
  id: string;
  url: string;
  purpose: string;
  sameOrigin?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
}

export interface SupplementaryArtifact extends FetchArtifact {
  requestId: string;
  purpose: string;
}

export interface SupplementaryAttempt {
  adapterId: string;
  adapterVersion: string;
  requestId: string;
  purpose: string;
  url: string;
  status?: number;
  bytesDownloaded: number;
  candidateCount: number;
  errorCode?: string;
}

export interface AdapterExtractionResult {
  candidates: AdapterCandidate[];
  attempts: AdapterAttempt[];
  primaryCandidateCount: number;
  supplementaryAttempts?: SupplementaryAttempt[];
}

export interface RetailerAdapter {
  id: string;
  version: string;
  priority: number;
  canHandle(artifact: FetchArtifact): boolean;
  extract(artifact: FetchArtifact): AdapterCandidate[];
  supplementaryRequests?(artifact: FetchArtifact, primaryCandidates: AdapterCandidate[]): SupplementaryRequest[];
  extractSupplementary?(primary: FetchArtifact, artifacts: SupplementaryArtifact[]): AdapterCandidate[];
}

export interface SupplementaryBudget {
  maxRequests: number;
  maxCumulativeBytes: number;
  maxTotalMs: number;
  defaultMaxBytes: number;
  defaultTimeoutMs: number;
}

export const defaultSupplementaryBudget: SupplementaryBudget = {
  maxRequests: 2,
  maxCumulativeBytes: 2 * 1024 * 1024,
  maxTotalMs: 8_000,
  defaultMaxBytes: 1024 * 1024,
  defaultTimeoutMs: 4_000,
};

export function withProvenance(
  candidate: ExtractionCandidate,
  adapter: Pick<RetailerAdapter, 'id' | 'version'>,
  sourcePath: string,
): AdapterCandidate {
  return {
    ...candidate,
    provenance: {
      adapterId: adapter.id,
      adapterVersion: adapter.version,
      sourcePath,
    },
  };
}
