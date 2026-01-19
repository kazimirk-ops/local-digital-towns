const fs = require("fs");
const path = require("path");
const db = require("../lib/db");

async function ensureMigrationsTable() {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
  );
}

function listMigrationFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function loadAppliedVersions() {
  const rows = await db.many("SELECT version FROM schema_migrations");
  return new Set(rows.map((row) => row.version));
}

async function applyMigration(filePath, version) {
  const sql = fs.readFileSync(filePath, "utf8");
  await db.query("BEGIN");
  try {
    await db.query(sql);
    await db.query("INSERT INTO schema_migrations(version) VALUES ($1)", [
      version,
    ]);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

async function runMigrations() {
  const dir = path.join(__dirname, "migrations");
  await ensureMigrationsTable();
  const applied = await loadAppliedVersions();
  const files = listMigrationFiles(dir);
  for (const file of files) {
    if (applied.has(file)) continue;
    await applyMigration(path.join(dir, file), file);
  }
}

module.exports = {
  runMigrations,
};
