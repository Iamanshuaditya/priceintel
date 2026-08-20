import test from 'node:test';
import assert from 'node:assert/strict';
import { computeReliabilityEconomics } from '../src/economics.ts';

test('reliability economics separates measured resource use from optional dollar model', () => {
  const measured = computeReliabilityEconomics([
    { bytesDownloaded:1_000_000, supplementaryBytes:250_000, supplementaryRequestCount:1, totalDurationMs:1200 },
    { bytesDownloaded:500_000, supplementaryBytes:0, supplementaryRequestCount:0, totalDurationMs:800 },
  ]);
  assert.equal(measured.urls, 2);
  assert.equal(measured.totalDownloadedBytes, 1_750_000);
  assert.equal(measured.totalHttpRequests, 3);
  assert.equal(measured.costModelConfigured, false);
  assert.equal(measured.estimatedCostUsd, null);

  const priced = computeReliabilityEconomics([
    { bytesDownloaded:1024 ** 3, supplementaryBytes:0, supplementaryRequestCount:0, totalDurationMs:1000 },
  ], { requestCostUsd:0.001, egressGbCostUsd:0.10 });
  assert.equal(priced.costModelConfigured, true);
  assert.equal(priced.estimatedCostUsd, 0.101);
  assert.equal(priced.estimatedCostPerUrlUsd, 0.101);
});
