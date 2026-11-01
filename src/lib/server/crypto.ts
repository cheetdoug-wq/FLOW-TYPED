import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

const key = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "flow-typed", "session-v1", 32));

/** AES-256-GCM: the cookie can be neither read nor altered without SESSION_SECRET. */
export function seal(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function unseal<T>(token: string, secret: string): T | null {
  try {
    const raw = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const data = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(data.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export const randomToken = () => randomBytes(32).toString("base64url");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
