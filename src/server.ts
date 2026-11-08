import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import app from "./index";
import { createEnv } from "./config";
import { PreviewCache } from "./cache";
import { parsePositiveInteger } from "./network";
import { publicDispatcher } from "./transport";

const env = createEnv();
env.CACHE = new PreviewCache(
  process.env.CACHE_DB_PATH ?? "./data/previews.sqlite",
  parsePositiveInteger(process.env.CACHE_TTL_SECONDS ?? "", 86400, 31536000),
  parsePositiveInteger(process.env.CACHE_MAX_ENTRIES ?? "", 10000, 1000000),
);
const port = parsePositiveInteger(process.env.PORT ?? "", 3000, 65535);
const server = createServer(async (incoming, outgoing) => {
  try {
    // A fixed base avoids trusting forwarded Host headers for routing.
    const request = new Request(new URL(incoming.url ?? "/", "http://service.local"), {
      method: incoming.method,
      headers: Object.fromEntries(Object.entries(incoming.headers).filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value!])),
    });
    incoming.resume();
    const response = await app.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(Readable.from(response.body), outgoing);
    else outgoing.end();
  } catch (error) {
    console.error(error);
    if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
    outgoing.end(JSON.stringify({ error: { code: "internal_error", message: "An unexpected error occurred." } }));
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(port, "0.0.0.0", () => console.log(`ogp-worker listening on ${port}`));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(() => { env.CACHE?.close(); void publicDispatcher.close().then(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
