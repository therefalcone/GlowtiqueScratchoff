import type { Pool } from "pg";

export interface RateLimitOptions {
  /** e.g. "card:<ip>" */
  key: string;
  /** max hits per window */
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window counter in the rate_limits table: one row per key per window,
 * incremented atomically. Old windows are swept opportunistically.
 */
export async function checkRateLimit(
  pool: Pool,
  { key, limit, windowSeconds }: RateLimitOptions
): Promise<{ allowed: boolean; count: number }> {
  const res = await pool.query(
    `insert into rate_limits (key, window_start, count)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2::int) * $2::int), 1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1
     returning count`,
    [key, windowSeconds]
  );
  const count: number = res.rows[0].count;
  if (Math.random() < 0.01) {
    pool
      .query("delete from rate_limits where window_start < now() - interval '1 hour'")
      .catch(() => {});
  }
  return { allowed: count <= limit, count };
}
