export type TruthState = 'CORRECT' | 'INCORRECT' | 'NOT_EXTRACTED' | 'STALE_TRUTH' | 'NO_TRUTH';
export type FallbackDecision =
  | 'NONE'
  | 'SUPPLEMENTARY_HTTP'
  | 'BROWSER_RENDER'
  | 'APPROVED_API'
  | 'APPROVED_DATA_PROVIDER'
  | 'BLOCKED'
  | 'MANUAL_REVIEW';

export interface LegacyObservationTruth {
  visiblePrice: number;
  currency: string;
  verifiedAt: string;
  note?: string;
}

export interface ObservationTruth extends LegacyObservationTruth {
  expectation: 'OBSERVATION';
  expectedVariant?: string;
}

export interface AbstentionTruth {
  expectation: 'ABSTAIN_VARIANT_AMBIGUITY';
  verifiedAt: string;
  variantPrices: number[];
  currency?: string;
  reason: string;
  note?: string;
}

export interface UnavailableTruth {
  expectation: 'UNAVAILABLE';
  verifiedAt: string;
  reason?: string;
  note?: string;
}

export interface BlockedTruth {
  expectation: 'BLOCKED';
  verifiedAt: string;
  reason?: string;
  note?: string;
}

export type TruthSample = LegacyObservationTruth | ObservationTruth | AbstentionTruth | UnavailableTruth | BlockedTruth;
export type TruthExpectation = 'OBSERVATION' | 'ABSTAIN_VARIANT_AMBIGUITY' | 'UNAVAILABLE' | 'BLOCKED';
export type ActualDecision = 'OBSERVATION' | 'ABSTAIN' | 'UNAVAILABLE' | 'BLOCKED';

export interface TruthEvaluation {
  state: TruthState;
  ageHours?: number;
  fresh: boolean;
  extracted: boolean;
  correct?: boolean;
}

export interface DecisionTruthEvaluation {
  expectation: TruthExpectation | 'NO_TRUTH';
  actualDecision: ActualDecision;
  fresh: boolean;
  ageHours?: number;
  decisionCorrect?: boolean;
  priceCorrect?: boolean;
  state: 'CORRECT' | 'INCORRECT' | 'STALE_TRUTH' | 'NO_TRUTH';
}

function normalizedExpectation(truth: TruthSample): TruthExpectation {
  return 'expectation' in truth ? truth.expectation : 'OBSERVATION';
}

function truthAge(truth: TruthSample, nowMs: number, maxTruthAgeHours: number) {
  const ageHours = (nowMs - new Date(truth.verifiedAt).getTime()) / 3_600_000;
  const fresh = Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= maxTruthAgeHours;
  return { ageHours:Number(ageHours.toFixed(2)), fresh };
}

export function evaluateTruth(
  truth: TruthSample | undefined,
  extracted: {price?:number;currency?:string},
  nowMs: number,
  maxTruthAgeHours: number,
): TruthEvaluation {
  if (!truth) return { state:'NO_TRUTH', fresh:false, extracted:extracted.price !== undefined };
  const { ageHours, fresh } = truthAge(truth, nowMs, maxTruthAgeHours);
  if (!fresh) return { state:'STALE_TRUTH', ageHours, fresh:false, extracted:extracted.price !== undefined };
  if (normalizedExpectation(truth) !== 'OBSERVATION') {
    return { state:extracted.price === undefined ? 'CORRECT' : 'INCORRECT', ageHours, fresh:true, extracted:extracted.price !== undefined, correct:extracted.price === undefined };
  }
  if (extracted.price === undefined || !extracted.currency) {
    return { state:'NOT_EXTRACTED', ageHours, fresh:true, extracted:false };
  }
  const observation = truth as LegacyObservationTruth;
  const correct = Math.abs(extracted.price - observation.visiblePrice) < 0.005
    && extracted.currency.toUpperCase() === observation.currency.toUpperCase();
  return {
    state:correct ? 'CORRECT' : 'INCORRECT',
    ageHours,
    fresh:true,
    extracted:true,
    correct,
  };
}

function actualDecision(input: {
  price?: number;
  currency?: string;
  challenge: boolean;
  httpStatus?: number;
}): ActualDecision {
  if (input.price !== undefined && input.currency) return 'OBSERVATION';
  if (input.challenge) return 'BLOCKED';
  if (input.httpStatus === 404 || input.httpStatus === 410) return 'UNAVAILABLE';
  return 'ABSTAIN';
}

export function evaluateDecisionTruth(
  truth: TruthSample | undefined,
  actual: {price?:number;currency?:string;challenge:boolean;httpStatus?:number},
  nowMs: number,
  maxTruthAgeHours: number,
): DecisionTruthEvaluation {
  const decision = actualDecision(actual);
  if (!truth) return { expectation:'NO_TRUTH', actualDecision:decision, fresh:false, state:'NO_TRUTH' };
  const expectation = normalizedExpectation(truth);
  const { ageHours, fresh } = truthAge(truth, nowMs, maxTruthAgeHours);
  if (!fresh) return { expectation, actualDecision:decision, fresh:false, ageHours, state:'STALE_TRUTH' };

  let priceCorrect: boolean | undefined;
  let decisionCorrect = false;
  if (expectation === 'OBSERVATION') {
    const observation = truth as LegacyObservationTruth;
    priceCorrect = decision === 'OBSERVATION'
      && actual.price !== undefined
      && Boolean(actual.currency)
      && Math.abs(actual.price - observation.visiblePrice) < 0.005
      && actual.currency!.toUpperCase() === observation.currency.toUpperCase();
    decisionCorrect = priceCorrect;
  } else if (expectation === 'ABSTAIN_VARIANT_AMBIGUITY') {
    decisionCorrect = decision === 'ABSTAIN';
  } else if (expectation === 'UNAVAILABLE') {
    decisionCorrect = decision === 'UNAVAILABLE';
  } else {
    decisionCorrect = decision === 'BLOCKED';
  }

  return {
    expectation,
    actualDecision:decision,
    fresh:true,
    ageHours,
    decisionCorrect,
    priceCorrect,
    state:decisionCorrect ? 'CORRECT' : 'INCORRECT',
  };
}

export function chooseFallbackDecision(input: {
  extracted: boolean;
  challenge: boolean;
  preferred?: FallbackDecision;
}): FallbackDecision {
  if (input.extracted) return 'NONE';
  if (input.challenge) return 'BLOCKED';
  return input.preferred ?? 'MANUAL_REVIEW';
}

function visibleDocumentText(html: string) {
  return html
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLikelyChallengePage(input: {
  status?: number;
  finalUrl?: string;
  html?: string;
}) {
  if (input.status && [401, 403, 407, 429].includes(input.status)) return true;
  if (input.finalUrl) {
    try {
      if (/\/blocked(?:[/?#]|$)/i.test(new URL(input.finalUrl).pathname)) return true;
    } catch {}
  }

  const visible = visibleDocumentText(input.html ?? '').slice(0, 100_000);
  if (!visible) return false;
  if (/verify you are human|robot or human|access denied|unusual traffic|automated access|complete (?:the )?security check|press and hold/i.test(visible)) return true;
  return visible.length < 50_000 && /\bcaptcha\b/i.test(visible);
}

function pct(n: number, d: number) {
  return d ? Number(((n / d) * 100).toFixed(1)) : null;
}

export function truthSummary(evaluations: TruthEvaluation[]) {
  const fresh = evaluations.filter((item) => item.fresh);
  const extracted = fresh.filter((item) => item.extracted);
  const correct = extracted.filter((item) => item.correct === true);
  return {
    freshTruthSamples:fresh.length,
    truthExtractedSamples:extracted.length,
    truthExtractionCoveragePct:pct(extracted.length, fresh.length) ?? 0,
    correctnessAmongExtractedTruthPct:pct(correct.length, extracted.length),
    endToEndCorrectCoveragePct:pct(correct.length, fresh.length) ?? 0,
  };
}

export function decisionTruthSummary(evaluations: DecisionTruthEvaluation[]) {
  const fresh = evaluations.filter((item) => item.fresh);
  const observations = fresh.filter((item) => item.expectation === 'OBSERVATION');
  const correctObservations = observations.filter((item) => item.decisionCorrect === true);
  const abstentions = fresh.filter((item) => item.expectation === 'ABSTAIN_VARIANT_AMBIGUITY');
  const correctAbstentions = abstentions.filter((item) => item.decisionCorrect === true);
  const unavailable = fresh.filter((item) => item.expectation === 'UNAVAILABLE');
  const correctUnavailable = unavailable.filter((item) => item.decisionCorrect === true);
  const blocked = fresh.filter((item) => item.expectation === 'BLOCKED');
  const correctBlocked = blocked.filter((item) => item.decisionCorrect === true);
  const correctAll = fresh.filter((item) => item.decisionCorrect === true);
  return {
    freshDecisionTruthSamples:fresh.length,
    expectedObservations:observations.length,
    correctObservations:correctObservations.length,
    observationPriceCorrectnessPct:pct(correctObservations.length, observations.length),
    expectedAbstentions:abstentions.length,
    correctAbstentions:correctAbstentions.length,
    abstentionAccuracyPct:pct(correctAbstentions.length, abstentions.length),
    expectedUnavailable:unavailable.length,
    correctUnavailable:correctUnavailable.length,
    unavailableAccuracyPct:pct(correctUnavailable.length, unavailable.length),
    expectedBlocked:blocked.length,
    correctBlocked:correctBlocked.length,
    blockedAccuracyPct:pct(correctBlocked.length, blocked.length),
    falsePriceObservations:observations.filter((item) => item.actualDecision === 'OBSERVATION' && item.priceCorrect === false).length,
    falseAbstentions:observations.filter((item) => item.actualDecision === 'ABSTAIN').length,
    overallDecisionAccuracyPct:pct(correctAll.length, fresh.length),
  };
}
