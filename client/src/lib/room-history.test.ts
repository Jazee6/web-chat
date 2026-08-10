import { describe, expect, test } from "bun:test";
import { getSearchPreview, validateSearchQuery } from "./room-history.ts";

describe("room history search", () => {
  test("validates trimmed Unicode code point lengths", () => {
    expect(validateSearchQuery("  中文搜  ")).toEqual({
      normalized: "中文搜",
      length: 3,
      state: "valid",
    });
    expect(validateSearchQuery("😀😀").state).toBe("short");
    expect(validateSearchQuery("😀😀😀").state).toBe("valid");
    expect(validateSearchQuery(" ").state).toBe("empty");
    expect(validateSearchQuery("a".repeat(101)).state).toBe("too-long");
  });

  test("highlights every ASCII-case-insensitive match in the excerpt", () => {
    const preview = getSearchPreview("before HELLO and hello after", "hello");
    expect(
      preview.parts.filter((part) => part.matched).map((part) => part.text),
    ).toEqual(["HELLO", "hello"]);
  });

  test("keeps non-ASCII case and internal spacing exact", () => {
    expect(
      getSearchPreview("Éclair and éclair", "écl")
        .parts.filter((part) => part.matched)
        .map((part) => part.text),
    ).toEqual(["écl"]);
    expect(
      getSearchPreview("foo  bar and foo bar", "foo  bar")
        .parts.filter((part) => part.matched)
        .map((part) => part.text),
    ).toEqual(["foo  bar"]);
  });

  test("centers a 160-code-point excerpt on the first match", () => {
    const content = `${"a".repeat(120)}needle${"b".repeat(120)}`;
    const preview = getSearchPreview(content, "needle");
    expect(preview.clippedBefore).toBe(true);
    expect(preview.clippedAfter).toBe(true);
    expect(
      preview.parts.reduce(
        (length, part) => length + Array.from(part.text).length,
        0,
      ),
    ).toBe(160);
    expect(
      preview.parts.some((part) => part.matched && part.text === "needle"),
    ).toBe(true);
  });
});
