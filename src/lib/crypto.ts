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

/** The signing secret the user sets; Kanbai signs outbound webhooks with it. */
export function generateWebhookSecret() {
  return `whsec_${crypto.randomBytes(24).toString("base64url")}`;
}

/**
 * Short non-reversible identifier for a signing secret (first 8 hex chars of
 * its SHA-256). Both sides can compare fingerprints to detect a secret
 * mismatch — the #1 cause of 401s — without ever exchanging the secret itself.
 */
export function secretFingerprint(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex").slice(0, 8);
}

/**
 * Sign `${timestamp}.${rawBody}` with HMAC-SHA256.
 * The agent recomputes this with the same secret to verify authenticity.
 */
export function signWebhook(secret: string, timestamp: string, rawBody: string) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/**
 * Constant-time verification of an inbound signature, with replay protection.
 * Reference implementation an agent can mirror.
 */
export function verifyWebhook(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
  toleranceSec = 300,
): boolean {
  const provided = signature.replace(/^sha256=/, "");
  const expected = signWebhook(secret, timestamp, rawBody);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  return Number.isFinite(age) && age <= toleranceSec;
}

export function randomId(prefix = "evt") {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}
