/**
 * Pure, lightweight parser for device and browser labeling without external dependencies.
 * Sourced from standard User-Agent strings with conservative fallbacks.
 */
export function parseDeviceLabel(userAgent?: string | null): string {
  if (!userAgent || typeof userAgent !== "string") {
    return "Unknown browser";
  }

  const ua = userAgent.trim();
  if (!ua) {
    return "Unknown browser";
  }

  let os = "unknown system";
  if (/iPad/i.test(ua) || (ua.includes("Macintosh") && /Touch/i.test(ua))) {
    os = "iPadOS";
  } else if (/iPhone|iPod/i.test(ua)) {
    os = "iOS";
  } else if (/Android/i.test(ua)) {
    os = "Android";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = "macOS";
  } else if (/Windows NT/i.test(ua)) {
    os = "Windows";
  } else if (/CrOS/i.test(ua)) {
    os = "ChromeOS";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  let browser = "Browser";
  if (/Edg([A-Z]|iOS)?\//i.test(ua)) {
    browser = "Edge";
  } else if (/OPR\/|Opera/i.test(ua)) {
    browser = "Opera";
  } else if (/Firefox|FxiOS/i.test(ua)) {
    browser = "Firefox";
  } else if (/Chrome|CriOS/i.test(ua)) {
    browser = "Chrome";
  } else if (/Safari/i.test(ua) && !/Chrome|CriOS|Android/i.test(ua)) {
    browser = "Safari";
  }

  return `${browser} on ${os}`;
}
