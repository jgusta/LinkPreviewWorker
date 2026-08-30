import { describe, expect, it } from "vitest";
import { extractMetadata } from "../src/metadata";

const encoder = new TextEncoder();

describe("extractMetadata", () => {
  it("uses Open Graph fields and resolves relative asset URLs", async () => {
    const html = encoder.encode(`
      <!doctype html>
      <html>
        <head>
          <base href="https://cdn.example.com/articles/">
          <title>Fallback title</title>
          <meta property="og:title" content="OG Title">
          <meta property="og:description" content="OG description">
          <meta property="og:site_name" content="Example Site">
          <meta property="og:type" content="article">
          <meta property="og:image" content="images/card.jpg">
          <link rel="canonical" href="../canonical">
          <link rel="icon" href="/favicon-32.png" sizes="32x32">
          <link rel="apple-touch-icon" href="/touch.png" sizes="180x180">
        </head>
      </html>
    `);

    const result = await extractMetadata(html, "https://example.com/posts/hello", "text/html; charset=utf-8");

    expect(result.title).toBe("OG Title");
    expect(result.description).toBe("OG description");
    expect(result.siteName).toBe("Example Site");
    expect(result.type).toBe("article");
    expect(result.imageUrl).toBe("https://cdn.example.com/articles/images/card.jpg");
    expect(result.canonicalUrl).toBe("https://cdn.example.com/canonical");
    expect(result.faviconUrl).toBe("https://cdn.example.com/touch.png");
  });

  it("falls back to Twitter metadata, title, and /favicon.ico", async () => {
    const html = encoder.encode(`
      <html><head>
        <title>  A fallback title  </title>
        <meta name="twitter:description" content="Twitter description">
        <meta name="twitter:image" content="/twitter.png">
      </head></html>
    `);

    const result = await extractMetadata(html, "https://example.com/path", "text/html");

    expect(result.title).toBe("A fallback title");
    expect(result.description).toBe("Twitter description");
    expect(result.imageUrl).toBe("https://example.com/twitter.png");
    expect(result.faviconUrl).toBe("https://example.com/favicon.ico");
  });
});
