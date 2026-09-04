import { embedFavicon } from "./assets";
import { errorMessage, HttpError } from "./errors";
import { extractMetadata } from "./metadata";
import {
  fetchWithValidatedRedirects,
  normalizePublicUrl,
  parsePositiveInteger,
  readResponsePrefix,
} from "./network";
import type { EmbeddedAsset, LinkPreview, PreviewOptions } from "./types";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

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

      if (request.method !== "GET" && request.method !== "HEAD") {
        const headers = new Headers(corsHeaders);
        headers.set("allow", "GET, HEAD, OPTIONS");
        return jsonResponse({ error: { code: "method_not_allowed", message: "Use GET or HEAD." } }, 405, headers);
      }

      if (url.pathname === "/health") {
        return headResponse(request, jsonResponse({ ok: true }, 200, corsHeaders));
      }

      if (url.pathname !== "/preview") {
        return env.ASSETS.fetch(request);
      }

      const options = parsePreviewOptions(url);
      const preview = await buildPreview(options, env);
      return headResponse(request, jsonResponse(preview, 200, withCacheHeaders(corsHeaders, preview.warnings.length > 0)));
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

      return headResponse(request, jsonResponse(
        { error: { code: httpError.code, message: httpError.message, requestId } },
        httpError.status,
        corsHeaders,
      ));
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
  const image = metadata.imageUrl ? { url: metadata.imageUrl } : null;
  let favicon: EmbeddedAsset | null = null;

  if (options.includeAssets) {
    const settings = { timeoutMs, maxBytes: maxAssetBytes };
    try {
      favicon = await embedFavicon(metadata.faviconUrl, env, settings);
    } catch (error) {
      warnings.push(`Favicon omitted: ${errorMessage(error)}`);
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

function parsePreviewOptions(requestUrl: URL): PreviewOptions {
  const url = requestUrl.searchParams.get("url")?.trim();
  if (!url) {
    throw new HttpError(400, "missing_url", "The url query parameter is required.");
  }

  const includeAssetsValue = requestUrl.searchParams.get("includeAssets")?.toLowerCase();
  return { url, includeAssets: includeAssetsValue !== "false" && includeAssetsValue !== "0" };
}

function getCorsHeaders(request: Request, configuredOrigins: string): Headers {
  const headers = new Headers({
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
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

function withCacheHeaders(headers: Headers, hasWarnings: boolean): Headers {
  const result = new Headers(headers);
  result.set("cache-control", hasWarnings
    ? "public, max-age=300, s-maxage=300"
    : "public, max-age=300, s-maxage=86400");
  return result;
}

async function headResponse(request: Request, response: Response): Promise<Response> {
  if (request.method !== "HEAD") return response;
  await response.body?.cancel();
  return new Response(null, { status: response.status, headers: response.headers });
}

function jsonResponse(body: unknown, status: number, headers = new Headers()): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  if (!responseHeaders.has("cache-control")) responseHeaders.set("cache-control", "no-store");
  return Response.json(body, { status, headers: responseHeaders });
}
