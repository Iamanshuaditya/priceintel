import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createApiServer } from '../apps/api/src/server.ts';
import { migrateApplication, truncateApplication } from '../apps/api/src/storage.ts';
import { createFixtureServer } from '../apps/fixture-server/src/server.ts';
import { createDatabasePool } from '../packages/db/src/index.ts';
import {
  CRAWL_QUEUE_NAME,
  createCrawlQueue,
  createCrawlWorker,
} from '../packages/jobs/src/crawl-queue.ts';
import { buildCrawlProcessor } from '../packages/jobs/src/worker.ts';

test('operator browser vertical preserves the last verified value when a crawl fails', async ({ page }, testInfo) => {
  const pool = createDatabasePool();
  await migrateApplication(pool);
  await truncateApplication(pool);

  const fixture = createFixtureServer({ price:100, stock:true, malformed:false });
  const fixtureBase = await fixture.listen();
  const queueName = `${CRAWL_QUEUE_NAME}-browser-e2e-${Date.now()}`;
  const queue = createCrawlQueue(undefined, queueName);

  const fetchHtml = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code:`HTTP_${response.status}` });
    return { html:await response.text(), finalUrl:response.url };
  };
  const worker = createCrawlWorker(buildCrawlProcessor(pool, fetchHtml), undefined, { queueName });
  await worker.waitUntilReady();

  const api = createApiServer({ pool, queue, secureCookies:false });
  const base = await api.listen();
  const screenshotDir = join('artifacts', 'playwright');
  await mkdir(screenshotDir, { recursive:true });

  try {
    await page.goto(base);
    await expect(page.locator('#auth-view')).toBeVisible();

    await page.locator('#email').fill('browser-e2e@example.com');
    await page.locator('#password').fill('correct horse battery staple');
    await page.locator('#register-button').click();
    await expect(page.locator('#app-view')).toBeVisible();
    await expect(page.locator('#empty-workspace')).toBeVisible();

    const visibleCookies = await page.evaluate(() => document.cookie);
    const localStorageKeys = await page.evaluate(() => Object.keys(localStorage));
    expect(visibleCookies).not.toContain('priceintel_session');
    expect(localStorageKeys).not.toContain('token');

    await page.locator('#workspace-name').fill('E2E Acme Audio');
    await page.locator('#workspace-form button').click();
    await expect(page.locator('#workspace-content')).toBeVisible();

    await page.locator('#product-title').fill('Acme Headphones');
    await page.locator('#product-sku').fill('ACME-E2E-1');
    await page.locator('#product-price').fill('109');
    await page.locator('#product-form button').click();
    await expect(page.locator('#products-body')).toContainText('Acme Headphones');
    await expect(page.locator('#listing-form')).toBeVisible();

    await page.locator('#listing-retailer').fill('Fixture Store');
    await page.locator('#listing-url').fill(`${fixtureBase}/product/jsonld`);
    await page.locator('#listing-form button').click();
    const listingRow = page.locator('#listings-body tr').filter({ hasText:'Fixture Store' });
    await expect(listingRow).toBeVisible();
    await listingRow.click();
    await expect(page.locator('#listing-detail')).toBeVisible();
    await expect(page.locator('#detail-health')).toHaveText('STALE');

    await page.locator('#check-now-button').click();
    await expect(page.locator('#detail-health')).toHaveText('HEALTHY');
    await expect(page.locator('#detail-price')).toHaveText('$100.00');
    await expect(page.locator('#detail-stock')).toHaveText('IN_STOCK');
    await expect(page.locator('#detail-source')).toHaveText('JSON_LD');
    await expect(page.locator('#detail-confidence')).toHaveText('95%');
    await expect(page.locator('#history-list .history-row')).toHaveCount(1);

    const healthyPath = join(screenshotDir, '01-healthy-100.png');
    await page.screenshot({ path:healthyPath, fullPage:true });
    await testInfo.attach('healthy-$100', { path:healthyPath, contentType:'image/png' });

    fixture.setState({ price:90 });
    await page.locator('#check-now-button').click();
    await expect(page.locator('#detail-health')).toHaveText('HEALTHY');
    await expect(page.locator('#detail-price')).toHaveText('$90.00');
    await expect(page.locator('#history-list .history-row')).toHaveCount(2);
    await expect(page.locator('#history-list')).toContainText('$100.00');
    await expect(page.locator('#history-list')).toContainText('$90.00');
    await expect(page.locator('#changes-list')).toContainText('PRICE_CHANGED');
    await expect(page.locator('#changes-list')).toContainText('100 → 90');

    const secondSuccessfulLabel = await page.locator('#detail-success').textContent();
    expect(secondSuccessfulLabel).toBeTruthy();

    const priceChangePath = join(screenshotDir, '02-price-change-90.png');
    await page.screenshot({ path:priceChangePath, fullPage:true });
    await testInfo.attach('price-change-$90', { path:priceChangePath, contentType:'image/png' });

    fixture.setState({ malformed:true });
    await page.locator('#check-now-button').click();
    await expect(page.locator('#detail-health')).toHaveText('PARSE_FAILED');
    await expect(page.locator('#detail-price')).toHaveText('$90.00');
    await expect(page.locator('#detail-success')).toHaveText(secondSuccessfulLabel!);
    await expect(page.locator('#honesty-message')).toBeVisible();
    await expect(page.locator('#honesty-message')).toContainText('last successfully verified value');
    await expect(page.locator('#honesty-message')).toContainText('NOT been treated as fresh');
    await expect(page.locator('#history-list .history-row')).toHaveCount(2);
    await expect(page.locator('#changes-list').getByText('PRICE_CHANGED')).toHaveCount(1);
    await expect(page.locator('#crawl-status')).toContainText('FAILED');
    await expect(page.locator('#crawl-status')).toContainText('PARSE_FAILED');

    const failedPath = join(screenshotDir, '03-parse-failed-preserves-90.png');
    await page.screenshot({ path:failedPath, fullPage:true });
    await testInfo.attach('parse-failed-preserves-$90', { path:failedPath, contentType:'image/png' });

    const durable = await pool.query<{
      current_price:string;
      health:string;
      last_successful_crawl_at:Date;
      observations:number;
      price_changes:number;
    }>(`
      SELECT l.current_price::text,l.health,l.last_successful_crawl_at,
        (SELECT count(*)::int FROM price_observations o WHERE o.competitor_listing_id=l.id) AS observations,
        (SELECT count(*)::int FROM change_events c WHERE c.listing_id=l.id AND c.type='PRICE_CHANGED') AS price_changes
      FROM competitor_listings l
      WHERE l.retailer='Fixture Store'
      LIMIT 1
    `);
    const row = durable.rows[0];
    expect(row).toBeTruthy();
    expect(Number(row.current_price)).toBe(90);
    expect(row.health).toBe('PARSE_FAILED');
    expect(row.observations).toBe(2);
    expect(row.price_changes).toBe(1);
  } finally {
    await api.close();
    await worker.close();
    await queue.close();
    await fixture.close();
    await pool.end();
  }
});
