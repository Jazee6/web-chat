import { describe, expect, it } from "bun:test";
import { parseDeviceLabel } from "./device-label";

describe("parseDeviceLabel", () => {
  it("parses macOS Chrome", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(parseDeviceLabel(ua)).toBe("Chrome on macOS");
  });

  it("parses macOS Safari", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15";
    expect(parseDeviceLabel(ua)).toBe("Safari on macOS");
  });

  it("parses iOS Safari on iPhone", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
    expect(parseDeviceLabel(ua)).toBe("Safari on iOS");
  });

  it("parses iPadOS Safari", () => {
    const ua =
      "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
    expect(parseDeviceLabel(ua)).toBe("Safari on iPadOS");
  });

  it("parses Windows Edge", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    expect(parseDeviceLabel(ua)).toBe("Edge on Windows");
  });

  it("parses Linux Firefox", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0";
    expect(parseDeviceLabel(ua)).toBe("Firefox on Linux");
  });

  it("parses Android Chrome", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36";
    expect(parseDeviceLabel(ua)).toBe("Chrome on Android");
  });

  it("falls back conservatively on null/empty/unknown UA", () => {
    expect(parseDeviceLabel(null)).toBe("Unknown browser");
    expect(parseDeviceLabel("")).toBe("Unknown browser");
    expect(parseDeviceLabel("UnknownBot/1.0")).toBe(
      "Browser on unknown system",
    );
  });
});
