import { redirect } from "next/navigation";
import { getStaffUser } from "@/lib/server/supabase";
import { signOut } from "../(auth)/login/actions";
import { AdminNav } from "./AdminNav";

// Every admin page depends on the session cookie; never prerender.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaffUser();
  if (!staff) redirect("/admin/login");
  if (staff === "not_staff") redirect("/admin/login?error=not_staff");

  return (
    <div className="admin min-h-screen grid grid-cols-[220px_1fr]">
      <aside className="border-r-2 border-[var(--color-divider)] px-5 py-6 flex flex-col gap-1 sticky top-0 h-screen">
        <div className="font-[family-name:var(--font-heading)] font-extrabold text-[15px] tracking-[.12em] mb-6">
          GLOWTIQUE
          <span className="text-muted block text-[10px] tracking-[.08em] font-normal">
            Loyalty admin
          </span>
        </div>
        <AdminNav />
        <div className="mt-auto text-[12px] flex flex-col gap-2">
          <span className="text-muted truncate">{staff.displayName ?? staff.email}</span>
          <form action={signOut}>
            <button type="submit" className="btn btn-ghost text-[12px] px-0">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="px-10 py-7 flex flex-col gap-6 min-w-0">{children}</main>
    </div>
  );
}
