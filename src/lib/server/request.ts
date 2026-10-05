import { headers } from "next/headers";

export function clientIpFrom(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

/**
 * Public base URL for links we hand out. NEXT_PUBLIC_APP_URL wins (custom
 * domain); otherwise derived from the request host, which covers local dev
 * and Vercel preview deployments.
 */
export function appUrlFrom(h: Headers): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function getClientIp(): Promise<string> {
  return clientIpFrom(await headers());
}

export async function getAppUrl(): Promise<string> {
  return appUrlFrom(await headers());
}
