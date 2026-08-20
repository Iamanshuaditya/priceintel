export function hostnameOf(urlText: string) {
  try { return new URL(urlText).hostname.toLowerCase(); } catch { return ''; }
}

export function attrValue(html: string, tagName: string, keyAttr: string, keyValue: string, valueAttr: string) {
  const tags = html.match(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')) ?? [];
  for (const tag of tags) {
    const key = attribute(tag, keyAttr);
    if (key?.toLowerCase() !== keyValue.toLowerCase()) continue;
    const value = attribute(tag, valueAttr);
    if (value) return value;
  }
  return undefined;
}

export function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match?.[1];
}

export function scriptJson(html: string, predicate: (tag: string) => boolean): unknown[] {
  const results: unknown[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const tag = `<script${match[1]}>`;
    if (!predicate(tag)) continue;
    try { results.push(JSON.parse(match[2])); } catch { /* malformed evidence is ignored by an individual adapter */ }
  }
  return results;
}

export function objectAtPath(value: unknown, path: string[]): Record<string, unknown> | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : undefined;
}
