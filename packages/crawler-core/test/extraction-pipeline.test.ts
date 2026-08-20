import test from 'node:test';
import assert from 'node:assert/strict';
import { executeExtractionPipeline, requireExtractionCandidate } from '../src/extraction-pipeline.ts';
import type { FetchArtifact, RetailerAdapter } from '../src/adapters/types.ts';

function artifact(url: string, html: string): FetchArtifact {
  return {
    requestedUrl:url,
    finalUrl:url,
    html,
    fetchedAt:new Date('2026-08-20T00:00:00Z'),
    status:200,
    contentType:'text/html',
    bytesDownloaded:Buffer.byteLength(html),
  };
}

test('shared pipeline supplements a selectable weak primary candidate before final selection', async () => {
  const adapter: RetailerAdapter = {
    id:'pipeline-fixture',
    version:'1.0.0',
    priority:100,
    canHandle:()=>true,
    extract:()=>[{
      price:90,
      currency:'USD',
      stockStatus:'UNKNOWN',
      sourceMethod:'RETAILER_ADAPTER',
      confidence:0.7,
      provenance:{adapterId:'pipeline-fixture',adapterVersion:'1.0.0',sourcePath:'primary'},
    }],
    supplementaryRequests:()=>[{
      id:'exact',
      url:'https://shop.example/products/widget.js',
      purpose:'exact source',
      sameOrigin:true,
    }],
    extractSupplementary:()=>[{
      price:100,
      currency:'USD',
      stockStatus:'IN_STOCK',
      sourceMethod:'RETAILER_ADAPTER',
      confidence:0.99,
      provenance:{adapterId:'pipeline-fixture',adapterVersion:'1.0.0',sourcePath:'supplementary:exact'},
    }],
  };
  let supplementaryCalls = 0;
  const result = await executeExtractionPipeline(
    artifact('https://shop.example/products/widget', '<html>widget</html>'),
    async (request) => {
      supplementaryCalls += 1;
      return artifact(request.url, '{}');
    },
    [adapter],
  );

  assert.equal(supplementaryCalls, 1);
  assert.equal(result.extraction.primaryCandidateCount, 1);
  assert.equal(result.extraction.supplementaryAttempts?.length, 1);
  assert.equal(requireExtractionCandidate(result).price, 100);
  assert.equal(requireExtractionCandidate(result).provenance.sourcePath, 'supplementary:exact');
});

test('shared pipeline preserves selection disagreement instead of inventing a candidate', async () => {
  const adapter: RetailerAdapter = {
    id:'disagreement-fixture',
    version:'1.0.0',
    priority:100,
    canHandle:()=>true,
    extract:()=>[
      {price:90,currency:'USD',stockStatus:'IN_STOCK',sourceMethod:'RETAILER_ADAPTER',confidence:0.95,provenance:{adapterId:'disagreement-fixture',adapterVersion:'1.0.0',sourcePath:'a'}},
      {price:91,currency:'USD',stockStatus:'IN_STOCK',sourceMethod:'RETAILER_ADAPTER',confidence:0.95,provenance:{adapterId:'disagreement-fixture',adapterVersion:'1.0.0',sourcePath:'b'}},
    ],
  };
  const result = await executeExtractionPipeline(
    artifact('https://shop.example/products/widget', '<html>widget</html>'),
    async (request) => artifact(request.url, '{}'),
    [adapter],
  );
  assert.equal(result.candidate, undefined);
  assert.equal((result.selectionError as {code?:string}).code, 'CANDIDATE_DISAGREEMENT');
  assert.throws(() => requireExtractionCandidate(result), (error: unknown) => (error as {code?:string}).code === 'CANDIDATE_DISAGREEMENT');
});
