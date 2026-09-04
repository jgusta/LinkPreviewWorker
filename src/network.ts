import { HttpError } from "./errors";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
];
const BLOCKED_HOSTS = new Set([
  "localhost",
  "local",
  "internal",
  "home.arpa",
  "metadata.google.internal",
]);

export interface FetchedResponse {
  response: Response;
  url: string;
}

export function normalizePublicUrl(rawUrl: string, baseUrl?: string): URL {
  let url: URL;

  try {
    let input = rawUrl.trim();
    if (!baseUrl) {
      const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(input);
      const isBareHostWithPort = /^[^:/?#]+\.[^:/?#]+:\d+(?:[/?#]|$)/.test(input);
      if (input.startsWith("//")) input = `https:${input}`;
      else if (input && (!hasScheme || isBareHostWithPort)) input = `https://${input}`;
    }
    url = baseUrl ? new URL(input, baseUrl) : new URL(input);
  } catch {
    throw new HttpError(400, "invalid_url", "The URL is not valid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "invalid_url", "Only HTTP and HTTPS URLs are supported.");
  }

  if (url.username || url.password) {
    throw new HttpError(400, "unsafe_url", "URLs containing credentials are not allowed.");
  }

  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new HttpError(400, "unsafe_url", "Only ports 80 and 443 are allowed.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const unbracketedHostname = hostname.replace(/^\[|\]$/g, "");
  const isIpLiteral = /^\d+(?:\.\d+){3}$/.test(unbracketedHostname) || unbracketedHostname.includes(":");
  const isBlockedName =
    BLOCKED_HOSTS.has(hostname) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));

  if (!hostname || isIpLiteral || isBlockedName) {
    throw new HttpError(400, "unsafe_url", "Local, private, and IP-literal hosts are not allowed.");
  }

  url.hash = "";
  return url;
}

export async function fetchWithValidatedRedirects(
  initialUrl: URL,
  init: RequestInit,
  timeoutMs: number,
  maxRedirects = 5,
): Promise<FetchedResponse> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    let response: Response;

    try {
      response = await fetch(currentUrl, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new HttpError(504, "upstream_timeout", "The remote server took too long to respond.");
      }

      throw new HttpError(502, "upstream_fetch_failed", "The remote server could not be reached.");
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, url: currentUrl.href };
    }

    const location = response.headers.get("location");
    await response.body?.cancel();

    if (!location) {
      throw new HttpError(502, "invalid_redirect", "The remote server returned an invalid redirect.");
    }

    if (redirectCount === maxRedirects) {
      throw new HttpError(502, "too_many_redirects", "The remote server redirected too many times.");
    }

    currentUrl = normalizePublicUrl(location, currentUrl.href);
  }

  throw new HttpError(502, "too_many_redirects", "The remote server redirected too many times.");
}

export async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new HttpError(502, "response_too_large", "The remote response is too large.");
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new HttpError(502, "response_too_large", "The remote response is too large.");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readResponsePrefix(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) {
    return { bytes: new Uint8Array(), truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  while (totalBytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const remainingBytes = maxBytes - totalBytes;
    if (value.byteLength > remainingBytes) {
      chunks.push(value.slice(0, remainingBytes));
      totalBytes += remainingBytes;
      truncated = true;
      await reader.cancel();
      break;
    }

    chunks.push(value);
    totalBytes += value.byteLength;
  }

  if (!truncated && totalBytes === maxBytes) {
    const { done } = await reader.read();
    truncated = !done;
    if (truncated) {
      await reader.cancel();
    }
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { bytes: result, truncated };
}

export function limitReadableStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let totalBytes = 0;

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          controller.error(new Error("The remote asset is too large."));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

export function parsePositiveInteger(value: string, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, maximum);
}
