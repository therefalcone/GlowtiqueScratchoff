import { createHash } from "node:crypto";

/** Short, stable, non-sequential card number for display ("No. 7F3K"). */
export function cardDisplayNumber(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 4).toUpperCase();
}

/** Card and wallet tokens are 16 random bytes, base64url: 22 chars. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
