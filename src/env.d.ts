interface Env {
  ALLOWED_ORIGINS: string;
  FETCH_TIMEOUT_MS: string;
  MAX_HTML_BYTES: string;
  MAX_ASSET_BYTES: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
  CACHE?: import("./cache").PreviewCache;
}
