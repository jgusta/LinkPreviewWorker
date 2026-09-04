import { embedAsset } from "./assets";
import { getCachedPreview, PARTIAL_CACHE_CONTROL, PERMANENT_CACHE_CONTROL } from "./cache";
import { errorMessage, HttpError } from "./errors";
import { extractMetadata } from "./metadata";
import {
  fetchWithValidatedRedirects,
  normalizePublicUrl,
  parsePositiveInteger,
  readResponseBytes,
  readResponsePrefix,
} from "./network";
import type { EmbeddedAsset, LinkPreview, PreviewOptions } from "./types";

const USER_AGENT = "ogp-worker/0.1 (+https://workers.cloudflare.com/)";
const MAX_REQUEST_BODY_BYTES = 8 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const corsHeaders = getCorsHeaders(request, env.ALLOWED_ORIGINS);

    if (request.method === "OPTIONS") {
      if (request.headers.has("origin") && !corsHeaders.has("access-control-allow-origin")) {
        return jsonResponse({ error: { code: "origin_not_allowed", message: "Origin is not allowed." } }, 403);
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      if (url.pathname !== "/preview" || (request.method !== "GET" && request.method !== "POST")) {
        if (request.method === "GET" || request.method === "HEAD") {
          return env.ASSETS.fetch(request);
        }
        throw new HttpError(404, "not_found", "Route not found.");
      }

      const options = await parsePreviewOptions(request, url);
      const { preview, permanent } = await getCachedPreview(
        options, env.PREVIEW_CACHE, () => buildPreview(options, env),
      );
      return jsonResponse(preview, 200, withCacheHeaders(corsHeaders, permanent));
    } catch (error) {
      const httpError = error instanceof HttpError
        ? error
        : new HttpError(500, "internal_error", "An unexpected error occurred.");

      console.error(JSON.stringify({
        message: "preview request failed",
        requestId,
        code: httpError.code,
        error: errorMessage(error),
        path: new URL(request.url).pathname,
      }));

      return jsonResponse(
        { error: { code: httpError.code, message: httpError.message, requestId } },
        httpError.status,
        corsHeaders,
      );
    }
  },
} satisfies ExportedHandler<Env>;

async function buildPreview(options: PreviewOptions, env: Env): Promise<LinkPreview> {
  const pageUrl = normalizePublicUrl(options.url);
  const timeoutMs = parsePositiveInteger(env.FETCH_TIMEOUT_MS, 10_000, 30_000);
  const maxHtmlBytes = parsePositiveInteger(env.MAX_HTML_BYTES, 1024 * 1024, 2 * 1024 * 1024);
  const maxAssetBytes = parsePositiveInteger(env.MAX_ASSET_BYTES, 20 * 1024 * 1024, 20 * 1024 * 1024);

  const { response, url: finalUrl } = await fetchWithValidatedRedirects(
    pageUrl,
    {
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "accept-language": "en-US,en;q=0.8",
        "user-agent": USER_AGENT,
      },
    },
    timeoutMs,
  );

  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(502, "page_fetch_failed", `The remote page returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "text/html; charset=utf-8";
  const normalizedContentType = contentType.toLowerCase();
  if (!normalizedContentType.includes("text/html") && !normalizedContentType.includes("application/xhtml+xml")) {
    await response.body?.cancel();
    throw new HttpError(422, "not_html", "The URL did not return an HTML page.");
  }

  const { bytes: html, truncated: htmlTruncated } = await readResponsePrefix(response, maxHtmlBytes);
  const metadata = await extractMetadata(html, finalUrl, contentType);
  const warnings: string[] = htmlTruncated
    ? [`HTML parsing stopped after ${maxHtmlBytes} bytes.`]
    : [];
  let image: EmbeddedAsset | null = null;
  let favicon: EmbeddedAsset | null = null;

  if (options.includeAssets) {
    const settings = { timeoutMs, maxBytes: maxAssetBytes };
    const [imageResult, faviconResult] = await Promise.allSettled([
      metadata.imageUrl ? embedAsset(metadata.imageUrl, "image", env, settings) : Promise.resolve(null),
      embedAsset(metadata.faviconUrl, "favicon", env, settings),
    ]);

    if (imageResult.status === "fulfilled") {
      image = imageResult.value;
    } else {
      warnings.push(`Preview image omitted: ${errorMessage(imageResult.reason)}`);
    }

    if (faviconResult.status === "fulfilled") {
      favicon = faviconResult.value;
    } else {
      warnings.push(`Favicon omitted: ${errorMessage(faviconResult.reason)}`);
    }
  }

  return {
    requestedUrl: options.url,
    url: finalUrl,
    canonicalUrl: metadata.canonicalUrl,
    title: metadata.title,
    description: metadata.description,
    siteName: metadata.siteName,
    type: metadata.type,
    image,
    favicon,
    meta: metadata.meta,
    warnings,
  };
}

async function parsePreviewOptions(request: Request, requestUrl: URL): Promise<PreviewOptions> {
  if (request.method === "GET") {
    const url = requestUrl.searchParams.get("url")?.trim();
    if (!url) {
      throw new HttpError(400, "missing_url", "The url query parameter is required.");
    }

    const includeAssetsValue = requestUrl.searchParams.get("includeAssets")?.toLowerCase();
    return { url, includeAssets: includeAssetsValue !== "false" && includeAssetsValue !== "0" };
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "POST requests must use application/json.");
  }

  const body = await readResponseBytes(new Response(request.body), MAX_REQUEST_BODY_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new HttpError(400, "invalid_json", "The request body is not valid JSON.");
  }

  if (!isRecord(parsed) || typeof parsed.url !== "string" || !parsed.url.trim()) {
    throw new HttpError(400, "missing_url", "The JSON body must contain a url string.");
  }

  if (parsed.includeAssets !== undefined && typeof parsed.includeAssets !== "boolean") {
    throw new HttpError(400, "invalid_include_assets", "includeAssets must be a boolean.");
  }

  return {
    url: parsed.url.trim(),
    includeAssets: parsed.includeAssets ?? true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getCorsHeaders(request: Request, configuredOrigins: string): Headers {
  const headers = new Headers({
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  });
  const origin = request.headers.get("origin");

  if (configuredOrigins.trim() === "*") {
    headers.set("access-control-allow-origin", "*");
    return headers;
  }

  const allowedOrigins = configuredOrigins.split(",").map((value) => value.trim()).filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
}

function withCacheHeaders(headers: Headers, permanent: boolean): Headers {
  const result = new Headers(headers);
  result.set("cache-control", permanent ? PERMANENT_CACHE_CONTROL : PARTIAL_CACHE_CONTROL);
  return result;
}

function jsonResponse(body: unknown, status: number, headers = new Headers()): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  if (!responseHeaders.has("cache-control")) responseHeaders.set("cache-control", "no-store");
  return Response.json(body, { status, headers: responseHeaders });
}
