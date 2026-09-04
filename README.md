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

## Permanent caching

Complete previews are stored in the private `ogp` R2 bucket with
no expiry. They include the image and favicon data URLs and survive deployments
and edge-cache eviction. Do not add an object-expiration lifecycle rule to this
bucket. R2 storage and operation charges may apply as the archive grows.

- Browser and Cloudflare edge responses use `public, max-age=31536000, immutable`
  (one year). Edge entries are shared across Worker versions. When an entry is
  evicted or expires, it is loaded from R2, not rebuilt from the source website.
- GET and POST share the same persistent snapshot, independent of requesting
  origin. CORS headers are generated per request; the edge still varies by Origin.
- Keys use the normalized target URL and `includeAssets` value. Fragments are
  ignored; query strings are preserved because they can change page content.
  `requestedUrl` always reflects the current caller's input.
- Full previews can also satisfy metadata-only requests. A metadata-only snapshot
  cannot satisfy a request for assets. These variants can represent different
  points in time if they were first fetched separately.
- Results with warnings (asset failures or truncated HTML) are cached for only
  five minutes, not archived. Errors and health responses use `no-store`.
- Concurrent first requests may duplicate upstream work, but a conditional R2
  write ensures only the first complete snapshot is retained for each key.

This is a **snapshot archive**, not an automatically refreshing preview service:
source changes will not appear once saved. There is no public refresh/delete
endpoint. To replace a snapshot, an administrator must remove its R2 object and
purge relevant Cloudflare cache entries. Browser copies may remain cached for
a year; use a new API request URL to bypass those copies after an admin purge.
Object keys are `previews/v1/<SHA-256>.json`, hashing UTF-8
`JSON.stringify([normalizedTargetUrl, includeAssets])` (see `src/cache.ts`).

## Local development

```bash
npm install
npm run dev
```

Then open [http://localhost:8787](http://localhost:8787) to use the test console.

The Images binding is a remote Cloudflare service. Sign in with Wrangler if local image transformation asks for Cloudflare access. Metadata-only requests (`includeAssets=false`) do not use the binding.

R2 is simulated locally by Wrangler; development does not populate the production archive.

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

The Worker uses the existing private `ogp` R2 bucket. For a new account, create
it once before deploying (skip this if the bucket already exists):

```bash
npx wrangler r2 bucket create ogp
```

Do not enable public bucket access or add an expiration lifecycle rule.

```bash
npm run deploy:check
npm run deploy
```

The production deployment serves both the test console and API at:

- Test console: `https://ogp-worker.crazywall.cc/`
- Preview API: `https://ogp-worker.crazywall.cc/preview`
- Health check: `https://ogp-worker.crazywall.cc/health`
