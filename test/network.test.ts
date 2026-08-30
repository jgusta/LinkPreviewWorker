import { describe, expect, it } from "vitest";
import { HttpError } from "../src/errors";
import { normalizePublicUrl, readResponsePrefix } from "../src/network";

describe("normalizePublicUrl", () => {
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
