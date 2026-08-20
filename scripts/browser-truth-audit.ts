import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { browserContextSecurityOptions, enforceBrowserHttpRoute } from '../packages/crawler-core/src/browser-network-policy.ts';

interface AuditEntry { id:string; url:string }

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function priceLines(text: string) {
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || line.length > 220) continue;
    if (!/(?:[$£€]\s?\d)|(?:\b(?:USD|CAD|GBP|EUR)\b.*\d)|(?:\d.*\b(?:USD|CAD|GBP|EUR)\b)/i.test(line)) continue;
    seen.add(line);
    if (seen.size >= 20) break;
  }
  return [...seen];
}

const corpusPath = arg('--corpus', 'tests/live-canary/shopify-truth-audit.json');
const outputDir = arg('--output', 'artifacts/reliability/shopify-truth-audit');
const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as AuditEntry[];
await mkdir(outputDir, { recursive:true });
await mkdir(`${outputDir}/screenshots`, { recursive:true });

const browser = await chromium.launch({ headless:true });
const context = await browser.newContext({
  ...browserContextSecurityOptions,
  locale:'en-US',
  timezoneId:'America/New_York',
  viewport:{ width:1280, height:900 },
});
await context.route('**/*', async (route) => {
  const request = route.request();
  if (['image','media','font'].includes(request.resourceType())) {
    await route.abort('blockedbyclient');
    return;
  }
  const url = request.url();
  if (!/^https?:/i.test(url)) {
    await route.continue();
    return;
  }
  await enforceBrowserHttpRoute(route);
});

const attempts: unknown[] = [];
for (const entry of corpus) {
  const page = await context.newPage();
  const started = Date.now();
  try {
    const response = await page.goto(entry.url, { waitUntil:'domcontentloaded', timeout:30_000 });
    await page.waitForTimeout(1_200);
    const bodyText = await page.locator('body').innerText({ timeout:5_000 });
    const h1 = await page.locator('h1').first().innerText({ timeout:2_000 }).catch(() => '');
    const screenshot = `${outputDir}/screenshots/${entry.id}.png`;
    await page.screenshot({ path:screenshot, fullPage:false });
    attempts.push({
      id:entry.id,
      requestedUrl:entry.url,
      finalUrl:page.url(),
      status:response?.status(),
      title:await page.title(),
      h1:h1.replace(/\s+/g, ' ').trim(),
      priceLines:priceLines(bodyText),
      screenshot:`screenshots/${entry.id}.png`,
      durationMs:Date.now() - started,
    });
  } catch (error) {
    attempts.push({
      id:entry.id,
      requestedUrl:entry.url,
      finalUrl:page.url(),
      error:error instanceof Error ? error.message : String(error),
      durationMs:Date.now() - started,
    });
  } finally {
    await page.close();
  }
}
await context.close();
await browser.close();

const report = { runAt:new Date().toISOString(), corpusPath, attempts };
await writeFile(`${outputDir}/audit.json`, `${JSON.stringify(report, null, 2)}\n`);
const markdown = ['# Shopify Browser Truth Audit', '', `Run: ${report.runAt}`, ''];
for (const attempt of attempts as Array<Record<string, unknown>>) {
  markdown.push(`## ${attempt.id}`, '', `- HTTP: ${attempt.status ?? '—'}`, `- Final URL: ${attempt.finalUrl ?? '—'}`, `- H1: ${attempt.h1 ?? '—'}`, `- Price lines: ${JSON.stringify(attempt.priceLines ?? [])}`, `- Error: ${attempt.error ?? '—'}`, '');
}
markdown.push('> This browser run is an independent test oracle over fixed known URLs. It does not feed production observations and is not a production browser-fallback path.', '');
await writeFile(`${outputDir}/audit.md`, markdown.join('\n'));
console.log(markdown.join('\n'));
