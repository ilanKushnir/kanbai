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

/** A short alphanumeric id (for readable public links). */
export function shortId(len = 6): string {
  return randomBytes(16).toString("base64url").replace(/[-_]/g, "").slice(0, len).toLowerCase();
}

/** A high-entropy, mixed-case URL-safe token (for unguessable public-share suffixes). */
export function shortToken(len = 16): string {
  return randomBytes(24).toString("base64url").replace(/[-_]/g, "").slice(0, len);
}

/** SHA-256 hex — we store only the hash of session/invite tokens. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
