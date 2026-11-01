import { getConfig } from "@/lib/server/config";
import { pkceChallenge, randomToken, seal } from "@/lib/server/crypto";
import { authorizeUrl } from "@/lib/server/google";
import { cookieHeader, OAUTH_COOKIE } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export function GET() {
  const cfg = getConfig();
  if (!cfg) return new Response("Google sign-in isn't configured on this server.", { status: 503 });
  const state = randomToken();
  const verifier = randomToken();
  const headers = new Headers({ location: authorizeUrl(cfg, state, pkceChallenge(verifier)), "cache-control": "no-store" });
  headers.append("set-cookie", cookieHeader(cfg, OAUTH_COOKIE, seal({ state, verifier }, cfg.sessionSecret), 600));
  return new Response(null, { status: 302, headers });
}
