import { readFile, realpath } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

const root = resolve("public");
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};
export async function serveStatic(request: Request): Promise<Response> {
  try {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const path = await realpath(resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`));
    if (!path.startsWith(root + sep) || !types[extname(path)]) return new Response("Not found", { status: 404 });
    const bytes = await readFile(path);
    const headers = new Headers({ "content-type": types[extname(path)]!, "cache-control": "public, max-age=300" });
    const policy = await readFile(resolve(root, "_headers"), "utf8");
    for (const line of policy.split("\n")) {
      const match = line.match(/^\s+([^:]+):\s*(.+)$/);
      if (match) headers.set(match[1]!, match[2]!);
    }
    return new Response(request.method === "HEAD" ? null : bytes, { headers });
  } catch { return new Response(request.method === "HEAD" ? null : "Not found", { status: 404 }); }
}
