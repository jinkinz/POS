import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** scrypt for low-entropy secrets (passwords, PINs). Format: s2:<salt>:<key>. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(secret, salt, 32);
  return `s2:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifySecret(
  secret: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, keyHex] = stored.split(":");
  if (scheme !== "s2" || !saltHex || !keyHex) return false;
  const key = await scryptAsync(secret, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * Plain sha256 for high-entropy device tokens (32 random bytes) — safe to
 * hash deterministically, and it allows direct DB lookup by hash.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString("hex");
}
