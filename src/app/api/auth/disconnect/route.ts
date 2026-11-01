import { getConfig } from "@/lib/server/config";
import { revoke } from "@/lib/server/google";
import { clearCookie, isSameOrigin, readSession, SESSION_COOKIE } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cfg = getConfig();
  if (!cfg) return new Response(null, { status: 503 });
  if (!isSameOrigin(req, cfg)) return new Response(null, { status: 403 });
  const session = readSession(req, cfg);
  if (session) await revoke(session);
  const headers = new Headers();
  headers.append("set-cookie", clearCookie(cfg, SESSION_COOKIE));
  return new Response(null, { status: 204, headers });
}
