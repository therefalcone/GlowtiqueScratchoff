import dns from "node:dns";
import { Pool, type PoolClient } from "pg";

// Serverless hosts often lack IPv6 egress; try A records before AAAA.
dns.setDefaultResultOrder("ipv4first");

let pool: Pool | undefined;

/** Lazily constructed shared pool for server code (DATABASE_URL). */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

/** Runs fn inside BEGIN/COMMIT, rolling back on any error. */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // the original error matters more
    }
    throw err;
  } finally {
    client.release();
  }
}
