import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { browserContextSecurityOptions, enforceBrowserHttpRoute } from '../packages/crawler-core/src/browser-network-policy.ts';

interface AuditEntry { id:string; url:string; countryCode?:string }

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
    if (seen.size >= 30) break;
  }
  return [...seen];
}

async function applyShopifyCountry(page: Page, countryCode: string) {
  const navigation = page.waitForNavigation({ waitUntil:'domcontentloaded', timeout:8_000 }).catch(() => null);
  const submitted = await page.evaluate((requestedCountry) => {
    const forms = [...document.querySelectorAll('form')].filter((form) => {
      try { return new URL(form.action || location.href, location.href).pathname.endsWith('/localization'); }
      catch { return false; }
    });
    for (const form of forms) {
      const control = form.querySelector<HTMLElement>('[name="country_code"]');
      if (!control) continue;
      if (control instanceof HTMLSelectElement) {
        const option = [...control.options].find((item) => item.value.toUpperCase() === requestedCountry.toUpperCase());
        if (!option) continue;
        control.value = option.value;
        control.dispatchEvent(new Event('change', { bubbles:true }));
      } else if (control instanceof HTMLInputElement) {
        control.value = requestedCountry;
      } else {
        continue;
      }
      form.requestSubmit();
      return true;
    }
    return false;
  }, countryCode);
  if (submitted) {
    await navigation;
    await page.waitForTimeout(1_000);
  }
  return submitted;
}

const corpusPath = arg('--corpus', 'tests/live-canary/shopify-truth-audit.json');
const outputDir = arg('--output', 'artifacts/reliability/shopify-truth-audit');
const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as AuditEntry[];
await mkdir(outputDir, { recursive:true });
await mkdir(`${outputDir}/screenshots`, { recursive:true });

const browser = await chromium.launch({ headless:true });
const attempts: unknown[] = [];
for (const entry of corpus) {
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

  const page = await context.newPage();
  const started = Date.now();
  try {
    const response = await page.goto(entry.url, { waitUntil:'domcontentloaded', timeout:30_000 });
    await page.waitForTimeout(1_500);
    const countryApplied = entry.countryCode ? await applyShopifyCountry(page, entry.countryCode) : false;
    const bodyText = await page.locator('body').innerText({ timeout:5_000 });
    const h1 = await page.locator('h1').first().innerText({ timeout:2_000 }).catch(() => '');
    const selectOptions = await page.locator('select').evaluateAll((selects) => selects.slice(0, 12).map((select) => ({
      name:select.getAttribute('name') ?? select.getAttribute('aria-label') ?? '',
      value:(select as HTMLSelectElement).value,
      options:[...(select as HTMLSelectElement).options].slice(0, 30).map((option) => ({
        text:option.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        value:option.value,
        selected:option.selected,
        disabled:option.disabled,
      })),
    })));
    const radioControls = await page.locator('input[type="radio"]').evaluateAll((radios) => radios.slice(0, 40).map((radio) => ({
      name:radio.getAttribute('name') ?? '',
      value:(radio as HTMLInputElement).value,
      checked:(radio as HTMLInputElement).checked,
      ariaLabel:radio.getAttribute('aria-label') ?? '',
      label:radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '' : '',
    })));
    const screenshot = `${outputDir}/screenshots/${entry.id}.png`;
    await page.screenshot({ path:screenshot, fullPage:false });
    attempts.push({
      id:entry.id,
      requestedUrl:entry.url,
      requestedCountryCode:entry.countryCode,
      countryApplied,
      finalUrl:page.url(),
      status:response?.status(),
      title:await page.title(),
      h1:h1.replace(/\s+/g, ' ').trim(),
      priceLines:priceLines(bodyText),
      selectOptions,
      radioControls,
      screenshot:`screenshots/${entry.id}.png`,
      durationMs:Date.now() - started,
    });
  } catch (error) {
    attempts.push({
      id:entry.id,
      requestedUrl:entry.url,
      requestedCountryCode:entry.countryCode,
      finalUrl:page.url(),
      error:error instanceof Error ? error.message : String(error),
      durationMs:Date.now() - started,
    });
  } finally {
    await page.close();
    await context.close();
  }
}
await browser.close();

const report = { runAt:new Date().toISOString(), corpusPath, urlsRequested:corpus.length, attempts };
await writeFile(`${outputDir}/audit.json`, `${JSON.stringify(report, null, 2)}\n`);
const markdown = ['# Shopify Browser Truth Audit', '', `Run: ${report.runAt}`, `URLs: ${corpus.length}`, ''];
for (const attempt of attempts as Array<Record<string, unknown>>) {
  markdown.push(
    `## ${attempt.id}`,
    '',
    `- HTTP: ${attempt.status ?? '—'}`,
    `- Requested country: ${attempt.requestedCountryCode ?? 'site/browser default'}`,
    `- Country localization applied: ${attempt.countryApplied ?? false}`,
    `- Final URL: ${attempt.finalUrl ?? '—'}`,
    `- H1: ${attempt.h1 ?? '—'}`,
    `- Price lines: ${JSON.stringify(attempt.priceLines ?? [])}`,
    `- Select controls: ${JSON.stringify(attempt.selectOptions ?? [])}`,
    `- Radio controls: ${JSON.stringify(attempt.radioControls ?? [])}`,
    `- Screenshot: ${attempt.screenshot ?? '—'}`,
    `- Error: ${attempt.error ?? '—'}`,
    '',
  );
}
markdown.push('> This browser run is an independent test oracle over fixed known URLs. Screenshots, visible page state, and verifier review establish truth; extracted priceLines/control metadata are supporting evidence only. Requested storefront country is applied only through the site\'s own Shopify localization form. It does not feed production observations and is not a production browser-fallback path.', '');
await writeFile(`${outputDir}/audit.md`, markdown.join('\n'));
console.log(markdown.join('\n'));
