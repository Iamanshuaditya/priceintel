import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { collectHtmlDiagnosticEvidence } from '../packages/crawler-core/src/evidence.ts';
import { secureFetch } from '../packages/crawler-core/src/url-policy.ts';

interface CorpusEntry { id:string; retailer:string; url:string }

const corpus = JSON.parse(await readFile('tests/live-canary/corpus.json', 'utf8')) as CorpusEntry[];
const targets = corpus.filter((entry) => entry.retailer === 'Gymshark');
const diagnostics = [];
for (const entry of targets) {
  try {
    const fetched = await secureFetch(entry.url, { timeoutMs:20_000, maxResponseBytes:10 * 1024 * 1024 });
    const html = await fetched.response.text();
    diagnostics.push({
      id:entry.id,
      retailer:entry.retailer,
      requestedUrl:entry.url,
      finalUrl:fetched.finalUrl,
      httpStatus:fetched.response.status,
      contentType:fetched.response.headers.get('content-type'),
      evidence:collectHtmlDiagnosticEvidence(html),
    });
  } catch (error) {
    diagnostics.push({
      id:entry.id,
      retailer:entry.retailer,
      requestedUrl:entry.url,
      errorCode:(error as {code?:string}).code ?? (error instanceof Error ? error.name : 'UNKNOWN_ERROR'),
    });
  }
}
await mkdir('artifacts/reliability', { recursive:true });
await writeFile('artifacts/reliability/diagnostics.json', `${JSON.stringify({runAt:new Date().toISOString(),targets:diagnostics}, null, 2)}\n`);
console.log(`Wrote bounded diagnostics for ${diagnostics.length} Gymshark targets`);
