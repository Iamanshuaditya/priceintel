import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net, { type LookupFunction } from 'node:net';
import type { IncomingMessage } from 'node:http';

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

function normalizedIp(address: string): string {
  const normalized = address.toLowerCase();
  if (!normalized.startsWith('::ffff:')) return normalized;
  const mapped = normalized.slice('::ffff:'.length);
  if (net.isIP(mapped) === 4) return mapped;
  const parts = mapped.split(':');
  if (parts.length === 2 && parts.every((part) => /^[0-9a-f]{1,4}$/.test(part))) {
    const high = Number.parseInt(parts[0], 16);
    const low = Number.parseInt(parts[1], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return normalized;
}

export function isPrivateOrLocalIp(address: string): boolean {
  const normalized = normalizedIp(address);
  const version = net.isIP(normalized);
  if (version === 4) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
      ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ].some(([start, prefix]) => inV4Range(normalized, start as string, prefix as number));
  }
  if (version === 6) {
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    if (normalized.startsWith('ff')) return true;
  }
  return false;
}

export type Resolver = (hostname: string) => Promise<string[]>;
const defaultResolver: Resolver = async (hostname) => {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

export interface ResolvedPublicTarget {
  url: URL;
  approvedAddresses: string[];
}

export async function resolvePublicHttpUrl(input: string, resolver: Resolver = defaultResolver): Promise<ResolvedPublicTarget> {
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
    return { url, approvedAddresses: [hostname] };
  }
  const addresses = [...new Set((await resolver(hostname)).map(normalizedIp))];
  if (addresses.length === 0) throw new UnsafeTargetError('DNS_EMPTY', 'Hostname did not resolve');
  if (addresses.some((address) => !net.isIP(address) || isPrivateOrLocalIp(address))) {
    throw new UnsafeTargetError('PRIVATE_DNS_RESULT', 'Hostname resolves to a private/local or invalid IP');
  }
  return { url, approvedAddresses: addresses };
}

export async function assertPublicHttpUrl(input: string, resolver: Resolver = defaultResolver): Promise<URL> {
  return (await resolvePublicHttpUrl(input, resolver)).url;
}

export interface FetchLikeResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface PinnedTransportInput {
  url: URL;
  approvedAddresses: string[];
  signal?: AbortSignal;
  maxResponseBytes?: number;
}
export type PinnedTransport = (input: PinnedTransportInput) => Promise<FetchLikeResponse>;

function responseHeaders(message: IncomingMessage) {
  return {
    get(name: string) {
      const value = message.headers[name.toLowerCase()];
      if (Array.isArray(value)) return value.join(', ');
      return value ?? null;
    },
  };
}

function assertPeerAddress(remoteAddress: string | undefined, approvedAddresses: string[]) {
  if (!remoteAddress) throw new UnsafeTargetError('PEER_ADDRESS_UNKNOWN', 'Connected peer address is unavailable');
  const normalizedRemote = normalizedIp(remoteAddress);
  if (isPrivateOrLocalIp(normalizedRemote)) throw new UnsafeTargetError('PEER_ADDRESS_PRIVATE', 'Connected peer is private/local');
  const approved = new Set(approvedAddresses.map(normalizedIp));
  if (!approved.has(normalizedRemote)) throw new UnsafeTargetError('PEER_ADDRESS_MISMATCH', 'Connected peer does not match the validated DNS result');
}

export function createPinnedLookup(address: string): LookupFunction {
  const family = net.isIP(address);
  if (family !== 4 && family !== 6) throw new UnsafeTargetError('INVALID_APPROVED_IP', 'Pinned lookup requires a valid IP address');
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

async function requestPinnedAddress(input: PinnedTransportInput, address: string): Promise<FetchLikeResponse> {
  return await new Promise<FetchLikeResponse>((resolve, reject) => {
    const isHttps = input.url.protocol === 'https:';
    const requestFn = isHttps ? https.request : http.request;
    const family = net.isIP(address);
    const request = requestFn({
      protocol: input.url.protocol,
      hostname: input.url.hostname,
      port: input.url.port || undefined,
      path: `${input.url.pathname}${input.url.search}`,
      method: 'GET',
      headers: { host: input.url.host, 'user-agent': 'PriceIntel/0.1 (+crawler)' },
      servername: isHttps ? input.url.hostname : undefined,
      agent: false,
      family,
      autoSelectFamily: false,
      lookup: createPinnedLookup(address),
      signal: input.signal,
    }, (message) => {
      try { assertPeerAddress(message.socket.remoteAddress, input.approvedAddresses); }
      catch (error) { message.destroy(error as Error); return reject(error); }

      const chunks: Buffer[] = [];
      let size = 0;
      const maxResponseBytes = input.maxResponseBytes ?? 5 * 1024 * 1024;
      message.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          const error = new UnsafeTargetError('RESPONSE_TOO_LARGE', 'Response exceeded configured size limit');
          message.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      message.on('error', reject);
      message.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: message.statusCode ?? 0,
          headers: responseHeaders(message),
          text: async () => body,
        });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

export const nodePinnedTransport: PinnedTransport = async (input) => {
  let lastError: unknown;
  for (const address of input.approvedAddresses) {
    try { return await requestPinnedAddress(input, address); }
    catch (error) { lastError = error; }
  }
  throw lastError ?? new UnsafeTargetError('CONNECT_FAILED', 'No approved address could be reached');
};

export async function secureFetch(input: string, options: {
  resolver?: Resolver;
  transport?: PinnedTransport;
  maxRedirects?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
} = {}) {
  const resolver = options.resolver ?? defaultResolver;
  const transport = options.transport ?? nodePinnedTransport;
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let current = input;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const target = await resolvePublicHttpUrl(current, resolver);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: FetchLikeResponse;
    try {
      response = await transport({
        ...target,
        signal: controller.signal,
        maxResponseBytes: options.maxResponseBytes,
      });
    } finally { clearTimeout(timeout); }

    if ([301,302,303,307,308].includes(response.status)) {
      if (redirectCount === maxRedirects) throw new UnsafeTargetError('TOO_MANY_REDIRECTS', 'Redirect limit exceeded');
      const location = response.headers.get('location');
      if (!location) throw new UnsafeTargetError('REDIRECT_WITHOUT_LOCATION', 'Redirect has no location');
      current = new URL(location, target.url).toString();
      continue;
    }
    return { response, finalUrl: target.url.toString(), redirectCount, approvedAddresses: target.approvedAddresses };
  }
  throw new UnsafeTargetError('TOO_MANY_REDIRECTS', 'Redirect limit exceeded');
}
