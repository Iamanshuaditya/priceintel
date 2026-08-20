import { assertAutomatedSourceAccess } from '../../../packages/crawler-core/src/source-access-policy.ts';
import { secureFetch } from '../../../packages/crawler-core/src/url-policy.ts';
import type { HtmlFetchOptions } from '../../../packages/crawler-core/src/crawl.ts';
import { createDatabasePool } from '../../../packages/db/src/index.ts';
import { createCrawlWorker } from '../../../packages/jobs/src/crawl-queue.ts';
import { buildCrawlProcessor } from '../../../packages/jobs/src/worker.ts';
import { migrateApplication } from '../../api/src/storage.ts';

const pool = createDatabasePool();
if (process.env.WORKER_AUTO_MIGRATE === '1') await migrateApplication(pool);

const fetchHtml = async (url: string, options: HtmlFetchOptions = {}) => {
  const { response, finalUrl } = await secureFetch(url, {
    authorizeTarget:assertAutomatedSourceAccess,
    timeoutMs:options.timeoutMs,
    maxResponseBytes:options.maxResponseBytes,
  });
  if (response.status < 200 || response.status >= 300) {
    throw Object.assign(new Error(`HTTP ${response.status}`), { code:`HTTP_${response.status}` });
  }
  return {
    html:await response.text(),
    finalUrl,
    status:response.status,
    contentType:response.headers.get('content-type') ?? undefined,
  };
};

const worker = createCrawlWorker(buildCrawlProcessor(pool, fetchHtml));
await worker.waitUntilReady();
console.log('PriceIntel crawl worker ready');

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await worker.close();
  await pool.end();
}

process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
