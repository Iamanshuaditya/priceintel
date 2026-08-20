import type { Pool } from 'pg';
import { runMigrations } from '../../../packages/db/src/migrations.ts';

export async function migrateApplication(pool: Pool) {
  return runMigrations(pool);
}

export async function truncateApplication(pool: Pool) {
  await pool.query(`
    TRUNCATE sessions, memberships, users, notification_outbox, change_events,
      price_observations, crawl_runs, competitor_listings, products, workspaces CASCADE
  `);
}
