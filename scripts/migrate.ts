import { createDatabasePool, migrate } from '../packages/db/src/index.ts';
const pool = createDatabasePool();
try {
  await migrate(pool);
  console.log('database migration complete');
} finally {
  await pool.end();
}
