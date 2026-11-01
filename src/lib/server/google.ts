import { compileRequests, planInsertion, type DocSnapshot, type InsertPosition } from "../docs/compile";
import type { Block } from "../docs/model";
import { DRIVE_FILE_SCOPE, SCOPES, type GoogleConfig } from "./config";
import { sessionCookie, type Session } from "./session";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DOCS_API = "https://docs.googleapis.com/v1/documents";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DOC_MIME = "application/vnd.google-apps.document";

export class GoogleError extends Error {
  constructor(public status: number, public googleMessage: string, public code: "auth" | "permission" | "not_found" | "rate" | "conflict" | "other") {
    super(googleMessage);
  }
}

export function friendlyError(err: unknown): { message: string; reconnect?: boolean } {
  if (err instanceof GoogleError) {
    switch (err.code) {
      case "auth":
        return { message: "Your Google connection expired. Connect again to continue.", reconnect: true };
      case "permission":
        return { message: "Google says this account can't edit that document. Choose a document you can edit, or open it with Browse Google Drive to give Flow Typed access." };
      case "not_found":
        return { message: "Google couldn't find that document, or Flow Typed doesn't have access to it. Choose it again with Browse Google Drive." };
      case "rate":
        return { message: "Google is limiting requests right now. Nothing was inserted. Wait a minute and try again." };
      case "conflict":
        return { message: "The document kept changing while Flow Typed was writing, so nothing was inserted. Try again." };
      default:
        return err.status >= 500
          ? { message: "Google had a problem finishing the request. Open the document to check it before trying again, so the text isn't inserted twice." }
          : { message: `Google returned an error: ${err.googleMessage}` };
    }
  }
  return { message: "The connection to Google was interrupted. Check the document before trying again, so the text isn't inserted twice." };
}

/* ---------- OAuth ---------- */

export function authorizeUrl(cfg: GoogleConfig, state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${q}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new GoogleError(res.status, "Token request failed", "auth");
  return (await res.json()) as TokenResponse;
}

export class MissingScopeError extends Error {}

export async function exchangeCode(cfg: GoogleConfig, code: string, verifier: string): Promise<Session> {
  const t = await tokenRequest({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  // Google lets people untick individual permissions on the consent screen.
  if (!t.scope?.split(" ").includes(DRIVE_FILE_SCOPE)) throw new MissingScopeError();
  // The ID token comes straight from Google's token endpoint over TLS, so OIDC doesn't require re-verifying its signature.
  let claims: { email?: string; name?: string } = {};
  try {
    claims = JSON.parse(Buffer.from(t.id_token?.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch { /* the name and email are only for display */ }
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    email: claims.email,
    name: claims.name,
  };
}

/** Returns a session with a usable access token, plus a Set-Cookie value if it was refreshed. */
export async function ensureFresh(cfg: GoogleConfig, s: Session): Promise<{ session: Session; setCookie?: string }> {
  if (s.expiresAt - Date.now() > 60_000) return { session: s };
  if (!s.refreshToken) throw new GoogleError(401, "Session expired", "auth");
  const t = await tokenRequest({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: s.refreshToken,
    grant_type: "refresh_token",
  });
  const session: Session = { ...s, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  return { session, setCookie: sessionCookie(cfg, session) };
}

export async function revoke(s: Session): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: s.refreshToken ?? s.accessToken }),
  }).catch(() => undefined);
}

/* ---------- API calls ---------- */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function toGoogleError(res: Response): Promise<GoogleError> {
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch { /* keep the status */ }
  const s = res.status;
  if (s === 400 && /revision/i.test(message)) return new GoogleError(s, message, "conflict");
  if (s === 401) return new GoogleError(s, message, "auth");
  if (s === 403 && /rate|quota/i.test(message)) return new GoogleError(s, message, "rate");
  if (s === 403) return new GoogleError(s, message, "permission");
  if (s === 404) return new GoogleError(s, message, "not_found");
  if (s === 429) return new GoogleError(s, message, "rate");
  return new GoogleError(s, message, "other");
}

/**
 * Calls a Google API. 429 means the request was refused, so it is always safe to
 * retry. Server errors are retried only for reads: a failed write may have applied.
 */
async function call<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const isRead = (init.method ?? "GET") === "GET";
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    });
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || (isRead && res.status >= 500);
    if (!retryable || attempt >= 3) throw await toGoogleError(res);
    await wait(500 * 2 ** attempt + Math.random() * 250);
  }
}

export interface DocSummary {
  id: string;
  name: string;
  modifiedTime?: string;
}

/** With drive.file this returns only documents the user created with, or opened in, Flow Typed. */
export async function listDocuments(token: string): Promise<DocSummary[]> {
  const q = new URLSearchParams({
    q: `mimeType='${DOC_MIME}' and trashed=false`,
    orderBy: "modifiedTime desc",
    pageSize: "20",
    fields: "files(id,name,modifiedTime)",
  });
  const data = await call<{ files?: DocSummary[] }>(token, `${DRIVE_API}?${q}`);
  return data.files ?? [];
}

const SNAPSHOT_FIELDS = "documentId,title,revisionId,body.content(startIndex,endIndex,paragraph.elements.textRun.content)";

const getDocument = (token: string, id: string) =>
  call<DocSnapshot>(token, `${DOCS_API}/${encodeURIComponent(id)}?fields=${encodeURIComponent(SNAPSHOT_FIELDS)}`);

export const documentUrl = (id: string) => `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit`;

export type Destination =
  | { type: "new"; title: string }
  | { type: "existing"; documentId: string; position: InsertPosition };

export type Stage = "creating" | "reading" | "writing";

export interface SendResult {
  documentId: string;
  title: string;
  url: string;
}

/**
 * Inserts blocks into a document in one atomic batch. requiredRevisionId makes Google
 * reject the batch if someone edited the document after it was read, since the
 * insertion index would be stale. It then re-reads and tries again.
 */
export async function sendToDocs(
  token: string,
  blocks: Block[],
  dest: Destination,
  onStage: (stage: Stage, createdDocumentId?: string) => void,
): Promise<SendResult> {
  let documentId: string;
  let position: InsertPosition = "end";
  if (dest.type === "new") {
    onStage("creating");
    const created = await call<DocSnapshot>(token, DOCS_API, {
      method: "POST",
      body: JSON.stringify({ title: dest.title }),
    });
    documentId = created.documentId;
    onStage("creating", documentId);
  } else {
    documentId = dest.documentId;
    position = dest.position;
  }

  for (let attempt = 0; ; attempt += 1) {
    onStage("reading");
    const doc = await getDocument(token, documentId);
    onStage("writing");
    try {
      await call(token, `${DOCS_API}/${encodeURIComponent(documentId)}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: compileRequests(blocks, planInsertion(doc, position)),
          writeControl: { requiredRevisionId: doc.revisionId },
        }),
      });
      return { documentId, title: doc.title ?? "Untitled document", url: documentUrl(documentId) };
    } catch (err) {
      if (!(err instanceof GoogleError) || err.code !== "conflict" || attempt >= 2) throw err;
    }
  }
}
