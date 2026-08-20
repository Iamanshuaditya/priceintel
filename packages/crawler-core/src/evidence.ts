import { createHash } from 'node:crypto';

export interface ScriptEvidence {
  id?: string;
  type?: string;
  srcHost?: string;
  bytes: number;
  jsonTopLevelKeys?: string[];
  jsonRoot?: 'object' | 'array' | 'scalar' | 'invalid';
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

function jsonShape(body: string) {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return { jsonRoot:'array' as const };
    if (parsed && typeof parsed === 'object') {
      return {
        jsonRoot:'object' as const,
        jsonTopLevelKeys:Object.keys(parsed as Record<string, unknown>).slice(0, 20),
      };
    }
    return { jsonRoot:'scalar' as const };
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
        srcHost = new URL(src, 'https://diagnostic.invalid').hostname;
        if (srcHost !== 'diagnostic.invalid') hosts.add(srcHost);
      } catch {}
    }
    const entry: ScriptEvidence = {
      id:id || undefined,
      type:type || undefined,
      srcHost,
      bytes:Buffer.byteLength(body),
    };
    const likelyJson = type?.toLowerCase().includes('json') || Boolean(id && /data|state|payload|props|hydr/i.test(id));
    if (likelyJson && body.length <= 2 * 1024 * 1024) Object.assign(entry, jsonShape(body.trim()));
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
