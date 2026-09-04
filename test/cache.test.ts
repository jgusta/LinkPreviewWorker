import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCachedPreview, PERMANENT_CACHE_CONTROL, previewCacheKey } from "../src/cache";
import worker from "../src/index";
import type { LinkPreview, PreviewOptions } from "../src/types";

afterEach(() => vi.restoreAllMocks());

function options(includeAssets = true): PreviewOptions {
  return { url: `https://example.com/${crypto.randomUUID()}`, includeAssets };
}

function snapshot(input: PreviewOptions): LinkPreview {
  return {
    requestedUrl: input.url, url: input.url, canonicalUrl: null,
    title: "Original headline", description: "Original description", siteName: "Example",
    type: "article", meta: {}, warnings: [],
    image: input.includeAssets ? {
      url: "https://example.com/image.webp", data: "data:image/webp;base64,AAAA",
      contentType: "image/webp", size: 3,
    } : null,
    favicon: input.includeAssets ? {
      url: "https://example.com/favicon.ico", data: "data:image/x-icon;base64,AAAA",
      contentType: "image/x-icon", size: 3,
    } : null,
  };
}

describe("permanent preview archive", () => {
  it("normalizes URLs, strips fragments, and separates asset and query variants", async () => {
    const base = { url: "https://example.com/", includeAssets: true };
    expect(await previewCacheKey({ ...base, url: "https://EXAMPLE.com:443#section" }))
      .toBe(await previewCacheKey(base));
    expect(await previewCacheKey({ ...base, includeAssets: false }))
      .not.toBe(await previewCacheKey(base));
    expect(await previewCacheKey({ ...base, url: "https://example.com/?page=2" }))
      .not.toBe(await previewCacheKey(base));
  });

  it("reuses the stored JSON and both embedded assets without rebuilding", async () => {
    const input = options();
    const build = vi.fn(async () => snapshot(input));
    const first = await getCachedPreview(input, env.PREVIEW_CACHE, build);
    const second = await getCachedPreview({ ...input, url: `${input.url}#another` }, env.PREVIEW_CACHE, build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(first.permanent).toBe(true);
    expect(second.preview).toEqual({ ...first.preview, requestedUrl: `${input.url}#another` });
    const object = await env.PREVIEW_CACHE.head(await previewCacheKey(input));
    expect(object?.httpMetadata?.cacheControl).toBe(PERMANENT_CACHE_CONTROL);
  });

  it("uses a full snapshot for metadata-only requests", async () => {
    const input = options();
    await getCachedPreview(input, env.PREVIEW_CACHE, async () => snapshot(input));
    const build = vi.fn(async () => snapshot(input));
    const result = await getCachedPreview({ ...input, includeAssets: false }, env.PREVIEW_CACHE, build);
    expect(build).not.toHaveBeenCalled();
    expect(result.preview.image).toBeNull();
    expect(result.preview.favicon).toBeNull();
    expect(result.preview.title).toBe("Original headline");
  });

  it("does not use a metadata-only snapshot to satisfy an asset request", async () => {
    const input = options(false);
    await getCachedPreview(input, env.PREVIEW_CACHE, async () => snapshot(input));
    const full = { ...input, includeAssets: true };
    const build = vi.fn(async () => snapshot(full));
    const result = await getCachedPreview(full, env.PREVIEW_CACHE, build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(result.preview.image).not.toBeNull();
  });

  it("does not permanently save incomplete responses or failures", async () => {
    const input = options();
    const build = vi.fn(async () => ({ ...snapshot(input), warnings: ["Favicon omitted: timeout"] }));
    expect((await getCachedPreview(input, env.PREVIEW_CACHE, build)).permanent).toBe(false);
    await getCachedPreview(input, env.PREVIEW_CACHE, build);
    expect(build).toHaveBeenCalledTimes(2);
    expect(await env.PREVIEW_CACHE.head(await previewCacheKey(input))).toBeNull();
    await expect(getCachedPreview(input, env.PREVIEW_CACHE, async () => {
      throw new Error("Source unavailable");
    })).rejects.toThrow("Source unavailable");
    expect(await env.PREVIEW_CACHE.head(await previewCacheKey(input))).toBeNull();
  });

  it("keeps the first complete snapshot when cold requests race", async () => {
    const input = options();
    let release!: (preview: LinkPreview) => void;
    const blocked = new Promise<LinkPreview>((resolve) => { release = resolve; });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const slow = getCachedPreview(input, env.PREVIEW_CACHE, () => { started(); return blocked; });
    await ready;
    const winner = await getCachedPreview(input, env.PREVIEW_CACHE, async () => snapshot(input));
    release({ ...snapshot(input), title: "Later headline" });
    expect((await slow).preview).toEqual(winner.preview);
  });

  it("validates unsafe targets before accessing storage", async () => {
    const build = vi.fn();
    await expect(getCachedPreview({ url: "http://localhost", includeAssets: false }, env.PREVIEW_CACHE, build))
      .rejects.toThrow();
    expect(build).not.toHaveBeenCalled();
  });
});

describe("HTTP caching integration", () => {
  it("shares a first GET's durable preview with POST and a different Origin", async () => {
    const input = options(false);
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      "<html><head><title>Stored headline</title></head></html>",
      { headers: { "content-type": "text/html" } },
    ));
    const first = await worker.fetch(new Request(
      `https://worker.example/preview?url=${encodeURIComponent(input.url)}&includeAssets=false`,
      { headers: { Origin: "https://crazywall.cc" } },
    ), env);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe(PERMANENT_CACHE_CONTROL);
    const original = await first.json<LinkPreview>();
    const second = await worker.fetch(new Request("https://worker.example/preview", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: "https://ogp-worker.crazywall.cc" },
      body: JSON.stringify(input),
    }), env);
    expect(await second.json()).toEqual(original);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(second.headers.get("access-control-allow-origin")).toBe("https://ogp-worker.crazywall.cc");
    expect(second.headers.get("vary")).toBe("Origin");
  });

  it("does not cache HTTP errors", async () => {
    const response = await worker.fetch(new Request("https://worker.example/preview?url=http://localhost"), env);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
