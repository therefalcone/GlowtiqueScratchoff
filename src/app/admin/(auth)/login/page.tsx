import { redirect } from "next/navigation";
import { getStaffUser, supabaseConfigured } from "@/lib/server/supabase";
import { signIn, signOut } from "./actions";

const ERRORS: Record<string, string> = {
  invalid: "That email and password don't match a staff account.",
  missing: "Enter your email and password.",
  not_staff: "This account is signed in but isn't on the staff list. Ask an owner to add it.",
  unconfigured:
    "Supabase isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const staff = await getStaffUser();
  if (staff && staff !== "not_staff") redirect("/admin/campaigns");

  const message =
    (error && ERRORS[error]) ??
    (staff === "not_staff" ? ERRORS.not_staff : null) ??
    (!supabaseConfigured() ? ERRORS.unconfigured : null);

  return (
    <main className="admin min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-[400px] flex flex-col gap-6">
        <div>
          <div className="font-[family-name:var(--font-heading)] font-extrabold text-[15px] tracking-[.12em]">
            GLOWTIQUE
            <span className="text-muted block text-[10px] tracking-[.08em] font-normal">
              Loyalty admin
            </span>
          </div>
        </div>
        <div className="border-t-2 border-[var(--color-divider)] pt-4">
          <h1 className="text-[32px]">Sign in</h1>
          <p className="text-muted text-[13px] mt-1">Staff accounts only.</p>
        </div>
        {message && (
          <div
            role="alert"
            className="border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-100)] text-[var(--color-accent-800)] px-3 py-2 text-[13px]"
          >
            {message}
          </div>
        )}
        <form action={signIn} className="flex flex-col gap-4">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className="input" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="input"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block min-h-[44px]">
            Sign in
          </button>
        </form>
        {staff === "not_staff" && (
          <form action={signOut}>
            <button type="submit" className="btn btn-secondary">
              Sign out
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
