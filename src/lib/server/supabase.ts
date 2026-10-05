import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPool } from "./db";

export interface StaffUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** Cookie-backed Supabase client for server components, actions and routes. */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a server component: middleware refreshes the session.
          }
        },
      },
    }
  );
}

/** The signed-in Supabase user, or null when signed out / unconfigured. */
export async function getAuthUser(): Promise<{ id: string; email: string | null } | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * The signed-in user if, and only if, they are on the staff allowlist.
 * Returns "not_staff" for a signed-in user who is not allowlisted.
 */
export async function getStaffUser(): Promise<StaffUser | "not_staff" | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const res = await getPool().query(
    "select display_name from staff_users where user_id = $1",
    [user.id]
  );
  if (res.rowCount === 0) return "not_staff";
  return { id: user.id, email: user.email, displayName: res.rows[0].display_name };
}
