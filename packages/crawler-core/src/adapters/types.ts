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

export interface AdapterExtractionResult {
  candidates: AdapterCandidate[];
  attempts: AdapterAttempt[];
}

export interface RetailerAdapter {
  id: string;
  version: string;
  priority: number;
  canHandle(artifact: FetchArtifact): boolean;
  extract(artifact: FetchArtifact): AdapterCandidate[];
}

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
