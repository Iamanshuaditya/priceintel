import dns from 'node:dns/promises';
import net from 'node:net';

export class UnsafeTargetError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'UnsafeTargetError';
    this.code = code;
  }
}

function ipv4ToInt(ip: string) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}
function inV4Range(ip: string, start: string, prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(start) & mask);
}

export function isPrivateOrLocalIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
      ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ].some(([start, prefix]) => inV4Range(address, start as string, prefix as number));
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    if (normalized.startsWith('ff')) return true;
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      if (net.isIP(mapped) === 4) return isPrivateOrLocalIp(mapped);
      const parts = mapped.split(':');
      if (parts.length === 2 && parts.every((part) => /^[0-9a-f]{1,4}$/.test(part))) {
        const high = Number.parseInt(parts[0], 16);
        const low = Number.parseInt(parts[1], 16);
        const mappedV4 = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
        return isPrivateOrLocalIp(mappedV4);
      }
    }
  }
  return false;
}

export type Resolver = (hostname: string) => Promise<string[]>;
const defaultResolver: Resolver = async (hostname) => {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

export async function assertPublicHttpUrl(input: string, resolver: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try { url = new URL(input); } catch { throw new UnsafeTargetError('INVALID_URL', 'URL is invalid'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeTargetError('UNSUPPORTED_PROTOCOL', 'Only HTTP(S) URLs are allowed');
  if (url.username || url.password) throw new UnsafeTargetError('CREDENTIALS_IN_URL', 'Credential-bearing URLs are not allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname || hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost')) {
    throw new UnsafeTargetError('LOCALHOST_BLOCKED', 'Localhost is not allowed');
  }
  if (net.isIP(hostname)) {
    if (isPrivateOrLocalIp(hostname)) throw new UnsafeTargetError('PRIVATE_IP_BLOCKED', 'Private/local IP is not allowed');
    return url;
  }
  const addresses = await resolver(hostname);
  if (addresses.length === 0) throw new UnsafeTargetError('DNS_EMPTY', 'Hostname did not resolve');
  if (addresses.some(isPrivateOrLocalIp)) throw new UnsafeTargetError('PRIVATE_DNS_RESULT', 'Hostname resolves to a private/local IP');
  return url;
}

export interface FetchLikeResponse { status: number; headers: { get(name: string): string | null }; text(): Promise<string> }
export type FetchLike = (url: string, init: { redirect: 'manual'; signal?: AbortSignal }) => Promise<FetchLikeResponse>;

export async function secureFetch(input: string, options: { resolver?: Resolver; fetchImpl?: FetchLike; maxRedirects?: number; timeoutMs?: number } = {}) {
  const resolver = options.resolver ?? defaultResolver;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let current = input;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const safeUrl = await assertPublicHttpUrl(current, resolver);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: FetchLikeResponse;
    try { response = await fetchImpl(safeUrl.toString(), { redirect: 'manual', signal: controller.signal }); }
    finally { clearTimeout(timeout); }

    if ([301,302,303,307,308].includes(response.status)) {
      if (redirectCount === maxRedirects) throw new UnsafeTargetError('TOO_MANY_REDIRECTS', 'Redirect limit exceeded');
      const location = response.headers.get('location');
      if (!location) throw new UnsafeTargetError('REDIRECT_WITHOUT_LOCATION', 'Redirect has no location');
      current = new URL(location, safeUrl).toString();
      continue;
    }
    return { response, finalUrl: safeUrl.toString(), redirectCount };
  }
  throw new UnsafeTargetError('TOO_MANY_REDIRECTS', 'Redirect limit exceeded');
}
