import type { GoogleConfig } from "./config";
import { seal, unseal } from "./crypto";

export interface Session {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  email?: string;
  name?: string;
}

export const SESSION_COOKIE = "ft_session";
export const OAUTH_COOKIE = "ft_oauth";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export function cookieHeader(cfg: GoogleConfig, name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.secureCookies ? "; Secure" : ""}`;
}

export const sessionCookie = (cfg: GoogleConfig, s: Session) =>
  cookieHeader(cfg, SESSION_COOKIE, seal(s, cfg.sessionSecret), SESSION_MAX_AGE);

export const clearCookie = (cfg: GoogleConfig, name: string) => cookieHeader(cfg, name, "", 0);

export function readSession(req: Request, cfg: GoogleConfig): Session | null {
  const raw = readCookie(req, SESSION_COOKIE);
  return raw ? unseal<Session>(raw, cfg.sessionSecret) : null;
}

/** Rejects state-changing requests that did not come from this app's own pages. */
export function isSameOrigin(req: Request, cfg: GoogleConfig): boolean {
  return req.headers.get("origin") === new URL(cfg.appUrl).origin;
}
