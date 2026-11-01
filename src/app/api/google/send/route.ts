import { ContentError, normalizeBlocks, type Block } from "@/lib/docs/model";
import { documentUrl, friendlyError, sendToDocs, type Destination } from "@/lib/server/google";
import { authenticate } from "@/lib/server/route-auth";
import { isSameOrigin } from "@/lib/server/session";

export const dynamic = "force-dynamic";

function parseDestination(input: unknown): Destination | null {
  const d = (input ?? {}) as Record<string, unknown>;
  if (d.type === "new") {
    const title = typeof d.title === "string" ? d.title.trim().slice(0, 200) : "";
    return { type: "new", title: title || "Untitled document" };
  }
  if (d.type === "existing" && typeof d.documentId === "string" && /^[\w-]{10,200}$/.test(d.documentId)) {
    return { type: "existing", documentId: d.documentId, position: d.position === "start" ? "start" : "end" };
  }
  return null;
}

/** Streams newline-delimited JSON so the progress bar reflects what the server is actually doing. */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;
  if (!isSameOrigin(req, auth.cfg)) return Response.json({ message: "Request blocked." }, { status: 403 });

  let blocks: Block[];
  let destination: Destination | null;
  try {
    const body = (await req.json()) as { blocks?: unknown; destination?: unknown };
    blocks = normalizeBlocks(body.blocks);
    destination = parseDestination(body.destination);
  } catch (err) {
    const message = err instanceof ContentError ? err.message : "The request couldn't be read.";
    return Response.json({ message }, { status: 400, headers: auth.headers });
  }
  if (!destination) return Response.json({ message: "Choose a destination document." }, { status: 400, headers: auth.headers });

  const dest = destination;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch { /* the browser went away; the write still finishes */ }
      };
      let createdId: string | undefined;
      try {
        const result = await sendToDocs(auth.session.accessToken, blocks, dest, (stage, id) => {
          if (id) createdId = id;
          emit({ type: "stage", stage });
        });
        emit({ type: "done", ...result });
      } catch (err) {
        emit({ type: "error", ...friendlyError(err), createdUrl: createdId ? documentUrl(createdId) : undefined });
      } finally {
        controller.close();
      }
    },
  });

  auth.headers.set("content-type", "application/x-ndjson; charset=utf-8");
  auth.headers.set("x-accel-buffering", "no");
  return new Response(stream, { headers: auth.headers });
}
