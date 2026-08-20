import {
  sourcePolicyForUrl,
  type SourceAccessMethod,
  type SourcePolicyStatus,
} from './source-governance.ts';

export interface SourceAccessDecision {
  allowed: boolean;
  sourceId?: string;
  status?: SourcePolicyStatus;
  method?: SourceAccessMethod;
  code?: 'SOURCE_NOT_APPROVED' | 'SOURCE_REVIEW_REQUIRED';
  nextAction?: 'MANUAL_REVIEW';
  reason?: string;
  evidenceReference?: string;
  reviewedAt?: string;
  reviewAfter?: string;
}

/**
 * Operational source-permission gate, separate from parser capability.
 *
 * Reviewed sources are governed by the version-controlled source registry.
 * Policy matching is method-aware so overlapping host namespaces do not depend
 * on registry order. Unmatched URLs preserve the existing generic-crawler
 * behavior for now; new retailer reliability programs should register source
 * acceptability before live measurement begins.
 */
export function evaluateAutomatedSourceAccess(
  url: string,
  method: SourceAccessMethod = 'PUBLIC_HTTP',
): SourceAccessDecision {
  const policy = sourcePolicyForUrl(url, method);
  if (!policy) return { allowed:true };

  if (policy.status === 'APPROVED' && policy.permittedMethods.includes(method)) {
    return {
      allowed:true,
      sourceId:policy.sourceId,
      status:policy.status,
      method,
      evidenceReference:policy.evidenceReference,
      reviewedAt:policy.reviewedAt,
      reviewAfter:policy.reviewAfter,
    };
  }

  const code = policy.status === 'REVIEW_REQUIRED'
    ? 'SOURCE_REVIEW_REQUIRED' as const
    : 'SOURCE_NOT_APPROVED' as const;

  return {
    allowed:false,
    sourceId:policy.sourceId,
    status:policy.status,
    method,
    code,
    nextAction:'MANUAL_REVIEW',
    reason:policy.reason,
    evidenceReference:policy.evidenceReference,
    reviewedAt:policy.reviewedAt,
    reviewAfter:policy.reviewAfter,
  };
}

export function assertAutomatedSourceAccess(
  url: string,
  method: SourceAccessMethod = 'PUBLIC_HTTP',
) {
  const decision = evaluateAutomatedSourceAccess(url, method);
  if (!decision.allowed) {
    throw Object.assign(new Error(decision.reason ?? 'Automated source is not approved'), {
      code:decision.code ?? 'SOURCE_NOT_APPROVED',
      sourceId:decision.sourceId,
      status:decision.status,
      method:decision.method,
      nextAction:decision.nextAction,
      evidenceReference:decision.evidenceReference,
      reviewedAt:decision.reviewedAt,
      reviewAfter:decision.reviewAfter,
    });
  }
  return decision;
}
