(() => {
  "use strict";

  const form = document.querySelector("#preview-form");
  const urlInput = document.querySelector("#url-input");
  const assetsInput = document.querySelector("#assets-input");
  const submitButton = form.querySelector("button[type='submit']");
  const notice = document.querySelector("#notice");
  const emptyState = document.querySelector("#empty-state");
  const results = document.querySelector("#results");
  const copyButton = document.querySelector("#copy-json");
  let activeController = null;
  let lastResult = null;

  for (const button of document.querySelectorAll("[data-example-url]")) {
    button.addEventListener("click", () => {
      urlInput.value = button.dataset.exampleUrl;
      urlInput.focus();
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    activeController?.abort();
    activeController = new AbortController();
    setBusy(true);
    showNotice("");

    const startedAt = performance.now();
    const endpoint = new URL("/preview", window.location.origin);
    endpoint.searchParams.set("url", urlInput.value.trim());
    endpoint.searchParams.set("includeAssets", String(assetsInput.checked));

    try {
      const response = await fetch(endpoint, {
        headers: { accept: "application/json" },
        signal: activeController.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message || `Request failed with HTTP ${response.status}`);
      }

      lastResult = body;
      renderResult(body, performance.now() - startedAt);
    } catch (error) {
      if (error.name !== "AbortError") {
        showNotice(error instanceof Error ? error.message : "The request failed.");
      }
    } finally {
      setBusy(false);
    }
  });

  copyButton.addEventListener("click", async () => {
    if (!lastResult) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
      const originalLabel = copyButton.textContent;
      copyButton.textContent = "Copied";
      window.setTimeout(() => { copyButton.textContent = originalLabel; }, 1400);
    } catch {
      showNotice("The browser could not copy the response to the clipboard.");
    }
  });

  function renderResult(data, durationMs) {
    emptyState.hidden = true;
    results.hidden = false;

    setText("#request-duration", `${Math.round(durationMs).toLocaleString()} ms`);
    setAllText("[data-preview-site]", data.siteName || hostnameFrom(data.url) || "Unknown site");
    setAllText("[data-preview-type]", data.type || "website");
    setAllText("[data-preview-title]", data.title || "Untitled page");
    setAllText("[data-preview-description]", data.description || "No description returned.");
    setText("#requested-url", data.requestedUrl || "—");
    setText("#final-url", data.url || "—");
    setText("#canonical-url", data.canonicalUrl || "—");
    setText("#image-info", data.image?.url ? `Loaded by browser · ${data.image.url}` : "Not returned");
    setText("#favicon-info", formatAsset(data.favicon));

    for (const previewUrl of document.querySelectorAll("[data-preview-url]")) {
      previewUrl.href = safeHttpUrl(data.url) || "#";
      if (previewUrl.classList.contains("edition-link")) {
        previewUrl.textContent = data.url || "";
      }
    }

    renderImages(data.image, data.title ? `Preview image for ${data.title}` : "Preview image");
    renderFavicons(data.favicon);
    renderWarnings(Array.isArray(data.warnings) ? data.warnings : []);
    renderMeta(data.meta && typeof data.meta === "object" ? data.meta : {});

    const displayJson = JSON.stringify(data, (key, value) => {
      if (key === "data" && typeof value === "string") {
        return `[data URL shortened — ${value.length.toLocaleString()} characters]`;
      }
      return value;
    }, 2);
    setText("#raw-json", displayJson);
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderImages(asset, alt) {
    const source = safeHttpUrl(asset?.url);
    const images = document.querySelectorAll("[data-preview-image]");
    const emptyStates = document.querySelectorAll("[data-preview-image-empty]");

    for (const image of images) {
      if (source) {
        image.src = source;
        image.alt = alt;
        image.hidden = false;
      } else {
        image.removeAttribute("src");
        image.alt = "";
        image.hidden = true;
      }
    }

    for (const empty of emptyStates) {
      empty.hidden = Boolean(source);
    }
  }

  function renderFavicons(asset) {
    const source = asset?.data?.startsWith("data:image/") ? asset.data : safeHttpUrl(asset?.url);
    for (const image of document.querySelectorAll("[data-preview-favicon]")) {
      if (source) {
        image.src = source;
        image.alt = "";
        image.hidden = false;
      } else {
        image.removeAttribute("src");
        image.alt = "";
        image.hidden = true;
      }
    }
  }

  function renderWarnings(warnings) {
    const list = document.querySelector("#warnings-list");
    const empty = document.querySelector("#warnings-empty");
    list.replaceChildren();
    empty.hidden = warnings.length > 0;
    for (const warning of warnings) {
      const item = document.createElement("li");
      item.textContent = String(warning);
      list.append(item);
    }
  }

  function renderMeta(meta) {
    const body = document.querySelector("#meta-body");
    const empty = document.querySelector("#meta-empty");
    const entries = Object.entries(meta);
    body.replaceChildren();
    setText("#meta-count", String(entries.length));
    empty.hidden = entries.length > 0;

    for (const [key, value] of entries) {
      const row = document.createElement("tr");
      const keyCell = document.createElement("td");
      const valueCell = document.createElement("td");
      keyCell.textContent = key;
      valueCell.textContent = String(value);
      row.append(keyCell, valueCell);
      body.append(row);
    }
  }

  function setBusy(isBusy) {
    submitButton.disabled = isBusy;
    submitButton.classList.toggle("is-loading", isBusy);
    submitButton.querySelector(".button-label").textContent = isBusy ? "Fetching…" : "Fetch preview";
    form.setAttribute("aria-busy", String(isBusy));
  }

  function showNotice(message) {
    notice.textContent = message;
    notice.hidden = !message;
  }

  function setText(selector, value) {
    document.querySelector(selector).textContent = value;
  }

  function setAllText(selector, value) {
    for (const element of document.querySelectorAll(selector)) {
      element.textContent = value;
    }
  }

  function formatAsset(asset) {
    if (!asset) return "Not returned";
    return `${asset.contentType || "image"} · ${formatBytes(asset.size)} · ${asset.url || "unknown source"}`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "unknown size";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  }

  function hostnameFrom(value) {
    try { return new URL(value).hostname; } catch { return ""; }
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }
})();
