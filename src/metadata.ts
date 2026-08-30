import { normalizePublicUrl } from "./network";
import type { ExtractedMetadata, FaviconCandidate } from "./types";

const MAX_META_FIELDS = 100;
const MAX_META_VALUE_LENGTH = 4_000;

interface CollectorState {
  baseHref: string | null;
  canonicalHref: string | null;
  favicons: FaviconCandidate[];
  meta: Record<string, string>;
  title: string;
}

class MetaHandler {
  constructor(private readonly state: CollectorState) {}

  element(element: Element): void {
    const key = (element.getAttribute("property") ?? element.getAttribute("name"))
      ?.trim()
      .toLowerCase();
    const value = cleanText(element.getAttribute("content"));

    if (
      !key ||
      !value ||
      Object.keys(this.state.meta).length >= MAX_META_FIELDS ||
      (!key.startsWith("og:") && !key.startsWith("twitter:") && key !== "description")
    ) {
      return;
    }

    this.state.meta[key] ??= value;
  }
}

class LinkHandler {
  constructor(private readonly state: CollectorState) {}

  element(element: Element): void {
    const href = element.getAttribute("href")?.trim();
    const rel = element.getAttribute("rel")?.trim().toLowerCase();
    if (!href || !rel) {
      return;
    }

    const relTokens = new Set(rel.split(/\s+/));
    if (relTokens.has("canonical") && !this.state.canonicalHref) {
      this.state.canonicalHref = href;
    }

    if (
      this.state.favicons.length < 20 &&
      (relTokens.has("icon") || relTokens.has("apple-touch-icon"))
    ) {
      this.state.favicons.push({
        href,
        rel,
        type: element.getAttribute("type"),
        sizes: element.getAttribute("sizes"),
      });
    }
  }
}

class BaseHandler {
  constructor(private readonly state: CollectorState) {}

  element(element: Element): void {
    this.state.baseHref ??= element.getAttribute("href")?.trim() ?? null;
  }
}

class TitleHandler {
  constructor(private readonly state: CollectorState) {}

  text(text: Text): void {
    if (this.state.title.length < 1_000) {
      this.state.title += text.text;
    }
  }
}

export async function extractMetadata(
  html: Uint8Array,
  finalPageUrl: string,
  contentType: string,
): Promise<ExtractedMetadata> {
  const state: CollectorState = {
    baseHref: null,
    canonicalHref: null,
    favicons: [],
    meta: {},
    title: "",
  };

  const transformed = new HTMLRewriter()
    .on("meta", new MetaHandler(state))
    .on("link", new LinkHandler(state))
    .on("base", new BaseHandler(state))
    .on("title", new TitleHandler(state))
    .transform(new Response(html, { headers: { "content-type": contentType } }));

  await transformed.text();

  const documentBaseUrl = resolveOptionalUrl(state.baseHref, finalPageUrl) ?? finalPageUrl;
  const title = firstValue(state.meta["og:title"], state.meta["twitter:title"], cleanText(state.title));
  const description = firstValue(
    state.meta["og:description"],
    state.meta["twitter:description"],
    state.meta.description,
  );
  const canonicalUrl = resolveOptionalUrl(
    firstValue(state.meta["og:url"], state.canonicalHref),
    documentBaseUrl,
  );
  const imageUrl = resolveOptionalUrl(
    firstValue(
      state.meta["og:image:secure_url"],
      state.meta["og:image:url"],
      state.meta["og:image"],
      state.meta["twitter:image"],
      state.meta["twitter:image:src"],
    ),
    documentBaseUrl,
  );

  return {
    canonicalUrl,
    title,
    description,
    siteName: firstValue(state.meta["og:site_name"]),
    type: firstValue(state.meta["og:type"]),
    imageUrl,
    faviconUrl: selectFaviconUrl(state.favicons, documentBaseUrl),
    meta: state.meta,
  };
}

function selectFaviconUrl(candidates: FaviconCandidate[], baseUrl: string): string {
  const sortedCandidates = [...candidates].sort((left, right) => faviconScore(right) - faviconScore(left));

  for (const candidate of sortedCandidates) {
    const resolved = resolveOptionalUrl(candidate.href, baseUrl);
    if (resolved) {
      return resolved;
    }
  }

  return new URL("/favicon.ico", baseUrl).href;
}

function faviconScore(candidate: FaviconCandidate): number {
  let score = candidate.rel.includes("apple-touch-icon") ? 200 : 100;
  if (candidate.type === "image/svg+xml") {
    score += 75;
  }

  const dimensions = candidate.sizes?.match(/(\d+)x(\d+)/i);
  if (dimensions) {
    score += Math.min(Number.parseInt(dimensions[1] ?? "0", 10), 512) / 10;
  }
  return score;
}

function resolveOptionalUrl(value: string | null | undefined, baseUrl: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return normalizePublicUrl(value, baseUrl).href;
  } catch {
    return null;
  }
}

function firstValue(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) {
      return cleaned;
    }
  }
  return null;
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, MAX_META_VALUE_LENGTH);
  return cleaned || null;
}
