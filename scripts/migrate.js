import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Pool } = pg;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(currentDirectory, '../migrations');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required. Copy .env.example to .env first.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5_000,
  max: 1
});

function checksum(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('yapping-frog-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith('.sql'))
      .sort();

    const appliedResult = await client.query(
      'SELECT filename, checksum FROM schema_migrations'
    );
    const applied = new Map(
      appliedResult.rows.map((row) => [row.filename, row.checksum])
    );

    for (const filename of files) {
      const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8');
      const fileChecksum = checksum(sql);

      if (applied.has(filename)) {
        if (applied.get(filename) !== fileChecksum) {
          throw new Error(`Applied migration was modified: ${filename}`);
        }

        console.log(`Already applied: ${filename}`);
        continue;
      }

      console.log(`Applying: ${filename}`);
      await client.query('BEGIN');

      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [filename, fileChecksum]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log('Database is up to date.');
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('yapping-frog-migrations'))");
    client.release();
  }
}

try {
  await migrate();
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
