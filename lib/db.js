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
      // Connection pool settings for production
      max: 20,                    // Maximum connections in pool
      idleTimeoutMillis: 30000,   // Close idle connections after 30 seconds
      connectionTimeoutMillis: 5000, // Fail connection attempts after 5 seconds
    })
  : null;

// Handle pool errors to prevent crashes
if (pool) {
  pool.on('error', (err) => {
    console.error('DATABASE_POOL_ERROR: Unexpected error on idle client', err.message);
    // Pool will automatically remove the errored client
  });

  pool.on('connect', () => {
    console.log('DATABASE: New client connected to pool');
  });
}

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
