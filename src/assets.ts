import { Buffer } from "node:buffer";
import sharp from "sharp";
import { HttpError } from "./errors";
import {
  fetchWithValidatedRedirects,
  normalizePublicUrl,
  readResponseBytes,
} from "./network";
import type { EmbeddedAsset, FetchSettings } from "./types";

const USER_AGENT = "ogp-worker/0.1";
const MAX_FAVICON_OUTPUT_BYTES = 512 * 1024;

export async function embedFavicon(
  assetUrl: string,
  _env: Env,
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
    throw new HttpError(502, "asset_fetch_failed", "The favicon could not be fetched.");
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > settings.maxBytes) {
    await response.body.cancel();
    throw new HttpError(502, "asset_too_large", "The favicon is too large.");
  }

  const sourceContentType = normalizeContentType(response.headers.get("content-type"));
  const looksLikeIco = sourceContentType === "image/x-icon" ||
    sourceContentType === "image/vnd.microsoft.icon" ||
    new URL(url).pathname.toLowerCase().endsWith(".ico");

  if (sourceContentType && !sourceContentType.startsWith("image/") && sourceContentType !== "application/octet-stream") {
    await response.body.cancel();
    throw new HttpError(502, "invalid_asset_type", "The favicon URL did not return an image.");
  }

  if (looksLikeIco) {
    const bytes = await readResponseBytes(response, Math.min(settings.maxBytes, MAX_FAVICON_OUTPUT_BYTES));
    return toEmbeddedAsset(url, sourceContentType || "image/x-icon", bytes);
  }

  const input = await readResponseBytes(response, settings.maxBytes);
  const bytes = await sharp(input, { limitInputPixels: 16_777_216, animated: false })
    .resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  if (bytes.length > MAX_FAVICON_OUTPUT_BYTES) throw new HttpError(502, "asset_too_large", "Favicon output is too large.");
  return toEmbeddedAsset(url, "image/png", bytes);
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
