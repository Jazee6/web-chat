import type { LinkPreview, LinkPreviewContentType } from "web-chat-share";

const TIMEOUT_MS = 5000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; WebChatLinkPreview/1.0; +https://chat.jaze.top)";

function classifyContentType(contentType: string): LinkPreviewContentType {
  const lower = contentType.toLowerCase();
  if (lower.startsWith("text/html")) return "html";
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("video/")) return "video";
  if (lower.startsWith("application/pdf")) return "pdf";
  return "unknown";
}

function extractFilename(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : u.hostname;
  } catch {
    return url;
  }
}

function resolveUrl(maybeRelative: string, base: string): string {
  try {
    return new URL(maybeRelative, base).href;
  } catch {
    return maybeRelative;
  }
}

async function getContentType(url: string): Promise<string> {
  // Try HEAD first; many CDNs return Content-Type cheaply this way.
  try {
    const headRes = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
      headers: { "user-agent": USER_AGENT },
    });
    if (headRes.ok) {
      return headRes.headers.get("content-type") ?? "";
    }
  } catch {
    // Fall through — some servers reject HEAD.
  }
  return "";
}

async function fetchHtmlPreview(url: string): Promise<LinkPreview> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
  });

  if (!res.ok || !res.body) {
    return {
      title: extractFilename(url),
      description: "",
      image: null,
      contentType: "html",
      url,
    };
  }

  // Use the response's final URL so relative og:image paths resolve correctly
  // through any redirects the server followed.
  const finalUrl = res.url || url;

  const og: Record<string, string> = {};
  let titleText = "";
  let inHead = true;

  const rewriter = new HTMLRewriter()
    .on("head", {
      element(el) {
        el.onEndTag(() => {
          // Once </head> ends we don't need to keep parsing, but HTMLRewriter
          // doesn't expose an early abort — we simply stop appending text.
          inHead = false;
        });
      },
    })
    .on("meta[property^='og:']", {
      element(el) {
        const prop = el.getAttribute("property");
        const content = el.getAttribute("content");
        if (prop && content && !og[prop]) {
          og[prop] = content;
        }
      },
    })
    .on("meta[name='description']", {
      element(el) {
        const content = el.getAttribute("content");
        if (content && !og["og:description"]) {
          og["og:description"] = content;
        }
      },
    })
    .on("title", {
      text({ text }) {
        if (inHead) titleText += text;
      },
    });

  // Drain the transformed stream so HTMLRewriter actually runs.
  await rewriter.transform(res).arrayBuffer();

  const ogImage = og["og:image"];
  return {
    title:
      (og["og:title"] || titleText).trim() ||
      extractFilename(url) ||
      new URL(finalUrl).hostname,
    description: (og["og:description"] || "").trim(),
    image: ogImage ? resolveUrl(ogImage, finalUrl) : null,
    contentType: "html",
    url,
  };
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  try {
    const contentType = await getContentType(url);
    const classified = classifyContentType(contentType);

    if (classified === "image") {
      return {
        title: extractFilename(url),
        description: "",
        image: url,
        contentType: "image",
        url,
      };
    }
    if (classified === "video") {
      return {
        title: extractFilename(url),
        description: "",
        image: null,
        contentType: "video",
        url,
      };
    }
    if (classified === "pdf") {
      return {
        title: extractFilename(url),
        description: "",
        image: null,
        contentType: "pdf",
        url,
      };
    }

    // "html" or unknown (HEAD failed) — try to parse as HTML.
    return await fetchHtmlPreview(url);
  } catch {
    return {
      title: extractFilename(url),
      description: "",
      image: null,
      contentType: "unknown",
      url,
    };
  }
}
