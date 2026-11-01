import { getConfig, getPickerConfig } from "@/lib/server/config";
import { readSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const cfg = getConfig();
  const session = cfg ? readSession(req, cfg) : null;
  return Response.json(
    {
      configured: Boolean(cfg),
      pickerAvailable: Boolean(getPickerConfig()),
      connected: Boolean(session),
      user: session ? { email: session.email, name: session.name } : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
