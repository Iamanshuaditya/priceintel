import { createDatabasePool } from '../packages/db/src/index.ts';
import { migrateApplication } from '../apps/api/src/storage.ts';
const pool = createDatabasePool();
try {
  await migrateApplication(pool);
  console.log('database migration complete');
} finally {
  await pool.end();
}
