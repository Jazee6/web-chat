import { describe, expect, test } from "bun:test";
import {
  createExaWebSearch,
  queryContainsParticipantName,
} from "./exa-web-search";

const executeSearch = async (
  webSearch: ReturnType<typeof createExaWebSearch>["webSearch"],
  query: string,
) => webSearch.execute!({ query }, {} as never);

describe("Web Search query privacy", () => {
  test("matches standalone participant names without matching longer words", () => {
    expect(
      queryContainsParticipantName("news about Alice Chen", ["Alice Chen"]),
    ).toBe(true);
    expect(
      queryContainsParticipantName("ALICE CHEN latest", ["Alice Chen"]),
    ).toBe(true);
    expect(queryContainsParticipantName("announcements", ["Ann"])).toBe(false);
    expect(queryContainsParticipantName("OpenAI 新闻", ["小明"])).toBe(false);
    expect(queryContainsParticipantName("小明 最近提到的项目", ["小明"])).toBe(
      true,
    );
  });

  test("rejects a participant name before making an external request", async () => {
    let requested = false;
    const { webSearch, state } = createExaWebSearch({
      apiKey: "test-key",
      participantNames: ["Alice"],
      fetcher: async () => {
        requested = true;
        return Response.json({ results: [] });
      },
    });

    await expect(
      executeSearch(webSearch, "Alice project news"),
    ).rejects.toThrow("participant name");
    expect(requested).toBe(false);
    expect(state).toEqual({ attempted: true, failed: true });
  });
});

describe("Exa Web Search tool", () => {
  test("uses the agreed result and freshness budget", async () => {
    let requestBody: unknown;
    const { webSearch, state } = createExaWebSearch({
      apiKey: "test-key",
      participantNames: [],
      fetcher: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json({
          results: [
            { title: "Result", url: "https://example.com", text: "Text" },
          ],
        });
      },
    });

    await expect(executeSearch(webSearch, "latest AI news")).resolves.toEqual({
      results: [{ title: "Result", url: "https://example.com", text: "Text" }],
    });
    expect(requestBody).toEqual({
      query: "latest AI news",
      type: "auto",
      numResults: 3,
      moderation: true,
      contents: {
        text: { maxCharacters: 1500 },
        maxAgeHours: 1,
      },
    });
    expect(state).toEqual({ attempted: true, failed: false });
  });

  test("allows only one attempt and treats empty results as failure", async () => {
    const { webSearch, state } = createExaWebSearch({
      apiKey: "test-key",
      participantNames: [],
      fetcher: async () => Response.json({ results: [] }),
    });

    await expect(executeSearch(webSearch, "first query")).rejects.toThrow(
      "no results",
    );
    await expect(executeSearch(webSearch, "second query")).rejects.toThrow(
      "already used",
    );
    expect(state).toEqual({ attempted: true, failed: true });
  });
});
