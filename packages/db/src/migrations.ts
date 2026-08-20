import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const MIGRATION_PATTERN = /^(\d+)_([a-z0-9][a-z0-9_-]*)\.sql$/i;
const MIGRATION_LOCK_KEY = '7288420429441281';

export interface MigrationFile {
  version: number;
  name: string;
  filename: string;
  checksum: string;
  sql: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  appliedAt: Date;
}

export function defaultMigrationDirectory() {
  return fileURLToPath(new URL('../migrations/', import.meta.url));
}

export async function discoverMigrations(directory = defaultMigrationDirectory()): Promise<MigrationFile[]> {
  const names = (await readdir(directory)).filter((name) => MIGRATION_PATTERN.test(name)).sort();
  const migrations: MigrationFile[] = [];
  const versions = new Set<number>();

  for (const filename of names) {
    const match = filename.match(MIGRATION_PATTERN);
    if (!match) continue;
    const version = Number(match[1]);
    if (!Number.isSafeInteger(version) || version <= 0) throw new Error(`Invalid migration version: ${filename}`);
    if (versions.has(version)) throw Object.assign(new Error(`Duplicate migration version: ${version}`), { code:'MIGRATION_DUPLICATE_VERSION' });
    versions.add(version);
    const sql = await readFile(join(directory, filename), 'utf8');
    migrations.push({
      version,
      name: match[2],
      filename,
      checksum: createHash('sha256').update(sql).digest('hex'),
      sql,
    });
  }

  migrations.sort((a, b) => a.version - b.version || a.filename.localeCompare(b.filename));
  return migrations;
}

export async function getAppliedMigrations(pool: Pool): Promise<AppliedMigration[]> {
  const result = await pool.query<{version:number;name:string;checksum:string;applied_at:Date}>(`
    SELECT version,name,checksum,applied_at
    FROM schema_migrations
    ORDER BY version ASC
  `);
  return result.rows.map((row) => ({ version:row.version, name:row.name, checksum:row.checksum.trim(), appliedAt:row.applied_at }));
}

export async function runMigrations(pool: Pool, options: { directory?: string } = {}) {
  const migrations = await discoverMigrations(options.directory);
  if (migrations.length === 0) throw Object.assign(new Error('No migration files found'), { code:'MIGRATION_FILES_MISSING' });

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query<{version:number;name:string;checksum:string}>(
      'SELECT version,name,checksum FROM schema_migrations ORDER BY version ASC',
    );
    const discoveredByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

    for (const applied of appliedResult.rows) {
      const current = discoveredByVersion.get(applied.version);
      if (!current) {
        throw Object.assign(new Error(`Applied migration ${applied.version}_${applied.name} is missing from disk`), { code:'MIGRATION_FILE_MISSING' });
      }
      if (current.name !== applied.name || current.checksum !== applied.checksum.trim()) {
        throw Object.assign(new Error(`Migration ${applied.version}_${applied.name} checksum/name mismatch`), { code:'MIGRATION_CHECKSUM_MISMATCH' });
      }
    }

    const appliedVersions = new Set(appliedResult.rows.map((row) => row.version));
    const newlyApplied: number[] = [];
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
        newlyApplied.push(migration.version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return { applied:newlyApplied, currentVersion:migrations.at(-1)?.version ?? 0 };
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]); } finally { client.release(); }
  }
}
