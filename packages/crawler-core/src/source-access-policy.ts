export interface SourceAccessDecision {
  allowed: boolean;
  sourceId?: 'BESTBUY_PUBLIC_WEB';
  code?: 'SOURCE_NOT_APPROVED';
  nextAction?: 'MANUAL_REVIEW';
  reason?: string;
}

function hostname(url: string) {
  try { return new URL(url).hostname.toLowerCase(); }
  catch { return ''; }
}

/**
 * Operational source-permission gate, separate from parser capability.
 *
 * The Best Buy adapter remains useful for deterministic fixtures and for a
 * future source that is explicitly approved. Current public BestBuy.com and
 * Developer API terms do not establish permission for PriceIntel's automated
 * third-party competitor-price use, so production/live canary HTTP access is
 * failed closed pending an intentional approval change.
 */
export function evaluateAutomatedSourceAccess(url: string): SourceAccessDecision {
  const host = hostname(url);
  if (host === 'bestbuy.com' || host.endsWith('.bestbuy.com')) {
    return {
      allowed:false,
      sourceId:'BESTBUY_PUBLIC_WEB',
      code:'SOURCE_NOT_APPROVED',
      nextAction:'MANUAL_REVIEW',
      reason:'Best Buy automated source requires explicit written/licensed approval for PriceIntel use',
    };
  }
  return { allowed:true };
}

export function assertAutomatedSourceAccess(url: string) {
  const decision = evaluateAutomatedSourceAccess(url);
  if (!decision.allowed) {
    throw Object.assign(new Error(decision.reason ?? 'Automated source is not approved'), {
      code:decision.code ?? 'SOURCE_NOT_APPROVED',
      sourceId:decision.sourceId,
      nextAction:decision.nextAction,
    });
  }
  return decision;
}
