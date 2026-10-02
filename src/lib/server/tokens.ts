import { randomBytes, randomInt } from "node:crypto";

/** 128-bit URL-safe token (22 base64url chars) for cards and wallets. */
export function generateToken(): string {
  return randomBytes(16).toString("base64url");
}

// Human-typeable: no 0/O, 1/I/L — staff read these over the front desk.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Redemption code in the design's format, e.g. GLW-7F3K-25. */
export function generateRedemptionCode(): string {
  const pick = (n: number) =>
    Array.from({ length: n }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `GLW-${pick(4)}-${pick(2)}`;
}

/** Uppercases and strips separators/whitespace, then re-hyphenates GLW-XXXX-XX. */
export function normalizeRedemptionCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^GLW[A-Z0-9]{6}$/.test(raw)) {
    return `GLW-${raw.slice(3, 7)}-${raw.slice(7)}`;
  }
  return input.trim().toUpperCase();
}
