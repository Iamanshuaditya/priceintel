import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabasePool } from '../../packages/db/src/index.ts';
import { discoverMigrations, getAppliedMigrations, runMigrations } from '../../packages/db/src/migrations.ts';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  test('migration ledger integration requires DATABASE_URL', { skip:true }, () => {});
} else {
  test('migration runner records ordered immutable checksums and is idempotent under concurrent invocation', async () => {
    const pool = createDatabasePool(databaseUrl);
    try {
      await runMigrations(pool);
      const discovered = await discoverMigrations();
      const applied = await getAppliedMigrations(pool);
      assert.deepEqual(applied.map((row) => row.version), discovered.map((row) => row.version));
      assert.deepEqual(applied.map((row) => row.name), discovered.map((row) => row.name));
      assert.deepEqual(applied.map((row) => row.checksum), discovered.map((row) => row.checksum));

      const concurrent = await Promise.all([runMigrations(pool), runMigrations(pool)]);
      assert.deepEqual(concurrent.map((result) => result.applied), [[], []]);

      const target = discovered.at(-1);
      assert.ok(target);
      await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2', ['0'.repeat(64), target.version]);
      await assert.rejects(
        runMigrations(pool),
        (error: unknown) => (error as {code?:string}).code === 'MIGRATION_CHECKSUM_MISMATCH',
      );
      await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2', [target.checksum, target.version]);
      await runMigrations(pool);
    } finally {
      await pool.end();
    }
  });
}
