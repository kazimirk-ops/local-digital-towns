const { Pool, types } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV === "production") {
  console.error("DATABASE_URL missing; refusing to start in production.");
  throw new Error("DATABASE_URL is required in production.");
}

// Keep TIMESTAMPTZ values as ISO strings to match existing behavior.
types.setTypeParser(1114, (val) => val);
types.setTypeParser(1184, (val) => val);

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: connectionString.includes("sslmode=require")
        ? { rejectUnauthorized: false }
        : undefined,
    })
  : null;

async function query(text, params) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  return pool.query(text, params);
}

async function one(text, params) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

async function many(text, params) {
  const result = await query(text, params);
  return result.rows;
}

module.exports = {
  query,
  one,
  many,
};
