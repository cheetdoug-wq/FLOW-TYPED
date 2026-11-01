import { getConfig } from "@/lib/server/config";
import { unseal } from "@/lib/server/crypto";
import { exchangeCode, MissingScopeError } from "@/lib/server/google";
import { clearCookie, OAUTH_COOKIE, readCookie, sessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!cfg) return new Response("Google sign-in isn't configured on this server.", { status: 503 });

  const headers = new Headers({ "cache-control": "no-store" });
  headers.append("set-cookie", clearCookie(cfg, OAUTH_COOKIE));
  const finish = (result: string) => {
    headers.set("location", `${cfg.appUrl}/?auth=${result}`);
    return new Response(null, { status: 302, headers });
  };

  const params = new URL(req.url).searchParams;
  const raw = readCookie(req, OAUTH_COOKIE);
  const saved = raw ? unseal<{ state: string; verifier: string }>(raw, cfg.sessionSecret) : null;
  if (!saved || !params.get("state") || params.get("state") !== saved.state) return finish("state_error");
  if (params.get("error")) return finish("denied");
  const code = params.get("code");
  if (!code) return finish("failed");

  try {
    const session = await exchangeCode(cfg, code, saved.verifier);
    headers.append("set-cookie", sessionCookie(cfg, session));
    return finish("connected");
  } catch (err) {
    return finish(err instanceof MissingScopeError ? "missing_scope" : "failed");
  }
}
