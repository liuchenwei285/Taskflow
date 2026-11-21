// Local-only entry point (never packaged): runs the deployed handler under
// Deno when available, otherwise under Node's built-in TS type stripping.
//   node dev/function-local.ts          # Node >= 22.6 with type stripping
//   deno run --allow-net --allow-env dev/function-local.ts
import { handler } from "../functions/handler.ts";

const g = globalThis as any;
const PORT = 8000;

if (g.Deno && typeof g.Deno.serve === "function") {
  g.Deno.serve({ hostname: "127.0.0.1", port: PORT }, handler);
  console.log("Taskflow AI local function (Deno): http://127.0.0.1:" + PORT);
} else {
  const http = await import("node:http");
  http.createServer(async (req: any, res: any) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(","));
    }
    const request = new Request("http://127.0.0.1:" + PORT + req.url, {
      method: req.method,
      headers,
      body: body.length ? body : undefined,
    });
    try {
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: { code: "internal_error", retryable: false } }));
    }
  }).listen(PORT, "127.0.0.1", () => {
    console.log("Taskflow AI local function (Node adapter): http://127.0.0.1:" + PORT);
  });
}