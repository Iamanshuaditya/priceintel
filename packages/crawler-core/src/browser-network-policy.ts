import { resolvePublicHttpUrl, UnsafeTargetError, type Resolver } from './url-policy.ts';

export interface BrowserNetworkDecision {
  action: 'ALLOW' | 'BLOCK';
  code?: string;
  approvedAddresses?: string[];
  url?: string;
}

export const browserContextSecurityOptions = {
  serviceWorkers: 'block' as const,
};

export const BROWSER_EGRESS_INVARIANT =
  'Playwright request routing is defense in depth, not DNS pinning. Production browser workers must also run behind network egress controls that deny private/local/link-local/metadata destinations.';

function blocked(error: unknown): BrowserNetworkDecision {
  return {
    action:'BLOCK',
    code:(error as {code?:string}).code ?? 'BROWSER_NETWORK_BLOCKED',
  };
}

export async function evaluateBrowserHttpRequest(url: string, resolver?: Resolver): Promise<BrowserNetworkDecision> {
  try {
    const target = await resolvePublicHttpUrl(url, resolver);
    return { action:'ALLOW', url:target.url.toString(), approvedAddresses:target.approvedAddresses };
  } catch (error) {
    return blocked(error);
  }
}

export async function evaluateBrowserWebSocketRequest(url: string, resolver?: Resolver): Promise<BrowserNetworkDecision> {
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { return { action:'BLOCK', code:'INVALID_URL' }; }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return { action:'BLOCK', code:'UNSUPPORTED_WEBSOCKET_PROTOCOL' };
  }
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  return evaluateBrowserHttpRequest(parsed.toString(), resolver);
}

export interface BrowserRouteLike {
  request(): { url(): string };
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}

export async function enforceBrowserHttpRoute(route: BrowserRouteLike, resolver?: Resolver) {
  const decision = await evaluateBrowserHttpRequest(route.request().url(), resolver);
  if (decision.action === 'BLOCK') {
    await route.abort('blockedbyclient');
    return decision;
  }
  await route.continue();
  return decision;
}

export function assertBrowserEgressConfigured(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.NODE_ENV !== 'production') return;
  if (environment.BROWSER_EGRESS_PRIVATE_DENY !== '1') {
    throw new UnsafeTargetError(
      'BROWSER_EGRESS_POLICY_REQUIRED',
      'Production browser crawling requires network-level private/local egress denial in addition to Playwright routing',
    );
  }
}
