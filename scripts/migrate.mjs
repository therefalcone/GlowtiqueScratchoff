// Applies supabase/migrations/*.sql in filename order, once each, tracked in
// schema_migrations. Usage: DATABASE_URL=... node scripts/migrate.mjs
import dns from "node:dns";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Serverless/build hosts often lack IPv6 egress; try A records before AAAA.
dns.setDefaultResultOrder("ipv4first");

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "supabase",
  "migrations"
);

export async function migrate(client) {
  await client.query(
    `create table if not exists schema_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`
  );
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const seen = await client.query(
      "select 1 from schema_migrations where name = $1",
      [file]
    );
    if (seen.rowCount > 0) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [
        file,
      ]);
      await client.query("commit");
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`migration ${file} failed: ${err.message}`, {
        cause: err,
      });
    }
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(client);
    console.log("migrations up to date");
  } finally {
    await client.end();
  }
}
