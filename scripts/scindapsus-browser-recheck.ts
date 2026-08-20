import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { browserContextSecurityOptions, enforceBrowserHttpRoute } from '../packages/crawler-core/src/browser-network-policy.ts';

const outputDir = 'artifacts/reliability/scindapsus-browser-recheck';
await mkdir(outputDir, { recursive:true });
const browser = await chromium.launch({ headless:true });
const context = await browser.newContext({
  ...browserContextSecurityOptions,
  locale:'en-CA',
  timezoneId:'America/Toronto',
  viewport:{ width:1280, height:900 },
});
await context.route('**/*', async (route) => {
  const request = route.request();
  if (['image','media','font'].includes(request.resourceType())) return route.abort('blockedbyclient');
  if (!/^https?:/i.test(request.url())) return route.continue();
  await enforceBrowserHttpRoute(route);
});

const page = await context.newPage();
const requestedUrl = 'https://missboon.ca/en/products/scindapsus-mount-salak-4';
const response = await page.goto(requestedUrl, { waitUntil:'domcontentloaded', timeout:25_000 });
await page.waitForTimeout(900);

// Align to Canada via the storefront's own Shopify localization form.
await page.evaluate(() => {
  const forms = [...document.querySelectorAll('form')].filter((form) => {
    try { return new URL(form.action || location.href, location.href).pathname.endsWith('/localization'); }
    catch { return false; }
  });
  for (const form of forms) {
    const control = form.querySelector<HTMLElement>('[name="country_code"]');
    if (!control) continue;
    if (control instanceof HTMLSelectElement) {
      const option = [...control.options].find((item) => item.value.toUpperCase() === 'CA');
      if (!option) continue;
      control.value = option.value;
    } else if (control instanceof HTMLInputElement) {
      control.value = 'CA';
    } else continue;
    form.requestSubmit();
    return;
  }
});
await page.waitForTimeout(1_000);

const visibleText = async () => page.locator('body').innerText({ timeout:4_000 }).catch(() => '');
const priceLines = (text: string) => text.split(/\r?\n/)
  .map((line) => line.replace(/\s+/g, ' ').trim())
  .filter((line) => /\$\s?\d|\bCAD\b/i.test(line))
  .filter((line, index, all) => line && all.indexOf(line) === index)
  .slice(0, 20);

const beforeText = await visibleText();
const six = page.locator('input[type="radio"][name="Taille"][value="6\\\""]').first();
const sixId = await six.getAttribute('id');
const label = sixId ? page.locator(`label[for="${sixId}"]`).first() : null;
const beforeChecked = await six.isChecked().catch(() => false);
const beforeDisabled = await six.isDisabled().catch(() => false);
const labelText = label ? await label.innerText().catch(() => '') : '';

let clickError: string | undefined;
try {
  if (!label) throw new Error('6-inch label not found');
  await label.click({ force:true, timeout:2_000 });
  await page.waitForTimeout(500);
} catch (error) {
  clickError = error instanceof Error ? error.message : String(error);
}

const afterChecked = await six.isChecked().catch(() => false);
const afterText = await visibleText();
await page.screenshot({ path:`${outputDir}/scindapsus-after-6-inch-click.png`, fullPage:false });
const result = {
  runAt:new Date().toISOString(),
  requestedUrl,
  finalUrl:page.url(),
  httpStatus:response?.status(),
  sixInch:{
    id:sixId,
    labelText,
    beforeChecked,
    beforeDisabled,
    afterChecked,
    clickError,
  },
  beforePriceLines:priceLines(beforeText),
  afterPriceLines:priceLines(afterText),
  screenshot:'scindapsus-after-6-inch-click.png',
};
await writeFile(`${outputDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await context.close();
await browser.close();
