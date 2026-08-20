import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { extractWithAdapters, selectAdapterCandidate } from '../packages/crawler-core/src/adapters/registry.ts';
import { secureFetch } from '../packages/crawler-core/src/url-policy.ts';

interface CorpusEntry {
  id: string;
  retailer: string;
  url: string;
  expectedAdapter?: string;
}

interface ManualTruth {
  visiblePrice: number;
  currency: string;
  verifiedAt: string;
  note?: string;
}

type TruthFile = Record<string, ManualTruth>;

interface AttemptResult {
  id: string;
  retailer: string;
  url: string;
  finalUrl?: string;
  fetchMethod: 'HTTP_PINNED';
  httpStatus?: number;
  challenge: boolean;
  bytesDownloaded: number;
  adapter?: string;
  adapterVersion?: string;
  extractionMethod?: string;
  sourcePath?: string;
  price?: number;
  currency?: string;
  stockStatus?: string;
  sellerName?: string;
  confidence?: number;
  expectedAdapter?: string;
  expectedAdapterMatched?: boolean;
  browserFallbackRecommended: boolean;
  retryCount: number;
  fetchDurationMs: number;
  extractionDurationMs: number;
  totalDurationMs: number;
  errorCode?: string;
  adapterAttempts?: unknown[];
  manualTruth?: ManualTruth & { ageHours:number; fresh:boolean; correct?:boolean };
}

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function errorCode(error: unknown) {
  return (error as {code?:string}).code ?? (error instanceof Error ? error.name : 'UNKNOWN_ERROR');
}

function isChallenge(status: number | undefined, html: string) {
  if (status && [401, 403, 407, 429].includes(status)) return true;
  return /verify you are human|captcha|access denied|robot or human|automated access|unusual traffic/i.test(html.slice(0, 250_000));
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

function ratio(numerator: number, denominator: number) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

async function runOne(entry: CorpusEntry, truth: TruthFile, maxTruthAgeHours: number): Promise<AttemptResult> {
  const totalStart = performance.now();
  let html = '';
  let fetchDurationMs = 0;
  try {
    const fetchStart = performance.now();
    const fetched = await secureFetch(entry.url, { timeoutMs:20_000, maxResponseBytes:10 * 1024 * 1024 });
    const body = await fetched.response.text();
    fetchDurationMs = Math.round(performance.now() - fetchStart);
    html = body;
    const challenge = isChallenge(fetched.response.status, body);
    const artifact = {
      requestedUrl: entry.url,
      finalUrl: fetched.finalUrl,
      html: body,
      fetchedAt: new Date(),
      status: fetched.response.status,
      contentType: fetched.response.headers.get('content-type') ?? undefined,
      bytesDownloaded: Buffer.byteLength(body),
    };
    const extractionStart = performance.now();
    const extraction = extractWithAdapters(artifact);
    let selected;
    let selectionError: unknown;
    try { selected = selectAdapterCandidate(extraction.candidates); }
    catch (error) { selectionError = error; }
    const extractionDurationMs = Math.round(performance.now() - extractionStart);
    const manual = truth[entry.id];
    let manualTruth: AttemptResult['manualTruth'];
    if (manual) {
      const ageHours = (Date.now() - new Date(manual.verifiedAt).getTime()) / 3_600_000;
      const fresh = Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= maxTruthAgeHours;
      const correct = fresh && selected
        ? Math.abs(selected.price - manual.visiblePrice) < 0.005 && selected.currency === manual.currency.toUpperCase()
        : undefined;
      manualTruth = { ...manual, ageHours:Number(ageHours.toFixed(2)), fresh, correct };
    }
    return {
      id:entry.id,
      retailer:entry.retailer,
      url:entry.url,
      finalUrl:fetched.finalUrl,
      fetchMethod:'HTTP_PINNED',
      httpStatus:fetched.response.status,
      challenge,
      bytesDownloaded:artifact.bytesDownloaded,
      adapter:selected?.provenance.adapterId,
      adapterVersion:selected?.provenance.adapterVersion,
      extractionMethod:selected?.sourceMethod,
      sourcePath:selected?.provenance.sourcePath,
      price:selected?.price,
      currency:selected?.currency,
      stockStatus:selected?.stockStatus,
      sellerName:selected?.sellerName,
      confidence:selected?.confidence,
      expectedAdapter:entry.expectedAdapter,
      expectedAdapterMatched:entry.expectedAdapter ? selected?.provenance.adapterId === entry.expectedAdapter : undefined,
      browserFallbackRecommended:challenge || !selected || selected.confidence < 0.9,
      retryCount:0,
      fetchDurationMs,
      extractionDurationMs,
      totalDurationMs:Math.round(performance.now() - totalStart),
      errorCode:selectionError ? errorCode(selectionError) : undefined,
      adapterAttempts:extraction.attempts,
      manualTruth,
    };
  } catch (error) {
    return {
      id:entry.id,
      retailer:entry.retailer,
      url:entry.url,
      fetchMethod:'HTTP_PINNED',
      challenge:isChallenge(undefined, html),
      bytesDownloaded:html ? Buffer.byteLength(html) : 0,
      expectedAdapter:entry.expectedAdapter,
      browserFallbackRecommended:true,
      retryCount:0,
      fetchDurationMs:fetchDurationMs || Math.round(performance.now() - totalStart),
      extractionDurationMs:0,
      totalDurationMs:Math.round(performance.now() - totalStart),
      errorCode:errorCode(error),
    };
  }
}

function summarize(attempts: AttemptResult[]) {
  const extracted = attempts.filter((item) => item.price !== undefined);
  const freshTruth = attempts.filter((item) => item.manualTruth?.fresh);
  const correctTruth = freshTruth.filter((item) => item.manualTruth?.correct === true);
  const retailers = [...new Set(attempts.map((item) => item.retailer))].sort();
  return {
    urlsTested:attempts.length,
    httpFetchSuccessPct:ratio(attempts.filter((item) => item.httpStatus !== undefined && item.httpStatus >= 200 && item.httpStatus < 400).length, attempts.length),
    validatedExtractionPct:ratio(extracted.length, attempts.length),
    priceExtractionPct:ratio(extracted.length, attempts.length),
    stockExtractionPct:ratio(attempts.filter((item) => item.stockStatus && item.stockStatus !== 'UNKNOWN').length, attempts.length),
    browserFallbackRecommendedPct:ratio(attempts.filter((item) => item.browserFallbackRecommended).length, attempts.length),
    blockedOrChallengePct:ratio(attempts.filter((item) => item.challenge).length, attempts.length),
    parseFailurePct:ratio(attempts.filter((item) => item.errorCode === 'PARSE_FAILED' || item.errorCode === 'CANDIDATE_DISAGREEMENT').length, attempts.length),
    medianCrawlMs:percentile(attempts.map((item) => item.totalDurationMs), 50),
    p95CrawlMs:percentile(attempts.map((item) => item.totalDurationMs), 95),
    manualTruthFreshSamples:freshTruth.length,
    manualTruthCorrectPct:ratio(correctTruth.length, freshTruth.length),
    perRetailer:Object.fromEntries(retailers.map((retailer) => {
      const rows = attempts.filter((item) => item.retailer === retailer);
      return [retailer, {
        urls:rows.length,
        fetchPct:ratio(rows.filter((item) => item.httpStatus !== undefined && item.httpStatus >= 200 && item.httpStatus < 400).length, rows.length),
        pricePct:ratio(rows.filter((item) => item.price !== undefined).length, rows.length),
        stockPct:ratio(rows.filter((item) => item.stockStatus && item.stockStatus !== 'UNKNOWN').length, rows.length),
        blockedPct:ratio(rows.filter((item) => item.challenge).length, rows.length),
      }];
    })),
  };
}

function markdown(runAt: string, summary: ReturnType<typeof summarize>, attempts: AttemptResult[]) {
  const lines = [
    '# PriceIntel Retailer Reliability',
    '',
    `Run: ${runAt}`,
    '',
    `- URLs tested: **${summary.urlsTested}**`,
    `- HTTP fetch success: **${summary.httpFetchSuccessPct}%**`,
    `- Validated price extraction: **${summary.validatedExtractionPct}%**`,
    `- Stock extraction (known): **${summary.stockExtractionPct}%**`,
    `- Browser fallback recommended: **${summary.browserFallbackRecommendedPct}%**`,
    `- Blocked/challenge: **${summary.blockedOrChallengePct}%**`,
    `- Parse/disagreement failure: **${summary.parseFailurePct}%**`,
    `- Median crawl: **${summary.medianCrawlMs ?? 'n/a'} ms**`,
    `- P95 crawl: **${summary.p95CrawlMs ?? 'n/a'} ms**`,
    `- Fresh manual truth samples: **${summary.manualTruthFreshSamples}**`,
    `- Correct against fresh manual truth: **${summary.manualTruthCorrectPct}%**`,
    '',
    '## Attempts',
    '',
    '| Retailer | URL | HTTP | Adapter | Price | Stock | Confidence | Challenge | Error | Manual truth |',
    '|---|---|---:|---|---:|---|---:|---|---|---|',
  ];
  for (const item of attempts) {
    const truth = item.manualTruth
      ? (item.manualTruth.fresh ? (item.manualTruth.correct ? 'correct' : 'mismatch') : 'stale')
      : '—';
    lines.push(`| ${item.retailer} | ${item.url} | ${item.httpStatus ?? '—'} | ${item.adapter ?? '—'} | ${item.price ?? '—'} ${item.currency ?? ''} | ${item.stockStatus ?? '—'} | ${item.confidence ?? '—'} | ${item.challenge ? 'yes' : 'no'} | ${item.errorCode ?? '—'} | ${truth} |`);
  }
  lines.push('', '> Live canaries measure behavior; they are intentionally not a deterministic release gate. A successful extraction is not proof of correctness unless compared with fresh manually reviewed truth.', '');
  return lines.join('\n');
}

const corpusPath = arg('--corpus', 'tests/live-canary/corpus.json');
const truthPath = arg('--truth', 'tests/live-canary/manual-truth.json');
const outputDir = arg('--output', 'artifacts/reliability');
const maxTruthAgeHours = Number(arg('--truth-max-age-hours', '24'));
const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as CorpusEntry[];
let truth: TruthFile = {};
try { truth = JSON.parse(await readFile(truthPath, 'utf8')) as TruthFile; } catch { truth = {}; }
const attempts: AttemptResult[] = [];
for (const entry of corpus) attempts.push(await runOne(entry, truth, maxTruthAgeHours));
const runAt = new Date().toISOString();
const summary = summarize(attempts);
const report = { runAt, corpusPath, truthPath, maxTruthAgeHours, summary, attempts };
await mkdir(outputDir, { recursive:true });
await writeFile(`${outputDir}/latest.json`, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(`${outputDir}/latest.md`, markdown(runAt, summary, attempts));
console.log(markdown(runAt, summary, attempts));
