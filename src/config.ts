import { serveStatic } from "./static";

export function createEnv(): Env {
  return {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? "https://crazywall.cc,https://ogp.crazywall.cc,https://ogp-worker.crazywall.cc,http://localhost",
    FETCH_TIMEOUT_MS: process.env.FETCH_TIMEOUT_MS ?? "10000",
    MAX_HTML_BYTES: process.env.MAX_HTML_BYTES ?? "1048576",
    MAX_ASSET_BYTES: process.env.MAX_ASSET_BYTES ?? "20971520",
    ASSETS: { fetch: serveStatic },
  };
}
