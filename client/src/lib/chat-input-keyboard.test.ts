import { describe, expect, test } from "bun:test";
import { isMessageSubmitKey } from "./chat-input-keyboard.ts";

const enter = {
  key: "Enter",
  shiftKey: false,
  isComposing: false,
  keyCode: 13,
};

describe("chat input keyboard", () => {
  test("submits on Enter outside a composition session", () => {
    expect(isMessageSubmitKey(enter, false)).toBe(true);
  });

  test("does not submit while explicit composition state is active", () => {
    expect(isMessageSubmitKey(enter, true)).toBe(false);
  });

  test("does not submit when the native event reports composition", () => {
    expect(isMessageSubmitKey({ ...enter, isComposing: true }, false)).toBe(
      false,
    );
  });

  test("uses IME key code 229 when Safari reports isComposing as false", () => {
    expect(isMessageSubmitKey({ ...enter, keyCode: 229 }, false)).toBe(false);
  });

  test("keeps Shift+Enter and non-Enter keys from submitting", () => {
    expect(isMessageSubmitKey({ ...enter, shiftKey: true }, false)).toBe(false);
    expect(isMessageSubmitKey({ ...enter, key: "a", keyCode: 65 }, false)).toBe(
      false,
    );
  });
});
