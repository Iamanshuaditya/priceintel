import { createDatabasePool } from '../../packages/db/src/index.ts';
import { createCrawlWorker } from '../../packages/jobs/src/crawl-queue.ts';
import { buildCrawlProcessor } from '../../packages/jobs/src/worker.ts';

const queueName = process.env.QUEUE_NAME;
if (!queueName) throw new Error('QUEUE_NAME is required');
const price = Number(process.env.TEST_PRICE ?? '90');
const availability = process.env.TEST_STOCK === 'out'
  ? 'https://schema.org/OutOfStock'
  : 'https://schema.org/InStock';

const pool = createDatabasePool();
const fetchHtml = async () => ({
  html: `<script type="application/ld+json">${JSON.stringify({
    '@context':'https://schema.org', '@type':'Product',
    offers:{ '@type':'Offer', price:String(price), priceCurrency:'USD', availability },
  })}</script>`,
});

const processor = buildCrawlProcessor(pool, fetchHtml, {
  afterCommit: async (_job, result) => {
    if (result.inserted && process.env.CRASH_AFTER_COMMIT === '1') {
      const { writeSync } = await import('node:fs');
      writeSync(2, 'SIMULATED_PROCESS_DEATH_AFTER_COMMIT\n');
      process.exit(23);
    }
  },
});

const worker = createCrawlWorker(processor, process.env.REDIS_URL, {
  queueName,
  concurrency: 1,
  lockDuration: 1000,
  stalledInterval: 500,
  maxStalledCount: 2,
});
worker.on('error', (error) => process.stderr.write(`worker-error:${error.message}\n`));
await worker.waitUntilReady();
process.stdout.write('CRASH_WORKER_READY\n');
