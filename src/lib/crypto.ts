import crypto from "node:crypto";

const PEPPER = process.env.KANBAI_KEY_PEPPER ?? "";

/**
 * Generate a fresh agent API key. The plaintext is shown to the user exactly
 * once; only the hash is persisted.
 */
export function generateApiKey() {
  const raw = crypto.randomBytes(24).toString("base64url");
  const key = `kbai_live_${raw}`;
  return {
    key,
    hash: hashApiKey(key),
    prefix: key.slice(0, 14), // e.g. "kbai_live_a1b2"
    last4: key.slice(-4),
  };
}

/** SHA-256(pepper || key). Peppered so a DB leak alone can't be brute-forced offline as easily. */
export function hashApiKey(key: string) {
  return crypto.createHash("sha256").update(PEPPER + key).digest("hex");
}

export function randomId(prefix = "evt") {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}
