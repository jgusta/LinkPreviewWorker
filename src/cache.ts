import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { normalizePublicUrl } from "./network";
import type { LinkPreview, PreviewOptions } from "./types";

export class PreviewCache {
  private db: DatabaseSync;
  private pending = new Map<string, Promise<LinkPreview>>();
  constructor(path: string, private ttl = 86400, private maxEntries = 10000) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS previews (key TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS previews_expiry ON previews(expires_at);`);
  }
  async get(options: PreviewOptions, build: () => Promise<LinkPreview>): Promise<LinkPreview> {
    const key = JSON.stringify([normalizePublicUrl(options.url).href, options.includeAssets]);
    const now = Date.now();
    const row = this.db.prepare("SELECT body FROM previews WHERE key=? AND expires_at>?").get(key, now);
    if (row) return { ...JSON.parse(String(row.body)), requestedUrl: options.url };
    let work = this.pending.get(key);
    if (!work) {
      work = (async () => {
        const preview = await build();
        const fetched = Date.now();
        const ttl = preview.warnings.length ? Math.min(this.ttl, 300) : this.ttl;
        this.db.prepare("INSERT OR REPLACE INTO previews VALUES(?,?,?,?)")
          .run(key, JSON.stringify(preview), fetched, fetched + ttl * 1000);
        this.db.prepare("DELETE FROM previews WHERE key IN (SELECT key FROM previews ORDER BY fetched_at DESC LIMIT -1 OFFSET ?)")
          .run(this.maxEntries);
        return preview;
      })();
      this.pending.set(key, work);
      void work.finally(() => this.pending.delete(key)).catch(() => {});
    }
    return { ...await work, requestedUrl: options.url };
  }
  close() { this.db.close(); }
}
