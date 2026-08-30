import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("HTTP API", () => {
  it("serves the test console as the home page", async () => {
    const response = await exports.default.fetch("https://worker.example/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(html).toContain("ogp-worker");
  });

  it("reports health", async () => {
    const response = await exports.default.fetch("https://worker.example/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("validates the preview URL", async () => {
    const response = await exports.default.fetch("https://worker.example/preview?url=http://localhost");
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("unsafe_url");
  });
});
