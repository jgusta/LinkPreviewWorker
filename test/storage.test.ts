import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PreviewCache } from "../src/cache";
import { isPublicAddress } from "../src/transport";
import sharp from "sharp";
import { embedFavicon } from "../src/assets";
import { createEnv } from "../src/config";
import type { LinkPreview } from "../src/types";

const preview: LinkPreview = {
  requestedUrl: "example.com", url: "https://example.com/", canonicalUrl: null,
  title: "Stored", description: null, siteName: null, type: null,
  image: { url: "https://example.com/image.jpg" }, favicon: null, meta: {}, warnings: [],
};
const options = { url: "example.com", includeAssets: true };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("persists previews across reopening and normalizes keys", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ogp-cache-"));
  let cache = new PreviewCache(join(dir, "cache.sqlite"));
  try {
    await cache.get(options, async () => preview);
    cache.close();
    cache = new PreviewCache(join(dir, "cache.sqlite"));
    const build = vi.fn(async () => preview);
    const result = await cache.get({ ...options, url: "https://example.com/#section" }, build);
    expect(result.title).toBe("Stored");
    expect(result.requestedUrl).toBe("https://example.com/#section");
    expect(build).not.toHaveBeenCalled();
  } finally { cache.close(); rmSync(dir, { recursive: true }); }
});

it("expires previews and separates favicon options", async () => {
  vi.useFakeTimers();
  const cache = new PreviewCache(":memory:", 60);
  const build = vi.fn(async () => preview);
  try {
    await cache.get(options, build);
    await cache.get(options, build);
    expect(build).toHaveBeenCalledTimes(1);
    await cache.get({ ...options, includeAssets: false }, build);
    vi.setSystemTime(Date.now() + 61000);
    await cache.get(options, build);
    expect(build).toHaveBeenCalledTimes(3);
  } finally { cache.close(); }
});

it("shares concurrent fetches and retries failures", async () => {
  const cache = new PreviewCache(":memory:");
  const build = vi.fn(async () => preview);
  try {
    await Promise.all([cache.get(options, build), cache.get(options, build)]);
    expect(build).toHaveBeenCalledTimes(1);
    const fail = vi.fn(async (): Promise<LinkPreview> => { throw new Error("upstream failed"); });
    const other = { ...options, url: "other.example.com" };
    await expect(cache.get(other, fail)).rejects.toThrow("upstream failed");
    await expect(cache.get(other, fail)).rejects.toThrow("upstream failed");
    expect(fail).toHaveBeenCalledTimes(2);
  } finally { cache.close(); }
});

it.each(["127.0.0.1", "10.0.0.1", "192.168.1.2", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "0.0.0.0", "224.0.0.1"])("blocks non-public address %s", (address) => {
  expect(isPublicAddress(address)).toBe(false);
});
it("accepts public IPv4 and IPv6", () => {
  expect(isPublicAddress("1.1.1.1")).toBe(true);
  expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
});
it("resizes raster favicons locally and embeds the result", async () => {
  const input = await sharp({ create: { width: 128, height: 80, channels: 4, background: "red" } }).png().toBuffer();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(input), { headers: { "content-type": "image/png" } }));
  const result = await embedFavicon("https://example.com/icon.png", createEnv(), { timeoutMs: 1000, maxBytes: 100000 });
  expect(result.data).toMatch(/^data:image\/png;base64,/);
  const metadata = await sharp(Buffer.from(result.data.split(",")[1]!, "base64")).metadata();
  expect([metadata.width, metadata.height]).toEqual([64, 64]);
});
