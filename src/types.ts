export interface PreviewOptions {
  url: string;
  includeAssets: boolean;
}

export interface EmbeddedAsset {
  url: string;
  data: string;
  contentType: string;
  size: number;
}

export interface LinkPreview {
  requestedUrl: string;
  url: string;
  canonicalUrl: string | null;
  title: string | null;
  description: string | null;
  siteName: string | null;
  type: string | null;
  image: EmbeddedAsset | null;
  favicon: EmbeddedAsset | null;
  meta: Record<string, string>;
  warnings: string[];
}

export interface FaviconCandidate {
  href: string;
  rel: string;
  type: string | null;
  sizes: string | null;
}

export interface ExtractedMetadata {
  canonicalUrl: string | null;
  title: string | null;
  description: string | null;
  siteName: string | null;
  type: string | null;
  imageUrl: string | null;
  faviconUrl: string;
  meta: Record<string, string>;
}

export interface FetchSettings {
  timeoutMs: number;
  maxBytes: number;
}
