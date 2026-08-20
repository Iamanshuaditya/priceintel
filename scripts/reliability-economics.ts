import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { computeReliabilityEconomics } from '../packages/crawler-core/src/economics.ts';

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function optionalRate(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

const inputPath = arg('--input', 'artifacts/reliability/latest.json');
const outputDir = arg('--output', dirname(inputPath));
const report = JSON.parse(await readFile(inputPath, 'utf8')) as {
  attempts: Array<{
    bytesDownloaded: number;
    supplementaryBytes: number;
    supplementaryRequestCount: number;
    totalDurationMs: number;
  }>;
};
const economics = computeReliabilityEconomics(report.attempts, {
  requestCostUsd:optionalRate(process.env.PRICEINTEL_HTTP_REQUEST_COST_USD),
  egressGbCostUsd:optionalRate(process.env.PRICEINTEL_EGRESS_GB_COST_USD),
});
const cost = economics.costModelConfigured
  ? `$${economics.estimatedCostUsd} total / $${economics.estimatedCostPerUrlUsd} per URL`
  : 'N/A (set PRICEINTEL_HTTP_REQUEST_COST_USD and PRICEINTEL_EGRESS_GB_COST_USD)';
const markdown = [
  '# PriceIntel Reliability Economics',
  '',
  `- URLs: **${economics.urls}**`,
  `- HTTP requests: **${economics.totalHttpRequests}**`,
  `- Primary bytes: **${economics.totalPrimaryBytes}**`,
  `- Supplementary bytes: **${economics.totalSupplementaryBytes}**`,
  `- Total downloaded: **${economics.totalDownloadedMiB} MiB**`,
  `- Mean bytes / URL: **${economics.meanBytesPerUrl}**`,
  `- Mean requests / URL: **${economics.meanHttpRequestsPerUrl}**`,
  `- Mean crawl time / URL: **${economics.meanCrawlMsPerUrl} ms**`,
  `- Configured network-cost estimate: **${cost}**`,
  '',
  '> Dollar estimates are emitted only when explicit deployment-specific request and egress rates are supplied. Proxy, browser, CPU, storage, and provider costs are not inferred.',
  '',
].join('\n');
await mkdir(outputDir, { recursive:true });
await writeFile(`${outputDir}/economics.json`, `${JSON.stringify(economics, null, 2)}\n`);
await writeFile(`${outputDir}/economics.md`, markdown);
console.log(markdown);
