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
  status: SourcePolicyStatus;
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
 * Do not guess API hostnames merely to create a registry record. A reviewed
 * integration surface may remain documented as REVIEW_REQUIRED until its real
 * runtime endpoint and scope are verified.
 */
export const sourcePolicies: readonly SourcePolicy[] = [
  {
    sourceId:'BESTBUY_PUBLIC_WEB',
    hostnamePatterns:['bestbuy.com','*.bestbuy.com'],
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
    status:'NOT_APPROVED',
    permittedMethods:[],
    basis:'PUBLIC_TERMS_REVIEW',
    reviewedAt:'2026-08-21',
    reviewAfter:'2026-11-21',
    evidenceReference:'docs/research/HOME_DEPOT_SOURCE_DECISION.md',
    reason:'Home Depot public-web product/price collection is not approved for PriceIntel automated commercial monitoring under the reviewed public terms',
  },
];

function hostnameMatchesPattern(hostname: string, pattern: string) {
  const host = hostname.toLowerCase();
  const normalized = pattern.toLowerCase();
  if (!normalized.startsWith('*.')) return host === normalized;
  const suffix = normalized.slice(2);
  return host !== suffix && host.endsWith(`.${suffix}`);
}

export function sourcePolicyForUrl(input: string): SourcePolicy | undefined {
  let host: string;
  try { host = new URL(input).hostname.toLowerCase(); }
  catch { return undefined; }
  return sourcePolicies.find((policy) => policy.hostnamePatterns.some((pattern) => hostnameMatchesPattern(host, pattern)));
}

export function sourcePolicyForId(sourceId: string): SourcePolicy | undefined {
  return sourcePolicies.find((policy) => policy.sourceId === sourceId);
}
