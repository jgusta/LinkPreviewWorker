# ogp-worker

A self-hosted Node.js link preview service, ready for Docker and Coolify.
It preserves the former Worker's API, JSON fields, and demo page. Preview images
are returned as URLs; favicons are embedded as base64 data URLs. No Cloudflare
services, API tokens, or metered image processing are required.

## API

```http
GET /preview?url=example.com/article
HEAD /preview?url=example.com/article
GET /preview?url=example.com/article&includeAssets=false
GET /health
```

Bare links default to HTTPS; explicit HTTP/HTTPS is preserved. GET returns the
preview; HEAD returns the same status and headers without a body. A cold HEAD
request still fetches the preview. OPTIONS supports CORS. Other methods return
405 with `Allow: GET, HEAD, OPTIONS`.

The JSON structure remains:

```json
{
  "requestedUrl": "example.com/article",
  "url": "https://example.com/article",
  "canonicalUrl": null,
  "title": "Article title",
  "description": "Article description",
  "siteName": "Example",
  "type": "article",
  "image": { "url": "https://example.com/card.jpg" },
  "favicon": {
    "url": "https://example.com/favicon.ico",
    "data": "data:image/x-icon;base64,...",
    "contentType": "image/x-icon",
    "size": 1024
  },
  "meta": { "og:title": "Article title" },
  "warnings": []
}
```

Missing fields use null. The Worker never downloads preview images: clients use
`image.url` directly. Raster favicons are resized locally with Sharp to 64×64 PNG;
ICO files are retained. `includeAssets=false` skips favicon embedding but still
returns the image URL. The console at `/` makes no preview requests on page load.

## Coolify deployment

1. Push the repository to GitHub and create a Git-based application in Coolify.
2. Choose the **Dockerfile** build pack, base directory `/`, Dockerfile `/Dockerfile`.
3. Set **Ports Exposes** to `3000` and configure your desired HTTPS domain.
4. Add a **Volume Mount** with destination `/data` under Persistent Storage.
   The container defaults to UID/GID 1000; bind mounts must be writable by the
   configured user and group.
5. Set `ALLOWED_ORIGINS` to your client origins, for example
   `https://crazywall.cc,https://ogp.crazywall.cc`.
6. Deploy. The Docker image provides its own health check at `/health`. Enable
   Coolify automatic deployments for your branch if desired.

Disable the old Cloudflare deployment integration when switching this repository
to Coolify. Point the API hostname to the VPS and let Coolify provision TLS.
Keeping the same hostname and `/preview` path avoids changing client URLs.
This conversion does not change DNS or delete the old Worker or R2 bucket.

## Cache and configuration

### Container user and storage permissions

Set `APP_UID` and `APP_GID` to the numeric user/group IDs you want the container
to run as (both default to `1000`). In Coolify's Dockerfile mode, add these as
environment variables with **Available at Buildtime** enabled, then rebuild.
They are Docker build arguments; runtime-only environment variables do not
change the container's user.

For example, `APP_UID=1001` and `APP_GID=1001` produce an image running as
`1001:1001`. With Compose, set these variables in `.env` before running
`docker compose up --build -d`. Direct Docker builds can use:

```bash
docker build --build-arg APP_UID=1001 --build-arg APP_GID=1001 -t ogp-worker .
```

The image's `/data` directory is owned by these IDs. Existing volumes and bind
mounts keep their host ownership; give the chosen IDs write access on the VPS.
Changing the IDs requires rebuilding the image and updating existing storage
permissions as appropriate.

### Preview cache

SQLite stores the complete preview, embedded favicon, fetch time and expiry on
the persistent volume. Default freshness is one day; results with warnings expire
within five minutes. Expired entries refresh on the next request. Errors are not
stored. Concurrent requests for the same URL share the fetch work.

Normalized target URLs and `includeAssets` distinguish entries. Bare and HTTPS
forms share entries, fragments are ignored, and query strings are retained.
The current caller's `requestedUrl` and CORS headers remain accurate.

The cache survives restarts and deployments. The oldest entries are evicted when
capacity is reached. Expired rows may remain until replaced or evicted. Back up
the data volume if you want to preserve it. Run one replica using this local
SQLite volume; it is not shared between VPS servers.

Environment variable | Default | Meaning
--- | --- | ---
`PORT` | `3000` | HTTP port, listening on `0.0.0.0`
`ALLOWED_ORIGINS` | crazywall.cc and existing ogp origins, localhost | Comma-separated exact browser origins, or `*`
`CACHE_DB_PATH` | `./data/previews.sqlite` (`/data/previews.sqlite` in Docker) | SQLite file
`CACHE_TTL_SECONDS` | `86400` | Server cache freshness, capped at one year
`CACHE_MAX_ENTRIES` | `10000` | Stored previews, capped at one million
`FETCH_TIMEOUT_MS` | `10000` | Outbound request timeout, capped at 30 seconds
`MAX_HTML_BYTES` | `1048576` | Parsed HTML prefix, capped at 2 MiB
`MAX_ASSET_BYTES` | `20971520` | Favicon input limit, capped at 20 MiB

HTTP responses retain five-minute browser and one-day shared-cache headers.
Errors and health responses use `no-store`. Browser/shared cache freshness and
SQLite freshness are separate. No external cache is needed for SQLite reuse.

Outbound connections reject local names, IP literals, and DNS results containing
private, loopback, link-local or reserved addresses. Validation happens during
socket lookup and applies to redirects. CORS is not authentication; configure
VPS/proxy rate limits for public access.

## Local development

Requires Node.js 24 or newer.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. Development data lives in the Git-ignored `data/`
directory. Production locally: `npm run build && npm start`.

```bash
npm run check
docker compose up --build -d
```

Compose mounts `${DATA_VOL:-/data/vol/link-preview}` from the host at `/data`.
Set `DATA_VOL` to change the host directory. Coolify's Dockerfile mode instead
uses the persistent volume configured in its dashboard.
