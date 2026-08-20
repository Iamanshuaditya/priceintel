import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { extractWithAdapterSupplements, extractWithAdapters, selectAdapterCandidate } from '../packages/crawler-core/src/adapters/registry.ts';
import type { FetchArtifact, SupplementaryRequest } from '../packages/crawler-core/src/adapters/types.ts';
import { chooseFallbackDecision, evaluateTruth, truthSummary, type FallbackDecision, type TruthState } from '../packages/crawler-core/src/reliability.ts';
import { secureFetch } from '../packages/crawler-core/src/url-policy.ts';

interface CorpusEntry {
  id: string;
  retailer: string;
  url: string;
  expectedAdapter?: string;
  preferredFallback?: FallbackDecision;
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
  primaryCandidateCount: number;
  supplementaryRequestCount: number;
  supplementaryBytes: number;
  selectedFromSupplementary: boolean;
  fallbackDecision: FallbackDecision;
  retryCount: number;
  fetchDurationMs: number;
  extractionDurationMs: number;
  totalDurationMs: number;
  errorCode?: string;
  adapterAttempts?: unknown[];
  supplementaryAttempts?: unknown[];
  manualTruth?: ManualTruth & { state:TruthState;ageHours?:number;fresh:boolean;extracted:boolean;correct?:boolean };
}

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function errorCode(error: unknown) {
  return (error as {code?:string}).code ?? (error instanceof Error ? error.name : 'UNKNOWN_ERROR');
}

function isChallenge(status: number | undefined, html: string, finalUrl?: string) {
  if (status && [401, 403, 407, 429].includes(status)) return true;
  if (finalUrl && /\/blocked(?:[/?#]|$)/i.test(new URL(finalUrl).pathname)) return true;
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

async function fetchArtifact(url: string, options: {timeoutMs?:number;maxResponseBytes?:number} = {}): Promise<FetchArtifact> {
  const fetched = await secureFetch(url, {
    timeoutMs:options.timeoutMs ?? 20_000,
    maxResponseBytes:options.maxResponseBytes ?? 10 * 1024 * 1024,
  });
  const body = await fetched.response.text();
  return {
    requestedUrl:url,
    finalUrl:fetched.finalUrl,
    html:body,
    fetchedAt:new Date(),
    status:fetched.response.status,
    contentType:fetched.response.headers.get('content-type') ?? undefined,
    bytesDownloaded:Buffer.byteLength(body),
  };
}

async function runOne(entry: CorpusEntry, truth: TruthFile, maxTruthAgeHours: number): Promise<AttemptResult> {
  const totalStart = performance.now();
  let html = '';
  let finalUrl: string | undefined;
  let fetchDurationMs = 0;
  try {
    const fetchStart = performance.now();
    const artifact = await fetchArtifact(entry.url);
    fetchDurationMs = Math.round(performance.now() - fetchStart);
    html = artifact.html;
    finalUrl = artifact.finalUrl;
    const challenge = isChallenge(artifact.status, artifact.html, artifact.finalUrl);

    const extractionStart = performance.now();
    const primary = extractWithAdapters(artifact);
    let extraction = primary;
    let selected;
    let selectionError: unknown;
    try { selected = selectAdapterCandidate(primary.candidates); }
    catch (error) { selectionError = error; }

    if (!selected && !challenge) {
      extraction = await extractWithAdapterSupplements(artifact, async (request: SupplementaryRequest) => {
        const supplemental = await fetchArtifact(request.url, {
          timeoutMs:request.timeoutMs,
          maxResponseBytes:request.maxBytes,
        });
        if (!supplemental.status || supplemental.status < 200 || supplemental.status >= 300) {
          throw Object.assign(new Error(`HTTP ${supplemental.status ?? 0}`), { code:`HTTP_${supplemental.status ?? 0}` });
        }
        return supplemental;
      });
      try {
        selected = selectAdapterCandidate(extraction.candidates);
        selectionError = undefined;
      } catch (error) { selectionError = error; }
    }

    const extractionDurationMs = Math.round(performance.now() - extractionStart);
    const supplementaryAttempts = extraction.supplementaryAttempts ?? [];
    const supplementaryRequestCount = supplementaryAttempts.filter((item) => item.requestId !== 'extract-supplementary').length;
    const supplementaryBytes = supplementaryAttempts.reduce((sum, item) => sum + item.bytesDownloaded, 0);
    const selectedFromSupplementary = Boolean(selected?.provenance.sourcePath.startsWith('supplementary:'));
    const fallbackDecision = chooseFallbackDecision({
      extracted:Boolean(selected),
      challenge,
      preferred:supplementaryRequestCount > 0 ? 'MANUAL_REVIEW' : entry.preferredFallback,
    });

    const manual = truth[entry.id];
    const evaluation = evaluateTruth(manual, {price:selected?.price,currency:selected?.currency}, Date.now(), maxTruthAgeHours);
    const manualTruth = manual ? { ...manual, ...evaluation } : undefined;

    return {
      id:entry.id,
      retailer:entry.retailer,
      url:entry.url,
      finalUrl:artifact.finalUrl,
      fetchMethod:'HTTP_PINNED',
      httpStatus:artifact.status,
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
      primaryCandidateCount:primary.candidates.length,
      supplementaryRequestCount,
      supplementaryBytes,
      selectedFromSupplementary,
      fallbackDecision,
      retryCount:0,
      fetchDurationMs,
      extractionDurationMs,
      totalDurationMs:Math.round(performance.now() - totalStart),
      errorCode:selectionError ? errorCode(selectionError) : undefined,
      adapterAttempts:extraction.attempts,
      supplementaryAttempts,
      manualTruth,
    };
  } catch (error) {
    const manual = truth[entry.id];
    const evaluation = evaluateTruth(manual, {}, Date.now(), maxTruthAgeHours);
    return {
      id:entry.id,
      retailer:entry.retailer,
      url:entry.url,
      finalUrl,
      fetchMethod:'HTTP_PINNED',
      challenge:isChallenge(undefined, html, finalUrl),
      bytesDownloaded:html ? Buffer.byteLength(html) : 0,
      expectedAdapter:entry.expectedAdapter,
      expectedAdapterMatched:undefined,
      primaryCandidateCount:0,
      supplementaryRequestCount:0,
      supplementaryBytes:0,
      selectedFromSupplementary:false,
      fallbackDecision:chooseFallbackDecision({extracted:false, challenge:isChallenge(undefined, html, finalUrl), preferred:entry.preferredFallback}),
      retryCount:0,
      fetchDurationMs:fetchDurationMs || Math.round(performance.now() - totalStart),
      extractionDurationMs:0,
      totalDurationMs:Math.round(performance.now() - totalStart),
      errorCode:errorCode(error),
      manualTruth:manual ? { ...manual, ...evaluation } : undefined,
    };
  }
}

function summarize(attempts: AttemptResult[]) {
  const extracted = attempts.filter((item) => item.price !== undefined);
  const truth = truthSummary(attempts.filter((item) => item.manualTruth).map((item) => item.manualTruth!));
  const retailers = [...new Set(attempts.map((item) => item.retailer))].sort();
  const fallbackValues: FallbackDecision[] = ['NONE','SUPPLEMENTARY_HTTP','BROWSER_RENDER','APPROVED_API','APPROVED_DATA_PROVIDER','BLOCKED','MANUAL_REVIEW'];
  return {
    urlsTested:attempts.length,
    httpFetchSuccessPct:ratio(attempts.filter((item) => item.httpStatus !== undefined && item.httpStatus >= 200 && item.httpStatus < 400).length, attempts.length),
    primaryExtractionPct:ratio(attempts.filter((item) => item.price !== undefined && !item.selectedFromSupplementary).length, attempts.length),
    supplementaryExtractionPct:ratio(attempts.filter((item) => item.selectedFromSupplementary).length, attempts.length),
    validatedExtractionPct:ratio(extracted.length, attempts.length),
    priceExtractionPct:ratio(extracted.length, attempts.length),
    stockExtractionPct:ratio(attempts.filter((item) => item.stockStatus && item.stockStatus !== 'UNKNOWN').length, attempts.length),
    blockedOrChallengePct:ratio(attempts.filter((item) => item.challenge).length, attempts.length),
    parseFailurePct:ratio(attempts.filter((item) => item.errorCode === 'PARSE_FAILED' || item.errorCode === 'CANDIDATE_DISAGREEMENT').length, attempts.length),
    medianCrawlMs:percentile(attempts.map((item) => item.totalDurationMs), 50),
    p95CrawlMs:percentile(attempts.map((item) => item.totalDurationMs), 95),
    ...truth,
    fallbackDecisions:Object.fromEntries(fallbackValues.map((decision) => [decision, attempts.filter((item) => item.fallbackDecision === decision).length])),
    perRetailer:Object.fromEntries(retailers.map((retailer) => {
      const rows = attempts.filter((item) => item.retailer === retailer);
      return [retailer, {
        urls:rows.length,
        fetchPct:ratio(rows.filter((item) => item.httpStatus !== undefined && item.httpStatus >= 200 && item.httpStatus < 400).length, rows.length),
        pricePct:ratio(rows.filter((item) => item.price !== undefined).length, rows.length),
        supplementaryPricePct:ratio(rows.filter((item) => item.selectedFromSupplementary).length, rows.length),
        stockPct:ratio(rows.filter((item) => item.stockStatus && item.stockStatus !== 'UNKNOWN').length, rows.length),
        blockedPct:ratio(rows.filter((item) => item.challenge).length, rows.length),
      }];
    })),
  };
}

function markdown(runAt: string, summary: ReturnType<typeof summarize>, attempts: AttemptResult[]) {
  const correctness = summary.correctnessAmongExtractedTruthPct === null ? 'N/A' : `${summary.correctnessAmongExtractedTruthPct}%`;
  const lines = [
    '# PriceIntel Retailer Reliability',
    '',
    `Run: ${runAt}`,
    '',
    `- URLs tested: **${summary.urlsTested}**`,
    `- HTTP fetch success: **${summary.httpFetchSuccessPct}%**`,
    `- Primary extraction: **${summary.primaryExtractionPct}%**`,
    `- Supplementary extraction: **${summary.supplementaryExtractionPct}%**`,
    `- Validated price extraction: **${summary.validatedExtractionPct}%**`,
    `- Stock extraction (known): **${summary.stockExtractionPct}%**`,
    `- Blocked/challenge: **${summary.blockedOrChallengePct}%**`,
    `- Parse/disagreement failure: **${summary.parseFailurePct}%**`,
    `- Median crawl: **${summary.medianCrawlMs ?? 'n/a'} ms**`,
    `- P95 crawl: **${summary.p95CrawlMs ?? 'n/a'} ms**`,
    `- Fresh manual truth samples: **${summary.freshTruthSamples}**`,
    `- Truth extraction coverage: **${summary.truthExtractedSamples}/${summary.freshTruthSamples} (${summary.truthExtractionCoveragePct}%)**`,
    `- Correctness among extracted truth: **${correctness}**`,
    `- End-to-end correct coverage: **${summary.endToEndCorrectCoveragePct}%**`,
    '',
    `- Next actions: **${Object.entries(summary.fallbackDecisions).map(([key,value]) => `${key}=${value}`).join(', ')}**`,
    '',
    '## Attempts',
    '',
    '| Retailer | HTTP | Adapter | Price | Stock | Primary | Supplement | Next action | Challenge | Error | Truth |',
    '|---|---:|---|---:|---|---:|---:|---|---|---|---|',
  ];
  for (const item of attempts) {
    lines.push(`| ${item.retailer} | ${item.httpStatus ?? '—'} | ${item.adapter ?? '—'} | ${item.price ?? '—'} ${item.currency ?? ''} | ${item.stockStatus ?? '—'} | ${item.primaryCandidateCount} | ${item.supplementaryRequestCount} | ${item.fallbackDecision} | ${item.challenge ? 'yes' : 'no'} | ${item.errorCode ?? '—'} | ${item.manualTruth?.state ?? 'NO_TRUTH'} |`);
  }
  lines.push('', '> Live canaries measure behavior; they are intentionally not a deterministic release gate. Coverage and correctness use separate denominators: NOT_EXTRACTED is not counted as an incorrect extracted price.', '');
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
