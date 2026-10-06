// Builds node-pg connection options from DATABASE_URL.
//
// node-pg now treats sslmode=require as verify-full, and Supabase's pooler
// presents a certificate from Supabase's own CA, so we take SSL out of the
// URL and configure it here: TLS is always on for non-local hosts; set
// DATABASE_CA_CERT (PEM) to verify the server certificate strictly.
export function pgConfig(connectionString) {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const ca = process.env.DATABASE_CA_CERT;

  let ssl;
  if (sslmode === "disable" || (local && !sslmode)) ssl = false;
  else if (ca) ssl = { ca, rejectUnauthorized: true };
  else ssl = { rejectUnauthorized: false };

  return { connectionString: url.toString(), ssl };
}
