export type TruthState = 'CORRECT' | 'INCORRECT' | 'NOT_EXTRACTED' | 'STALE_TRUTH' | 'NO_TRUTH';
export type FallbackDecision =
  | 'NONE'
  | 'SUPPLEMENTARY_HTTP'
  | 'BROWSER_RENDER'
  | 'APPROVED_API'
  | 'APPROVED_DATA_PROVIDER'
  | 'BLOCKED'
  | 'MANUAL_REVIEW';

export interface TruthSample {
  visiblePrice: number;
  currency: string;
  verifiedAt: string;
}

export interface TruthEvaluation {
  state: TruthState;
  ageHours?: number;
  fresh: boolean;
  extracted: boolean;
  correct?: boolean;
}

export function evaluateTruth(
  truth: TruthSample | undefined,
  extracted: {price?:number;currency?:string},
  nowMs: number,
  maxTruthAgeHours: number,
): TruthEvaluation {
  if (!truth) return { state:'NO_TRUTH', fresh:false, extracted:extracted.price !== undefined };
  const ageHours = (nowMs - new Date(truth.verifiedAt).getTime()) / 3_600_000;
  const fresh = Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= maxTruthAgeHours;
  if (!fresh) return { state:'STALE_TRUTH', ageHours:Number(ageHours.toFixed(2)), fresh:false, extracted:extracted.price !== undefined };
  if (extracted.price === undefined || !extracted.currency) {
    return { state:'NOT_EXTRACTED', ageHours:Number(ageHours.toFixed(2)), fresh:true, extracted:false };
  }
  const correct = Math.abs(extracted.price - truth.visiblePrice) < 0.005
    && extracted.currency.toUpperCase() === truth.currency.toUpperCase();
  return {
    state:correct ? 'CORRECT' : 'INCORRECT',
    ageHours:Number(ageHours.toFixed(2)),
    fresh:true,
    extracted:true,
    correct,
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

export function truthSummary(evaluations: TruthEvaluation[]) {
  const fresh = evaluations.filter((item) => item.fresh);
  const extracted = fresh.filter((item) => item.extracted);
  const correct = extracted.filter((item) => item.correct === true);
  const pct = (n: number, d: number) => d ? Number(((n / d) * 100).toFixed(1)) : null;
  return {
    freshTruthSamples:fresh.length,
    truthExtractedSamples:extracted.length,
    truthExtractionCoveragePct:pct(extracted.length, fresh.length) ?? 0,
    correctnessAmongExtractedTruthPct:pct(correct.length, extracted.length),
    endToEndCorrectCoveragePct:pct(correct.length, fresh.length) ?? 0,
  };
}
