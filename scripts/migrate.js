/**
 * Database Migration Runner
 *
 * Usage:
 *   npm run db:migrate                    # Run all pending migrations
 *   npm run db:migrate -- --file 0014     # Run specific migration
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executedAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getExecutedMigrations() {
  const result = await pool.query('SELECT filename FROM migrations ORDER BY filename');
  return result.rows.map(r => r.filename);
}

async function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('No migrations directory found at:', MIGRATIONS_DIR);
    return [];
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  return files;
}

async function runMigration(filename) {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, 'utf8');

  console.log(`Running migration: ${filename}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    console.log(`✓ Migration completed: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`✗ Migration failed: ${filename}`);
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.indexOf('--file');
  const specificFile = fileArg !== -1 ? args[fileArg + 1] : null;

  try {
    await ensureMigrationsTable();

    const executed = await getExecutedMigrations();
    const allFiles = await getMigrationFiles();

    if (allFiles.length === 0) {
      console.log('No migration files found.');
      process.exit(0);
    }

    let toRun = [];

    if (specificFile) {
      // Run specific migration
      const match = allFiles.find(f => f.includes(specificFile));
      if (!match) {
        console.error(`Migration file matching "${specificFile}" not found.`);
        process.exit(1);
      }
      if (executed.includes(match)) {
        console.log(`Migration ${match} has already been executed.`);
        process.exit(0);
      }
      toRun = [match];
    } else {
      // Run all pending migrations
      toRun = allFiles.filter(f => !executed.includes(f));
    }

    if (toRun.length === 0) {
      console.log('No pending migrations.');
      process.exit(0);
    }

    console.log(`Found ${toRun.length} pending migration(s).\n`);

    for (const file of toRun) {
      await runMigration(file);
    }

    console.log('\nAll migrations completed successfully.');
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
