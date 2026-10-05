"use server";

import { redirect } from "next/navigation";
import { createSupabaseServer, supabaseConfigured } from "@/lib/server/supabase";

export async function signIn(formData: FormData): Promise<void> {
  if (!supabaseConfigured()) redirect("/admin/login?error=unconfigured");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/admin/login?error=missing");

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/admin/login?error=invalid");
  redirect("/admin/campaigns");
}

export async function signOut(): Promise<void> {
  if (supabaseConfigured()) {
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
  }
  redirect("/admin/login");
}
