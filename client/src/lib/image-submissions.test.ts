import { describe, expect, test } from "bun:test";
import {
  canSubmitImageBatch,
  getImageRevalidationIndexes,
} from "./image-submissions.ts";

describe("image submission retry", () => {
  test("revalidates every local image, including previously uploaded images", () => {
    expect(
      getImageRevalidationIndexes([
        { key: "already-uploaded" },
        {},
        { key: "also-uploaded" },
      ]),
    ).toEqual([0, 1, 2]);
  });

  test("does not schedule uploads for an empty batch", () => {
    expect(getImageRevalidationIndexes([])).toEqual([]);
  });

  test("does not resubmit when revalidation fails for an existing key", () => {
    expect(
      canSubmitImageBatch([{ key: "previously-uploaded" }], new Set([0])),
    ).toBe(false);
  });

  test("submits only when every image has a key and revalidation succeeds", () => {
    expect(
      canSubmitImageBatch([{ key: "first" }, { key: "second" }], new Set()),
    ).toBe(true);
    expect(canSubmitImageBatch([{ key: "first" }, {}], new Set())).toBe(false);
  });
});
