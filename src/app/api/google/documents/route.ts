import { friendlyError, listDocuments } from "@/lib/server/google";
import { authenticate } from "@/lib/server/route-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;
  try {
    return Response.json({ documents: await listDocuments(auth.session.accessToken) }, { headers: auth.headers });
  } catch (err) {
    const body = friendlyError(err);
    return Response.json(body, { status: body.reconnect ? 401 : 502, headers: auth.headers });
  }
}
