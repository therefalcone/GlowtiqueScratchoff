// Creates a fresh test database, stubs the Supabase-provided objects the RLS
// migration expects (roles, auth schema, auth.uid()), and applies migrations.
import pg from "pg";
import { migrate } from "../scripts/migrate.mjs";
import { TEST_DATABASE_URL } from "./helpers";

export default async function globalSetup(): Promise<void> {
  const testUrl = new URL(TEST_DATABASE_URL);
  const dbName = testUrl.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.query(`create database ${dbName}`);
  for (const role of ["anon", "authenticated", "service_role"]) {
    await admin.query(
      `do $$ begin create role ${role} nologin; exception when duplicate_object then null; end $$`
    );
  }
  await admin.end();

  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  await db.query(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text
    );
    create or replace function auth.uid() returns uuid
    language sql stable as $f$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $f$;
  `);
  await migrate(db);
  await db.end();
}
