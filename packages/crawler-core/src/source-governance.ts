export type SourcePolicyStatus = 'APPROVED' | 'NOT_APPROVED' | 'REVIEW_REQUIRED';
export type SourceAccessMethod = 'PUBLIC_HTTP' | 'RETAILER_API' | 'LICENSED_PROVIDER' | 'BROWSER';
export type SourcePolicyBasis =
  | 'PUBLIC_TERMS_REVIEW'
  | 'WRITTEN_PERMISSION'
  | 'CONTRACT'
  | 'PROVIDER_LICENSE';

export interface SourcePolicy {
  sourceId: string;
  hostnamePatterns: string[];
  /** Methods for which this policy is the governing source record. */
  appliesToMethods: SourceAccessMethod[];
  status: SourcePolicyStatus;
  /** Methods actually authorized when status is APPROVED. */
  permittedMethods: SourceAccessMethod[];
  basis: SourcePolicyBasis;
  reviewedAt: string;
  reviewAfter?: string;
  evidenceReference: string;
  reason: string;
}

/**
 * Version-controlled source-governance registry.
 *
 * A retailer/source enters this runtime registry once PriceIntel has performed
 * an explicit source-acceptability review AND has a verified hostname/address
 * to govern. Unmatched URLs preserve the existing generic crawler behavior for
 * now; new retailer reliability programs should add a governed source record
 * before live measurement begins.
 *
 * Hostname alone is not sufficient source identity. `appliesToMethods` chooses
 * which record governs a concrete access method; `permittedMethods` records
 * which methods are actually authorized. This allows, for example, a denied
 * public website and a separately reviewed retailer API to share a DNS suffix
 * without relying on registry array order.
 *
 * Do not guess API hostnames merely to create a registry record. A reviewed
 * integration surface may remain documented as REVIEW_REQUIRED until its real
 * runtime endpoint and scope are verified.
 */
export const sourcePolicies: readonly SourcePolicy[] = [
  {
    sourceId:'BESTBUY_PUBLIC_WEB',
    hostnamePatterns:['bestbuy.com','*.bestbuy.com'],
    appliesToMethods:['PUBLIC_HTTP','BROWSER'],
    status:'NOT_APPROVED',
    permittedMethods:[],
    basis:'PUBLIC_TERMS_REVIEW',
    reviewedAt:'2026-08-21',
    reviewAfter:'2026-11-21',
    evidenceReference:'docs/research/BEST_BUY_SOURCE_DECISION.md',
    reason:'Best Buy automated source requires explicit written/licensed approval for PriceIntel use',
  },
  {
    sourceId:'WALMART_PUBLIC_WEB',
    hostnamePatterns:['walmart.com','*.walmart.com'],
    appliesToMethods:['PUBLIC_HTTP','BROWSER'],
    status:'NOT_APPROVED',
    permittedMethods:[],
    basis:'PUBLIC_TERMS_REVIEW',
    reviewedAt:'2026-08-21',
    reviewAfter:'2026-11-21',
    evidenceReference:'docs/research/WALMART_SOURCE_DECISION.md',
    reason:'Walmart public-web product/price collection is not approved for PriceIntel automated use under the reviewed public terms',
  },
  {
    sourceId:'WALMART_MARKETPLACE_API',
    hostnamePatterns:['marketplace.walmartapis.com'],
    appliesToMethods:['RETAILER_API'],
    status:'REVIEW_REQUIRED',
    permittedMethods:[],
    basis:'PUBLIC_TERMS_REVIEW',
    reviewedAt:'2026-08-21',
    reviewAfter:'2026-11-21',
    evidenceReference:'docs/research/WALMART_SOURCE_DECISION.md',
    reason:'Walmart Marketplace API access is seller/solution-provider scoped and requires use-case/onboarding review before PriceIntel can treat it as an approved competitor-intelligence source',
  },
  {
    sourceId:'TARGET_PUBLIC_WEB',
    hostnamePatterns:['target.com','*.target.com'],
    appliesToMethods:['PUBLIC_HTTP','BROWSER'],
    status:'NOT_APPROVED',
    permittedMethods:[],
    basis:'PUBLIC_TERMS_REVIEW',
    reviewedAt:'2026-08-21',
    reviewAfter:'2026-11-21',
    evidenceReference:'docs/research/TARGET_SOURCE_DECISION.md',
    reason:'Target public-web product/price collection is not approved for PriceIntel automated commercial monitoring under the reviewed public terms',
  },
  {
    sourceId:'HOME_DEPOT_PUBLIC_WEB',
    hostnamePatterns:['homedepot.com','*.homedepot.com'],
    appliesToMethods:['PUBLIC_HTTP','BROWSER'],
    status:'NOT_APPROVED',
    permittedMethods:[],
    basis:'PUBLIC_TERMS_REVIEW',
    reviewedAt:'2026-08-21',
    reviewAfter:'2026-11-21',
    evidenceReference:'docs/research/HOME_DEPOT_SOURCE_DECISION.md',
    reason:'Home Depot public-web product/price collection is not approved for PriceIntel automated commercial monitoring under the reviewed public terms',
  },
  {
    sourceId:'LOWES_PUBLIC_WEB',
    hostnamePatterns:['lowes.com','*.lowes.com'],
    appliesToMethods:['PUBLIC_HTTP','BROWSER'],
    status:'NOT_APPROVED',
    permittedMethods:[],
    basis:'PUBLIC_TERMS_REVIEW',
    reviewedAt:'2026-08-21',
    reviewAfter:'2026-11-21',
    evidenceReference:'docs/research/LOWES_SOURCE_DECISION.md',
    reason:'Lowe\'s public-web automated collection is not approved for PriceIntel under the reviewed site terms',
  },
  {
    sourceId:'LOWES_PARTNER_CATALOG_API',
    hostnamePatterns:['apis-b2b.lowes.com'],
    appliesToMethods:['RETAILER_API'],
    status:'REVIEW_REQUIRED',
    permittedMethods:[],
    basis:'PUBLIC_TERMS_REVIEW',
    reviewedAt:'2026-08-21',
    reviewAfter:'2026-11-21',
    evidenceReference:'docs/research/LOWES_SOURCE_DECISION.md',
    reason:'Lowe\'s Partner Product Catalog API is a verified structured pricing source, but PriceIntel must confirm agreement rights for competitor monitoring, retention, derived analytics, and customer presentation before use',
  },
];

function hostnameMatchesPattern(hostname: string, pattern: string) {
  const host = hostname.toLowerCase();
  const normalized = pattern.toLowerCase();
  if (!normalized.startsWith('*.')) return host === normalized;
  const suffix = normalized.slice(2);
  return host !== suffix && host.endsWith(`.${suffix}`);
}

function hostnamePatternsOverlap(a: string, b: string) {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) return true;

  const leftWildcard = left.startsWith('*.');
  const rightWildcard = right.startsWith('*.');
  const leftSuffix = leftWildcard ? left.slice(2) : left;
  const rightSuffix = rightWildcard ? right.slice(2) : right;

  if (leftWildcard && !rightWildcard) return hostnameMatchesPattern(right, left);
  if (!leftWildcard && rightWildcard) return hostnameMatchesPattern(left, right);
  if (!leftWildcard || !rightWildcard) return false;

  // Two wildcard domains overlap when one suffix is nested beneath the other.
  return leftSuffix.endsWith(`.${rightSuffix}`) || rightSuffix.endsWith(`.${leftSuffix}`);
}

export interface SourcePolicyConflict {
  sourceIds: [string,string];
  methods: SourceAccessMethod[];
  hostnamePatterns: [string,string][];
}

/** Deterministic registry validation used by CI; array order must never resolve ambiguity. */
export function sourcePolicyConflicts(policies: readonly SourcePolicy[] = sourcePolicies): SourcePolicyConflict[] {
  const conflicts: SourcePolicyConflict[] = [];
  for (let i = 0; i < policies.length; i += 1) {
    for (let j = i + 1; j < policies.length; j += 1) {
      const left = policies[i]!;
      const right = policies[j]!;
      const methods = left.appliesToMethods.filter((method) => right.appliesToMethods.includes(method));
      if (methods.length === 0) continue;
      const overlaps: [string,string][] = [];
      for (const a of left.hostnamePatterns) {
        for (const b of right.hostnamePatterns) {
          if (hostnamePatternsOverlap(a,b)) overlaps.push([a,b]);
        }
      }
      if (overlaps.length > 0) conflicts.push({ sourceIds:[left.sourceId,right.sourceId], methods, hostnamePatterns:overlaps });
    }
  }
  return conflicts;
}

export function sourcePoliciesForUrl(
  input: string,
  method: SourceAccessMethod = 'PUBLIC_HTTP',
): SourcePolicy[] {
  let host: string;
  try { host = new URL(input).hostname.toLowerCase(); }
  catch { return []; }
  return sourcePolicies.filter((policy) =>
    policy.appliesToMethods.includes(method)
    && policy.hostnamePatterns.some((pattern) => hostnameMatchesPattern(host, pattern))
  );
}

export function sourcePolicyForUrl(
  input: string,
  method: SourceAccessMethod = 'PUBLIC_HTTP',
): SourcePolicy | undefined {
  const matches = sourcePoliciesForUrl(input, method);
  if (matches.length > 1) {
    throw Object.assign(new Error(`Ambiguous source policy for ${method}: ${matches.map((policy) => policy.sourceId).join(', ')}`), {
      code:'SOURCE_POLICY_AMBIGUOUS',
      sourceIds:matches.map((policy) => policy.sourceId),
      method,
    });
  }
  return matches[0];
}

export function sourcePolicyForId(sourceId: string): SourcePolicy | undefined {
  return sourcePolicies.find((policy) => policy.sourceId === sourceId);
}
