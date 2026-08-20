import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseFallbackDecision, evaluateTruth, truthSummary } from '../src/reliability.ts';

const now = new Date('2026-08-20T06:00:00Z').getTime();
const truth = { visiblePrice:100, currency:'USD', verifiedAt:'2026-08-20T05:30:00Z' };

test('truth reporting distinguishes missing extraction from an incorrect extraction', () => {
  const missing = evaluateTruth(truth, {}, now, 24);
  const wrong = evaluateTruth(truth, {price:90,currency:'USD'}, now, 24);
  const correct = evaluateTruth(truth, {price:100,currency:'USD'}, now, 24);
  assert.equal(missing.state, 'NOT_EXTRACTED');
  assert.equal(wrong.state, 'INCORRECT');
  assert.equal(correct.state, 'CORRECT');

  const summary = truthSummary([missing, wrong, correct]);
  assert.equal(summary.freshTruthSamples, 3);
  assert.equal(summary.truthExtractedSamples, 2);
  assert.equal(summary.truthExtractionCoveragePct, 66.7);
  assert.equal(summary.correctnessAmongExtractedTruthPct, 50);
  assert.equal(summary.endToEndCorrectCoveragePct, 33.3);
});

test('correctness among extracted truth is null when coverage is zero', () => {
  const summary = truthSummary([evaluateTruth(truth, {}, now, 24)]);
  assert.equal(summary.truthExtractionCoveragePct, 0);
  assert.equal(summary.correctnessAmongExtractedTruthPct, null);
  assert.equal(summary.endToEndCorrectCoveragePct, 0);
});

test('fallback classification does not treat explicit challenge as browser-render work', () => {
  assert.equal(chooseFallbackDecision({ extracted:false, challenge:true, preferred:'BROWSER_RENDER' }), 'BLOCKED');
  assert.equal(chooseFallbackDecision({ extracted:false, challenge:false, preferred:'APPROVED_API' }), 'APPROVED_API');
  assert.equal(chooseFallbackDecision({ extracted:true, challenge:true, preferred:'BLOCKED' }), 'NONE');
});
