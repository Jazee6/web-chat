import { describe, expect, test } from "bun:test";
import { findMentionRanges, insertMention } from "./mentions.ts";

const mentionsIn = (content: string, userNames: string[]) =>
  findMentionRanges(content, userNames).map(({ start, end }) =>
    content.slice(start, end),
  );

describe("message mentions", () => {
  test("matches known full display names exactly", () => {
    expect(mentionsIn("hi @张 三 and @Ann", ["张 三", "Ann"])).toEqual([
      "@张 三",
      "@Ann",
    ]);
    expect(mentionsIn("hi @ann", ["Ann"])).toEqual([]);
  });

  test("prefers the longest known display name", () => {
    expect(mentionsIn("hi @Ann Lee", ["Ann", "Ann Lee"])).toEqual(["@Ann Lee"]);
  });

  test("matches AI without regard to case", () => {
    expect(mentionsIn("@AI @ai @Ai", [])).toEqual(["@AI", "@ai", "@Ai"]);
  });

  test("requires standalone mention boundaries", () => {
    expect(
      mentionsIn("mail foo@ai.com, skip @@AI and @AnnBot, keep (@Ann).", [
        "Ann",
      ]),
    ).toEqual(["@Ann"]);
  });

  test("reserves AI instead of treating it as a user display name", () => {
    expect(mentionsIn("@AI", ["AI", "ai"])).toEqual(["@AI"]);
  });
});

describe("mention insertion", () => {
  test("inserts at the cursor and places the caret after the mention", () => {
    expect(insertMention("hello world", "Ann", 6)).toEqual({
      value: "hello @Ann world",
      caret: 11,
    });
  });

  test("replaces a selection", () => {
    expect(insertMention("hello world", "张 三", 6, 11)).toEqual({
      value: "hello @张 三 ",
      caret: 11,
    });
  });

  test("adds a boundary when inserting after a word", () => {
    expect(insertMention("hello", "AI")).toEqual({
      value: "hello @AI ",
      caret: 10,
    });
  });
});
