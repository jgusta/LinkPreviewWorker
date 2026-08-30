# ogp-worker

A Cloudflare Worker that extracts Open Graph/Twitter metadata from a public webpage and returns a compact preview image and favicon as data URLs.

Open the Worker URL in a browser to use the included test console. It submits URLs to the API and displays the rendered link card, normalized fields, assets, warnings, metadata, and raw response.

## API

```http
GET /preview?url=https%3A%2F%2Fexample.com
```

To return metadata without downloading or transforming assets:

```http
GET /preview?url=https%3A%2F%2Fexample.com&includeAssets=false
```

POST is also supported:

```http
POST /preview
Content-Type: application/json

{
  "url": "https://example.com",
  "includeAssets": true
}
```

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
    "url": "https://example.com/card.jpg",
    "data": "data:image/webp;base64,...",
    "contentType": "image/webp",
    "size": 42317
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

The main image is resized to at most 800 px wide and encoded as WebP at quality 72. Raster favicons are normalized to a 64×64 PNG; ICO files are retained as-is because Cloudflare Images does not accept ICO input.

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
