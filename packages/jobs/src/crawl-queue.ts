import { createHash } from 'node:crypto';
import { Queue, Worker, type JobsOptions, type Processor, type WorkerOptions } from 'bullmq';

export const CRAWL_QUEUE_NAME = 'priceintel-crawl';

export interface CrawlJobData {
  workspaceId: string;
  listingId: string;
  crawlRunId: string;
  jobKey: string;
}

export function redisConnectionFromUrl(redisUrl = process.env.REDIS_URL) {
  if (!redisUrl) throw new Error('REDIS_URL is required');
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null as null,
  };
}

export function bullJobId(jobKey: string) {
  return `crawl-${createHash('sha256').update(jobKey).digest('hex')}`;
}

export function createCrawlQueue(redisUrl?: string, queueName = CRAWL_QUEUE_NAME) {
  return new Queue<CrawlJobData>(queueName, { connection: redisConnectionFromUrl(redisUrl) });
}

export async function enqueueCrawl(queue: Queue<CrawlJobData>, data: CrawlJobData, options: JobsOptions = {}) {
  return queue.add('crawl-listing', data, {
    jobId: bullJobId(data.jobKey),
    attempts: 3,
    backoff: { type: 'exponential', delay: 250 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400, count: 5000 },
    ...options,
  });
}

export function createCrawlWorker(
  processor: Processor<CrawlJobData>,
  redisUrl?: string,
  options: Omit<WorkerOptions, 'connection'> & { queueName?: string } = {},
) {
  const { queueName = CRAWL_QUEUE_NAME, ...workerOptions } = options;
  return new Worker<CrawlJobData>(queueName, processor, {
    connection: redisConnectionFromUrl(redisUrl),
    ...workerOptions,
  });
}
