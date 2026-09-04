import { normalizePublicUrl } from "./network";
import type { LinkPreview, PreviewOptions } from "./types";

export const PERMANENT_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const PARTIAL_CACHE_CONTROL = "public, max-age=300";

// Keep this namespace stable across deployments. Change only for incompatible schemas.
export async function previewCacheKey(options: PreviewOptions): Promise<string> {
  const identity = JSON.stringify([normalizePublicUrl(options.url).href, options.includeAssets]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `previews/v1/${hash}.json`;
}

export async function getCachedPreview(
  options: PreviewOptions,
  bucket: R2Bucket,
  build: () => Promise<LinkPreview>,
): Promise<{ preview: LinkPreview; permanent: boolean }> {
  // Validate before any storage lookup, including for cache hits.
  const key = await previewCacheKey(options);
  const saved = await bucket.get(key);
  if (saved) {
    const preview = await saved.json<LinkPreview>();
    return { preview: { ...preview, requestedUrl: options.url }, permanent: true };
  }

  // A full snapshot can satisfy metadata-only requests without another page fetch.
  if (!options.includeAssets) {
    const full = await bucket.get(await previewCacheKey({ ...options, includeAssets: true }));
    if (full) {
      const preview = await full.json<LinkPreview>();
      return {
        preview: { ...preview, requestedUrl: options.url, image: null, favicon: null },
        permanent: true,
      };
    }
  }

  const preview = await build();
  // Do not freeze temporary asset failures or truncated HTML into the archive.
  if (preview.warnings.length > 0) return { preview, permanent: false };

  // Await durable storage before advertising permanent caching. First complete
  // snapshot wins if concurrent cold requests produce different results.
  const stored = await bucket.put(key, JSON.stringify(preview), {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json", cacheControl: PERMANENT_CACHE_CONTROL },
  });
  if (!stored) {
    const winner = await bucket.get(key);
    if (!winner) throw new Error("The stored preview disappeared during a concurrent write.");
    return {
      preview: { ...await winner.json<LinkPreview>(), requestedUrl: options.url },
      permanent: true,
    };
  }
  return { preview, permanent: true };
}
