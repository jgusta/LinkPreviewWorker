import { Buffer } from "node:buffer";
import { HttpError } from "./errors";
import {
  fetchWithValidatedRedirects,
  limitReadableStream,
  normalizePublicUrl,
  readResponseBytes,
} from "./network";
import type { EmbeddedAsset, FetchSettings } from "./types";

const USER_AGENT = "ogp-worker/0.1 (+https://workers.cloudflare.com/)";
const MAX_PREVIEW_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_FAVICON_OUTPUT_BYTES = 512 * 1024;

export async function embedAsset(
  assetUrl: string,
  kind: "image" | "favicon",
  env: Env,
  settings: FetchSettings,
): Promise<EmbeddedAsset> {
  const { response, url } = await fetchWithValidatedRedirects(
    normalizePublicUrl(assetUrl),
    {
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8,*/*;q=0.1",
        "user-agent": USER_AGENT,
      },
    },
    settings.timeoutMs,
  );

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new HttpError(502, "asset_fetch_failed", `The ${kind} could not be fetched.`);
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > settings.maxBytes) {
    await response.body.cancel();
    throw new HttpError(502, "asset_too_large", `The ${kind} is too large.`);
  }

  const sourceContentType = normalizeContentType(response.headers.get("content-type"));
  const looksLikeIco = sourceContentType === "image/x-icon" ||
    sourceContentType === "image/vnd.microsoft.icon" ||
    new URL(url).pathname.toLowerCase().endsWith(".ico");

  if (sourceContentType && !sourceContentType.startsWith("image/") && sourceContentType !== "application/octet-stream") {
    await response.body.cancel();
    throw new HttpError(502, "invalid_asset_type", `The ${kind} URL did not return an image.`);
  }

  if (kind === "favicon" && looksLikeIco) {
    const bytes = await readResponseBytes(response, Math.min(settings.maxBytes, MAX_FAVICON_OUTPUT_BYTES));
    return toEmbeddedAsset(url, sourceContentType || "image/x-icon", bytes);
  }

  const input = limitReadableStream(response.body, settings.maxBytes);
  const result = kind === "image"
    ? await env.IMAGES.input(input)
        .transform({ width: 800, fit: "scale-down" })
        .output({ format: "image/webp", quality: 72, anim: false })
    : await env.IMAGES.input(input)
        .transform({ width: 64, height: 64, fit: "contain", background: "transparent" })
        .output({ format: "image/png", anim: false });

  const transformedResponse = result.response();
  const maxOutputBytes = kind === "image" ? MAX_PREVIEW_OUTPUT_BYTES : MAX_FAVICON_OUTPUT_BYTES;
  const bytes = await readResponseBytes(transformedResponse, maxOutputBytes);
  const outputContentType = normalizeContentType(transformedResponse.headers.get("content-type")) || result.contentType();

  return toEmbeddedAsset(url, outputContentType, bytes);
}

function toEmbeddedAsset(url: string, contentType: string, bytes: Uint8Array): EmbeddedAsset {
  return {
    url,
    contentType,
    size: bytes.byteLength,
    data: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
  };
}

function normalizeContentType(contentType: string | null): string {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
