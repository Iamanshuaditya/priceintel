import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { migrate } from '../../../packages/db/src/index.ts';

export async function migrateApplication(pool: Pool) {
  await migrate(pool);
  const path = fileURLToPath(new URL('../../../packages/db/migrations/002_auth.sql', import.meta.url));
  await pool.query(await readFile(path, 'utf8'));
}

export async function truncateApplication(pool: Pool) {
  await pool.query(`
    TRUNCATE sessions, memberships, users, notification_outbox, change_events,
      price_observations, crawl_runs, competitor_listings, products, workspaces CASCADE
  `);
}
