import { getPickerConfig } from "@/lib/server/config";
import { authenticate } from "@/lib/server/route-auth";

export const dynamic = "force-dynamic";

/**
 * The Google Picker runs in the browser and needs an access token. This token is
 * limited to the drive.file scope and expires within about an hour; the refresh
 * token never leaves the encrypted cookie.
 */
export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;
  const picker = getPickerConfig();
  if (!picker) return Response.json({ message: "Browse Google Drive isn't configured on this server." }, { status: 503, headers: auth.headers });
  return Response.json({ ...picker, accessToken: auth.session.accessToken }, { headers: auth.headers });
}
