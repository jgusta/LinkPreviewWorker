# ogp-worker

A Cloudflare Worker that extracts Open Graph/Twitter metadata from a public webpage, returns the preview image URL, and embeds the favicon as a base64 data URL.

Open the Worker URL in a browser to use the included test console. It submits URLs to the API and displays the rendered link card, normalized fields, assets, warnings, metadata, and raw response.

## API

The demo and API accept bare links such as `example.com/article`;
HTTPS is assumed when the scheme is omitted. Explicit HTTP/HTTPS is preserved.

```http
GET /preview?url=https%3A%2F%2Fexample.com
```

To skip downloading and embedding the favicon (the preview image URL is still returned):

```http
GET /preview?url=https%3A%2F%2Fexample.com&includeAssets=false
```

HEAD returns the same status and headers without a response body:

```http
HEAD /preview?url=https%3A%2F%2Fexample.com
```

Only GET and HEAD are accepted; OPTIONS supports browser CORS preflight.
POST and other methods return 405 with `Allow: GET, HEAD, OPTIONS`.

Example response:

```json
{
  "requestedUrl": "https://example.com",
  "url": "https://example.com/",
  "canonicalUrl": "https://example.com/",
  "title": "Example Domain",
  "description": "Example description",
  "siteName": "Example",
  "type": "website",
  "image": {
    "url": "https://example.com/card.jpg"
  },
  "favicon": {
    "url": "https://example.com/favicon.ico",
    "data": "data:image/x-icon;base64,...",
    "contentType": "image/x-icon",
    "size": 15406
  },
  "meta": {
    "og:title": "Example Domain"
  },
  "warnings": []
}
```

The Worker never downloads or transforms the preview image. Clients use `image.url`
as the image source; `image` is null when no valid image URL is found. The demo
loads it only after a submitted preview returns, never on page load. Remote images
may fail if the source blocks hotlinking or the browser blocks insecure content.
Raster favicons are normalized to a 64×64 PNG; ICO files are retained as-is because
Cloudflare Images does not accept ICO input. `includeAssets=false` skips favicon
embedding but still returns `image: { url }`.

## Response caching

Cloudflare Workers Cache is enabled in `wrangler.jsonc` with `cache.enabled`.
No R2 storage or separate dashboard cache rule is required.

- Successful previews use `public, max-age=300, s-maxage=86400`: five minutes in
  the browser and 24 hours at Cloudflare. The entire JSON response, including
  the embedded favicon and preview image URL, is cached. Cache hits skip Worker execution.
- On misses, expiry, or eviction, the Worker fetches the page and processes its
  favicon again. There is no permanent archive or background refresh. The client
  loads and caches the preview image separately according to the source server's headers.
- Results with warnings cache for only five minutes. Errors and health responses
  use `no-store`. The demo only fetches on submission, never on page load.
- GET and HEAD share Cloudflare cache entries. A cold HEAD request can still run
  the preview work, but returns no body.
- The API request URL (including query parameters) and Origin variant distinguish
  cached responses. Use consistent URL spelling and options for best reuse;
  bare and explicit HTTPS inputs may occupy separate edge-cache entries.
- Cross-version caching is disabled, so deployments start with a fresh edge cache
  instead of reusing the previous version's year-long responses.

The old `ogp` bucket is no longer bound or used. Existing objects are not deleted.
Previously cached browser responses can still persist under their old one-year
policy; clear the browser cache or use a new API request URL to bypass them.

## Local development

```bash
npm install
npm run dev
```

Then open [http://localhost:8787](http://localhost:8787) to use the test console.

The Images binding is a remote Cloudflare service. Sign in with Wrangler if local image transformation asks for Cloudflare access. Metadata-only requests (`includeAssets=false`) do not use the binding.

Run all checks:

```bash
npm run check
```

## Configuration

Runtime settings live in `wrangler.jsonc`:

- `ALLOWED_ORIGINS`: `*` or a comma-separated list of browser origins.
- `FETCH_TIMEOUT_MS`: timeout for each outbound request, capped at 30 seconds.
- `MAX_HTML_BYTES`: maximum HTML body size, capped at 2 MiB.
- `MAX_ASSET_BYTES`: maximum source image size, capped at the Images binding's 20 MB limit.

Before exposing this Worker publicly, set `ALLOWED_ORIGINS` to your website and add Cloudflare rate limiting. CORS is not authentication; if previews are private or billable, call this endpoint from your own backend or protect it with an authentication layer.

## Deploy

```bash
npm run deploy:check
npm run deploy
```

The production deployment serves both the test console and API at:

- Test console: `https://ogp-worker.crazywall.cc/`
- Preview API: `https://ogp-worker.crazywall.cc/preview`
- Health check: `https://ogp-worker.crazywall.cc/health`
