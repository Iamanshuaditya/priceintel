import { createHash } from 'node:crypto';

export interface JsonSignal {
  path: string;
  value: string | number | boolean | null;
}

export interface ScriptEvidence {
  id?: string;
  type?: string;
  srcHost?: string;
  bytes: number;
  jsonTopLevelKeys?: string[];
  jsonRoot?: 'object' | 'array' | 'scalar' | 'invalid';
  commerceSignals?: JsonSignal[];
}

export interface HtmlDiagnosticEvidence {
  sha256: string;
  bytes: number;
  markers: Record<string, boolean>;
  scriptCount: number;
  scripts: ScriptEvidence[];
  externalScriptHosts: string[];
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2];
}

function primitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string','number','boolean'].includes(typeof value);
}

function commerceSignals(value: unknown, maxSignals = 200) {
  const signals: JsonSignal[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown, path: string[], depth: number) => {
    if (signals.length >= maxSignals || depth > 24 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length && signals.length < maxSignals; index += 1) visit(node[index], [...path, String(index)], depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (signals.length >= maxSignals) break;
      const nextPath = [...path, key];
      if (primitive(child) && /(price|currency|availability|stock|compare.?at|sale)/i.test(key)) {
        const normalized = typeof child === 'string' ? child.slice(0, 100) : child;
        const signature = `${nextPath.join('.')}|${String(normalized)}`;
        if (!seen.has(signature)) {
          seen.add(signature);
          signals.push({ path:nextPath.join('.'), value:normalized });
        }
      } else if (child && typeof child === 'object') visit(child, nextPath, depth + 1);
    }
  };
  visit(value, [], 0);
  return signals;
}

function jsonShape(body: string, includeCommerceSignals: boolean) {
  try {
    const parsed = JSON.parse(body) as unknown;
    const signals = includeCommerceSignals ? commerceSignals(parsed) : undefined;
    if (Array.isArray(parsed)) return { jsonRoot:'array' as const, commerceSignals:signals };
    if (parsed && typeof parsed === 'object') {
      return {
        jsonRoot:'object' as const,
        jsonTopLevelKeys:Object.keys(parsed as Record<string, unknown>).slice(0, 20),
        commerceSignals:signals,
      };
    }
    return { jsonRoot:'scalar' as const, commerceSignals:signals };
  } catch {
    return { jsonRoot:'invalid' as const };
  }
}

export function collectHtmlDiagnosticEvidence(html: string, maxScripts = 60): HtmlDiagnosticEvidence {
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const scripts: ScriptEvidence[] = [];
  const hosts = new Set<string>();
  let totalScripts = 0;
  for (const match of html.matchAll(scriptRegex)) {
    totalScripts += 1;
    if (scripts.length >= maxScripts) continue;
    const tag = `<script${match[1]}>`;
    const body = match[2] ?? '';
    const id = attribute(tag, 'id');
    const type = attribute(tag, 'type');
    const src = attribute(tag, 'src');
    let srcHost: string | undefined;
    if (src) {
      try {
        const parsed = new URL(src, 'https://diagnostic.invalid');
        if (parsed.hostname !== 'diagnostic.invalid') {
          srcHost = parsed.hostname;
          hosts.add(parsed.hostname);
        }
      } catch {}
    }
    const entry: ScriptEvidence = {
      id:id || undefined,
      type:type || undefined,
      srcHost,
      bytes:Buffer.byteLength(body),
    };
    const likelyJson = type?.toLowerCase().includes('json') || Boolean(id && /data|state|payload|props|hydr/i.test(id));
    if (likelyJson && body.length <= 2 * 1024 * 1024) {
      Object.assign(entry, jsonShape(body.trim(), id === '__NEXT_DATA__'));
    }
    scripts.push(entry);
  }

  const markers: Record<string, boolean> = {
    nextData:/__NEXT_DATA__/i.test(html),
    nuxt:/__NUXT__|__NUXT_DATA__/i.test(html),
    remix:/__remixContext|__remixManifest/i.test(html),
    apollo:/__APOLLO_STATE__|ApolloClient/i.test(html),
    relay:/__RELAY_STORE__|RelayEnvironment/i.test(html),
    shopify:/Shopify\.|cdn\.shopify\.com|shopify-section/i.test(html),
    hydration:/hydration|hydrateRoot|__INITIAL_STATE__|__PRELOADED_STATE__/i.test(html),
    webpack:/webpackChunk|__webpack_require__/i.test(html),
  };

  return {
    sha256:createHash('sha256').update(html).digest('hex'),
    bytes:Buffer.byteLength(html),
    markers,
    scriptCount:totalScripts,
    scripts,
    externalScriptHosts:[...hosts].slice(0, 30),
  };
}
