import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseFallbackDecision,
  decisionTruthSummary,
  evaluateDecisionTruth,
  evaluateTruth,
  isLikelyChallengePage,
  truthSummary,
} from '../src/reliability.ts';

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

test('decision truth scores observation coverage, price accuracy, and variant abstentions separately', () => {
  const observationTruth = {
    expectation:'OBSERVATION' as const,
    visiblePrice:100,
    currency:'USD',
    verifiedAt:'2026-08-20T05:30:00Z',
  };
  const abstainTruth = {
    expectation:'ABSTAIN_VARIANT_AMBIGUITY' as const,
    variantPrices:[14.98,28.5],
    currency:'USD',
    reason:'Variant prices differ',
    verifiedAt:'2026-08-20T05:30:00Z',
  };
  const correctObservation = evaluateDecisionTruth(observationTruth, {price:100,currency:'USD',challenge:false,httpStatus:200}, now, 24);
  const wrongObservation = evaluateDecisionTruth(observationTruth, {price:90,currency:'USD',challenge:false,httpStatus:200}, now, 24);
  const falseAbstention = evaluateDecisionTruth(observationTruth, {challenge:false,httpStatus:200}, now, 24);
  const correctAbstention = evaluateDecisionTruth(abstainTruth, {challenge:false,httpStatus:200}, now, 24);
  const falseObservation = evaluateDecisionTruth(abstainTruth, {price:14.98,currency:'USD',challenge:false,httpStatus:200}, now, 24);

  const summary = decisionTruthSummary([correctObservation, wrongObservation, falseAbstention, correctAbstention, falseObservation]);
  assert.equal(summary.expectedObservations, 3);
  assert.equal(summary.producedObservations, 2);
  assert.equal(summary.observationTruthCoveragePct, 66.7);
  assert.equal(summary.correctObservationPrices, 1);
  assert.equal(summary.observationPriceCorrectnessPct, 50);
  assert.equal(summary.expectedAbstentions, 2);
  assert.equal(summary.correctAbstentions, 1);
  assert.equal(summary.abstentionAccuracyPct, 50);
  assert.equal(summary.falsePriceObservations, 1);
  assert.equal(summary.falseAbstentions, 1);
  assert.equal(summary.overallDecisionAccuracyPct, 40);
});

test('decision truth scores unavailable and blocked independently', () => {
  const unavailable = evaluateDecisionTruth(
    { expectation:'UNAVAILABLE', verifiedAt:'2026-08-20T05:30:00Z', reason:'404' },
    { challenge:false, httpStatus:404 },
    now,
    24,
  );
  const blocked = evaluateDecisionTruth(
    { expectation:'BLOCKED', verifiedAt:'2026-08-20T05:30:00Z', reason:'challenge' },
    { challenge:true, httpStatus:200 },
    now,
    24,
  );
  const summary = decisionTruthSummary([unavailable, blocked]);
  assert.equal(summary.correctUnavailable, 1);
  assert.equal(summary.correctBlocked, 1);
  assert.equal(summary.overallDecisionAccuracyPct, 100);
});

test('fallback classification does not treat explicit challenge as browser-render work', () => {
  assert.equal(chooseFallbackDecision({ extracted:false, challenge:true, preferred:'BROWSER_RENDER' }), 'BLOCKED');
  assert.equal(chooseFallbackDecision({ extracted:false, challenge:false, preferred:'APPROVED_API' }), 'APPROVED_API');
  assert.equal(chooseFallbackDecision({ extracted:true, challenge:true, preferred:'BLOCKED' }), 'NONE');
});

test('challenge detector ignores anti-bot words inside normal product scripts', () => {
  const html = `
    <html><head><title>Widget — Shop</title></head><body>
      <h1>Widget</h1><div>$49.00</div><button>Add to cart</button>
      <script>window.config={captcha:'verify you are human',message:'access denied',robot:'robot or human'}</script>
    </body></html>`;
  assert.equal(isLikelyChallengePage({ status:200, finalUrl:'https://shop.example/products/widget', html }), false);
});

test('challenge detector still recognizes explicit access-control states', () => {
  assert.equal(isLikelyChallengePage({ status:429, finalUrl:'https://shop.example/products/widget', html:'<h1>Widget</h1>' }), true);
  assert.equal(isLikelyChallengePage({ status:200, finalUrl:'https://shop.example/blocked', html:'<h1>Widget</h1>' }), true);
  assert.equal(isLikelyChallengePage({ status:200, finalUrl:'https://shop.example/products/widget', html:'<h1>Verify you are human</h1>' }), true);
});
