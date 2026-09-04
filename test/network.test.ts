import { describe, expect, it } from "vitest";
import { HttpError } from "../src/errors";
import { normalizePublicUrl, readResponsePrefix } from "../src/network";

describe("normalizePublicUrl", () => {
  it.each([
    ["example.com/article", "https://example.com/article"],
    [" www.example.com/story?q=one#section ", "https://www.example.com/story?q=one"],
    ["//example.com/article", "https://example.com/article"],
    ["example.com:443/article", "https://example.com/article"],
    ["http://example.com/article", "http://example.com/article"],
  ])("accepts %s as %s", (input, expected) => {
    expect(normalizePublicUrl(input).href).toBe(expected);
  });

  it("preserves relative resolution for metadata and redirects", () => {
    expect(normalizePublicUrl("../image.png", "http://example.com/news/article").href)
      .toBe("http://example.com/image.png");
  });

  it("accepts public HTTP URLs and strips fragments", () => {
    expect(normalizePublicUrl("https://example.com/article#section").href).toBe("https://example.com/article");
  });

  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://service.internal/",
    "ftp://example.com/file",
    "https://user:password@example.com/",
    "https://example.com:8080/",
    "example.com:8080/",
    "localhost",
    "127.0.0.1",
    "service.internal/path",
    "javascript:alert(1)",
    "mailto:someone@example.com",
    "",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => normalizePublicUrl(url)).toThrow(HttpError);
  });
});

describe("readResponsePrefix", () => {
  it("returns a bounded prefix and marks a truncated response", async () => {
    const response = new Response("0123456789");
    const result = await readResponsePrefix(response, 5);

    expect(new TextDecoder().decode(result.bytes)).toBe("01234");
    expect(result.truncated).toBe(true);
  });
});
