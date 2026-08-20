import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { browserContextSecurityOptions, enforceBrowserHttpRoute } from '../packages/crawler-core/src/browser-network-policy.ts';

interface AuditEntry {
  id: string;
  url: string;
  countryCode?: string;
  probeVariants?: boolean;
  maxVariantProbes?: number;
}

interface VariantProbe {
  kind: 'select' | 'radio';
  name: string;
  value: string;
  label: string;
  priceLines: string[];
  durationMs: number;
  error?: string;
}

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function positiveIntArg(name: string, fallback: number) {
  const value = Number(arg(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
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
    await page.waitForTimeout(800);
  }
  return submitted;
}

function probeActionTimeout(maxProbeMs: number) {
  return Math.max(200, Math.floor((maxProbeMs - 100) / 2));
}

async function captureProbeText(page: Page, maxProbeMs: number) {
  await page.waitForTimeout(Math.min(100, Math.max(25, Math.floor(maxProbeMs / 8))));
  return page.locator('body').innerText({ timeout:probeActionTimeout(maxProbeMs) }).catch(() => '');
}

async function boundedVariantProbes(
  page: Page,
  entry: AuditEntry,
  budget: { remainingGlobal: number; auditDeadlineMs: number; maxProbeMs: number },
) {
  if (!entry.probeVariants || budget.remainingGlobal <= 0) return { probes:[] as VariantProbe[], used:0 };
  const perEntry = Math.min(entry.maxVariantProbes ?? 4, budget.remainingGlobal);
  const probes: VariantProbe[] = [];
  const actionTimeout = probeActionTimeout(budget.maxProbeMs);

  const record = async (
    kind: 'select' | 'radio',
    name: string,
    value: string,
    label: string,
    mutate: () => Promise<unknown>,
  ) => {
    if (probes.length >= perEntry || Date.now() >= budget.auditDeadlineMs) return false;
    const started = Date.now();
    let error: string | undefined;
    let text = '';
    try {
      await mutate();
      text = await captureProbeText(page, budget.maxProbeMs);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    probes.push({
      kind,
      name,
      value,
      label,
      priceLines:priceLines(text).slice(0, 10),
      durationMs:Date.now() - started,
      error,
    });
    return true;
  };

  // Interact with the storefront-visible option controls, not Shopify's hidden
  // no-JS select[name="id"]. The theme should update the hidden variant identity
  // as a consequence of the same control a shopper uses.
  const visibleSelects = page.locator('select:visible');
  const selectCount = Math.min(await visibleSelects.count(), 8);
  for (let selectIndex = 0; selectIndex < selectCount && probes.length < perEntry; selectIndex += 1) {
    const select = visibleSelects.nth(selectIndex);
    const name = (await select.getAttribute('name').catch(() => null)) ?? `select-${selectIndex}`;
    if (/^(?:id|country_code|currency|contact\[Category\])$/i.test(name)) continue;
    const initialValue = await select.inputValue({ timeout:actionTimeout }).catch(() => '');
    const options = await select.locator('option').evaluateAll((items) => items.slice(0, 30).map((option) => ({
      value:(option as HTMLOptionElement).value,
      label:option.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      disabled:(option as HTMLOptionElement).disabled,
    })));
    if (options.filter((option) => option.value && !option.disabled).length <= 1) continue;
    for (const option of options) {
      if (probes.length >= perEntry || Date.now() >= budget.auditDeadlineMs) break;
      if (!option.value || option.disabled) continue;
      await record('select', name, option.value, option.label, () => select.selectOption(option.value, { timeout:actionTimeout }));
    }
    if (initialValue && Date.now() < budget.auditDeadlineMs) {
      await select.selectOption(initialValue, { timeout:actionTimeout }).catch(() => null);
    }
  }

  if (probes.length < perEntry && Date.now() < budget.auditDeadlineMs) {
    const radioGroups = await page.locator('input[type="radio"]').evaluateAll((radios) => {
      const groups = new Map<string, Array<{value:string;label:string;disabled:boolean}>>();
      for (const radio of radios.slice(0, 40)) {
        const input = radio as HTMLInputElement;
        const name = input.name || 'radio';
        const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '' : '';
        const group = groups.get(name) ?? [];
        group.push({ value:input.value, label, disabled:input.disabled });
        groups.set(name, group);
      }
      return [...groups.entries()].map(([name, options]) => ({ name, options }));
    });

    for (const group of radioGroups) {
      for (const option of group.options) {
        if (probes.length >= perEntry || Date.now() >= budget.auditDeadlineMs) break;
        if (!option.value || option.disabled) continue;
        const radio = page.locator(`input[type="radio"][name=${JSON.stringify(group.name)}][value=${JSON.stringify(option.value)}]`).first();
        await record('radio', group.name, option.value, option.label, () => radio.check({ force:true, timeout:actionTimeout }));
      }
      if (probes.length >= perEntry || Date.now() >= budget.auditDeadlineMs) break;
    }
  }

  return { probes, used:probes.length };
}

const corpusPath = arg('--corpus', 'tests/live-canary/shopify-truth-audit.json');
const outputDir = arg('--output', 'artifacts/reliability/shopify-truth-audit');
const maxTotalVariantProbes = positiveIntArg('--max-total-variant-probes', 16);
const maxAuditMs = positiveIntArg('--max-audit-ms', 12 * 60_000);
const maxProbeMs = positiveIntArg('--max-probe-ms', 1_500);
const pageNavigationMaxMs = positiveIntArg('--max-page-navigation-ms', 25_000);
const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as AuditEntry[];
await mkdir(outputDir, { recursive:true });
await mkdir(`${outputDir}/screenshots`, { recursive:true });

const browser = await chromium.launch({ headless:true });
const attempts: unknown[] = [];
const auditStartedMs = Date.now();
const auditDeadlineMs = auditStartedMs + maxAuditMs;
let totalVariantProbes = 0;

for (const entry of corpus) {
  if (Date.now() >= auditDeadlineMs) {
    attempts.push({
      id:entry.id,
      requestedUrl:entry.url,
      requestedCountryCode:entry.countryCode,
      probeVariants:Boolean(entry.probeVariants),
      error:'AUDIT_GLOBAL_BUDGET_EXCEEDED',
      durationMs:0,
    });
    continue;
  }

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
    const remainingAuditMs = Math.max(1, auditDeadlineMs - Date.now());
    const response = await page.goto(entry.url, {
      waitUntil:'domcontentloaded',
      timeout:Math.min(pageNavigationMaxMs, remainingAuditMs),
    });
    await page.waitForTimeout(900);
    const countryApplied = entry.countryCode ? await applyShopifyCountry(page, entry.countryCode) : false;
    const bodyText = await page.locator('body').innerText({ timeout:4_000 });
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
      disabled:(radio as HTMLInputElement).disabled,
      ariaLabel:radio.getAttribute('aria-label') ?? '',
      label:radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '' : '',
    })));
    const screenshot = `${outputDir}/screenshots/${entry.id}.png`;
    await page.screenshot({ path:screenshot, fullPage:false });

    const remainingGlobal = Math.max(0, maxTotalVariantProbes - totalVariantProbes);
    const variantResult = await boundedVariantProbes(page, entry, {
      remainingGlobal,
      auditDeadlineMs,
      maxProbeMs,
    });
    totalVariantProbes += variantResult.used;

    attempts.push({
      id:entry.id,
      requestedUrl:entry.url,
      requestedCountryCode:entry.countryCode,
      countryApplied,
      probeVariants:Boolean(entry.probeVariants),
      maxVariantProbes:entry.maxVariantProbes,
      finalUrl:page.url(),
      status:response?.status(),
      title:await page.title(),
      h1:h1.replace(/\s+/g, ' ').trim(),
      priceLines:priceLines(bodyText),
      selectOptions,
      radioControls,
      variantProbes:variantResult.probes,
      screenshot:`screenshots/${entry.id}.png`,
      durationMs:Date.now() - started,
    });
  } catch (error) {
    attempts.push({
      id:entry.id,
      requestedUrl:entry.url,
      requestedCountryCode:entry.countryCode,
      probeVariants:Boolean(entry.probeVariants),
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

const report = {
  runAt:new Date().toISOString(),
  corpusPath,
  urlsRequested:corpus.length,
  totalVariantProbes,
  budgets:{ maxTotalVariantProbes, maxAuditMs, maxProbeMs, pageNavigationMaxMs },
  durationMs:Date.now() - auditStartedMs,
  attempts,
};
await writeFile(`${outputDir}/audit.json`, `${JSON.stringify(report, null, 2)}\n`);
const markdown = [
  '# Shopify Browser Truth Audit',
  '',
  `Run: ${report.runAt}`,
  `URLs: ${corpus.length}`,
  `Variant probes used: ${totalVariantProbes}/${maxTotalVariantProbes}`,
  `Audit duration: ${report.durationMs} ms / ${maxAuditMs} ms budget`,
  '',
];
for (const attempt of attempts as Array<Record<string, unknown>>) {
  markdown.push(
    `## ${attempt.id}`,
    '',
    `- HTTP: ${attempt.status ?? '—'}`,
    `- Requested country: ${attempt.requestedCountryCode ?? 'site/browser default'}`,
    `- Country localization applied: ${attempt.countryApplied ?? false}`,
    `- Variant probing enabled: ${attempt.probeVariants ?? false}`,
    `- Final URL: ${attempt.finalUrl ?? '—'}`,
    `- H1: ${attempt.h1 ?? '—'}`,
    `- Price lines: ${JSON.stringify(attempt.priceLines ?? [])}`,
    `- Select controls: ${JSON.stringify(attempt.selectOptions ?? [])}`,
    `- Radio controls: ${JSON.stringify(attempt.radioControls ?? [])}`,
    `- Variant probes: ${JSON.stringify(attempt.variantProbes ?? [])}`,
    `- Screenshot: ${attempt.screenshot ?? '—'}`,
    `- Error: ${attempt.error ?? '—'}`,
    '',
  );
}
markdown.push(
  '> This browser run is an independent test oracle over fixed known URLs. Screenshots, visible page state, and verifier review establish truth; extracted priceLines/control/variant-probe metadata are supporting evidence only. Requested storefront country is applied only through the site\'s own Shopify localization form. Variant probing is opt-in and constrained by per-entry, global-probe, per-probe, and whole-audit budgets. It never feeds production observations and is not a production browser-fallback path.',
  '',
);
await writeFile(`${outputDir}/audit.md`, markdown.join('\n'));
console.log(markdown.join('\n'));
