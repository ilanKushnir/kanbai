import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

/** Hash a password with scrypt. Stored as "salt:derivedKey" (both hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const dk = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${dk}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.includes(":")) return false;
  const [salt, dk] = stored.split(":");
  const calc = scryptSync(password, salt, 64);
  const expected = Buffer.from(dk, "hex");
  if (expected.length !== calc.length) return false;
  return timingSafeEqual(expected, calc);
}

/** A random URL-safe token (for sessions and invites). */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex — we store only the hash of session/invite tokens. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
