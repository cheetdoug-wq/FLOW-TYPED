import { getConfig, type GoogleConfig } from "./config";
import { ensureFresh, friendlyError } from "./google";
import { clearCookie, readSession, SESSION_COOKIE, type Session } from "./session";

export type Authed =
  | { ok: true; cfg: GoogleConfig; session: Session; headers: Headers }
  | { ok: false; response: Response };

const noStore = () => new Headers({ "cache-control": "no-store" });

/** Loads the session and refreshes its access token, handling both failure paths once. */
export async function authenticate(req: Request): Promise<Authed> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, response: Response.json({ message: "Google isn't configured on this server." }, { status: 503 }) };
  const stored = readSession(req, cfg);
  if (!stored) return { ok: false, response: Response.json({ message: "Connect your Google account first.", reconnect: true }, { status: 401 }) };
  const headers = noStore();
  try {
    const { session, setCookie } = await ensureFresh(cfg, stored);
    if (setCookie) headers.append("set-cookie", setCookie);
    return { ok: true, cfg, session, headers };
  } catch (err) {
    const body = friendlyError(err);
    if (body.reconnect) headers.append("set-cookie", clearCookie(cfg, SESSION_COOKIE));
    return { ok: false, response: Response.json(body, { status: body.reconnect ? 401 : 502, headers }) };
  }
}
