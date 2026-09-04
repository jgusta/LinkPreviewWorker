import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { LinkPreview } from "../src/types";

afterEach(() => vi.restoreAllMocks());

function mockPage() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
    "<html><head><title>Fresh headline</title></head></html>",
    { headers: { "content-type": "text/html" } },
  ));
}

describe("read-only response caching", () => {
  it.each([true, false])("returns only the image URL with includeAssets=%s", async (includeAssets) => {
    const fetched: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      fetched.push(url);
      if (url === "https://example.com/favicon.ico") {
        return new Response(new Uint8Array([0, 0, 1, 0]), { headers: { "content-type": "image/x-icon" } });
      }
      if (url !== "https://example.com/article") throw new Error("Unexpected image download");
      return new Response('<html><head><meta property="og:image" content="/photo.jpg"></head></html>', {
        headers: { "content-type": "text/html" },
      });
    });
    const response = await worker.fetch(new Request(
      `https://worker.example/preview?url=example.com/article&includeAssets=${includeAssets}`,
    ), env);
    expect(response.status).toBe(200);
    const preview = await response.json<LinkPreview>();
    expect(preview.image).toEqual({ url: "https://example.com/photo.jpg" });
    expect(preview.warnings).toEqual([]);
    if (includeAssets) {
      expect(preview.favicon?.data).toBe("data:image/x-icon;base64,AAABAA==");
      expect(fetched).toEqual(["https://example.com/article", "https://example.com/favicon.ico"]);
    } else {
      expect(preview.favicon).toBeNull();
      expect(fetched).toEqual(["https://example.com/article"]);
    }
  });

  it("rebuilds on each handler invocation and sets a 24-hour edge TTL", async () => {
    const upstream = mockPage();
    // Direct calls bypass Cloudflare's edge cache.
    for (let i = 0; i < 2; i++) {
      const response = await worker.fetch(new Request(
        "https://worker.example/preview?url=example.com&includeAssets=false",
        { headers: { Origin: "https://crazywall.cc" } },
      ), env);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=86400");
      expect(response.headers.get("access-control-allow-origin")).toBe("https://crazywall.cc");
      expect(response.headers.get("vary")).toBe("Origin");
      expect((await response.json<LinkPreview>()).url).toBe("https://example.com/");
    }
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("keeps incomplete previews short-lived", async () => {
    mockPage().mockImplementation(async (input) => String(input).includes("favicon")
      ? new Response("Unavailable", { status: 503 })
      : new Response("<html><title>Partial</title></html>", { headers: { "content-type": "text/html" } }));
    const response = await worker.fetch(new Request("https://worker.example/preview?url=example.com"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    expect((await response.json<LinkPreview>()).warnings.length).toBeGreaterThan(0);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("rejects %s without upstream work", async (method) => {
    const upstream = mockPage();
    const response = await worker.fetch(new Request("https://worker.example/preview?url=example.com", { method }), env);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ["/preview?url=example.com&includeAssets=false", 200],
    ["/preview?url=localhost", 400],
    ["/preview", 400],
    ["/health", 200],
  ])("returns no body for HEAD %s", async (path, status) => {
    mockPage();
    const response = await worker.fetch(new Request(`https://worker.example${path}`, { method: "HEAD" }), env);
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    if (path.includes("example.com")) {
      expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=86400");
    } else {
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("advertises only read methods for CORS", async () => {
    const response = await worker.fetch(new Request("https://worker.example/preview", {
      method: "OPTIONS", headers: { Origin: "https://crazywall.cc" },
    }), env);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
  });
});
