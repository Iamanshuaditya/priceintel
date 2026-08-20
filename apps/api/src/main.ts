import { createDatabasePool } from '../../../packages/db/src/index.ts';
import { createCrawlQueue } from '../../../packages/jobs/src/crawl-queue.ts';
import { createApiServer } from './server.ts';
import { migrateApplication } from './storage.ts';

const pool = createDatabasePool();
const queue = createCrawlQueue();
await migrateApplication(pool);

const app = createApiServer({ pool, queue });
const port = Number(process.env.PORT ?? 3000);
const host = process.env.API_HOST ?? '0.0.0.0';
const base = await app.listen(port, host);
console.log(`PriceIntel API listening on ${base}`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  await queue.close();
  await pool.end();
}

process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
