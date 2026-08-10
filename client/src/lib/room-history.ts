import type {
  ChatMessage,
  HistoryChatMessage,
  RoomHistoryCursor,
} from "web-chat-share";

export type HistoryCursor = RoomHistoryCursor;

export type SearchReadiness = "ready" | "preparing" | "unavailable";

export type SearchRequest =
  | { action: "status" }
  | { action: "retry" }
  | {
      action: "search";
      query: string;
      snapshot?: HistoryCursor;
      cursor?: HistoryCursor;
    };

export type SearchPage = {
  readiness: SearchReadiness;
  results: ChatMessage[];
  snapshot?: HistoryCursor;
  nextCursor?: HistoryCursor;
  hasMore: boolean;
};

export type ContextPage = {
  messages: HistoryChatMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};

export class RoomHistoryRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Room history request failed with status ${status}`);
    this.name = "RoomHistoryRequestError";
    this.status = status;
  }
}

const apiBase = () => import.meta.env.VITE_API_URL.replace(/\/$/, "");

const roomEndpoint = (roomId: string, resource: "search" | "context") =>
  `${apiBase()}/room/${encodeURIComponent(roomId)}/${resource}`;

const postRoomHistory = async (
  roomId: string,
  resource: "search" | "context",
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> => {
  const response = await fetch(roomEndpoint(roomId, resource), {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  });

  if (response.status === 401) {
    window.location.href = "/login";
  }

  if (!response.ok) {
    throw new RoomHistoryRequestError(response.status);
  }

  return (await response.json()) as unknown;
};

export const requestSearch = (
  roomId: string,
  body: SearchRequest,
  signal?: AbortSignal,
) => postRoomHistory(roomId, "search", body, signal);

export const requestContext = (
  roomId: string,
  body: unknown,
  signal?: AbortSignal,
) => postRoomHistory(roomId, "context", body, signal);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isHistoryCursor = (value: unknown): value is HistoryCursor =>
  isRecord(value) &&
  typeof value.createdAt === "string" &&
  typeof value.id === "string";

const isChatMessage = (value: unknown): value is ChatMessage => {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.authorType === "user" ||
      value.authorType === "ai" ||
      value.authorType === "system") &&
    (value.type === "text" || value.type === "image") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string"
  );
};

const isHistoryChatMessage = (value: unknown): value is HistoryChatMessage =>
  isChatMessage(value);

export const getReadiness = (value: unknown): SearchReadiness => {
  if (isRecord(value)) {
    if (
      value.readiness === "ready" ||
      value.readiness === "preparing" ||
      value.readiness === "unavailable"
    ) {
      return value.readiness;
    }
  }
  return "unavailable";
};

export const parseSearchPage = (value: unknown): SearchPage => {
  const record = isRecord(value) ? value : {};
  const rawResults = record.results ?? record.messages;
  const results = Array.isArray(rawResults)
    ? rawResults.filter(isChatMessage)
    : [];

  return {
    readiness: getReadiness(value),
    results,
    snapshot: isHistoryCursor(record.snapshot) ? record.snapshot : undefined,
    nextCursor: isHistoryCursor(record.nextCursor)
      ? record.nextCursor
      : undefined,
    hasMore:
      typeof record.hasMore === "boolean"
        ? record.hasMore
        : results.length === 25,
  };
};

export const parseContextPage = (value: unknown): ContextPage => {
  const record = isRecord(value) ? value : {};
  const rawMessages = record.messages ?? record.history;
  const messages = Array.isArray(rawMessages)
    ? rawMessages.filter(isHistoryChatMessage)
    : [];

  return {
    messages,
    hasMoreBefore: record.hasMoreBefore === true,
    hasMoreAfter: record.hasMoreAfter === true,
  };
};

export const initialContextRequest = (targetId: string) => ({
  action: "initial" as const,
  targetId,
});

export const pagedContextRequest = (
  direction: "before" | "after",
  targetId: string,
  cursor: HistoryCursor,
) => ({ action: direction, targetId, cursor });

export type SearchQueryValidation = "empty" | "short" | "too-long" | "valid";

export const validateSearchQuery = (query: string) => {
  const normalized = query.trim();
  const length = Array.from(normalized).length;
  let state: SearchQueryValidation = "valid";
  if (length === 0) state = "empty";
  else if (length < 3) state = "short";
  else if (length > 100) state = "too-long";
  return { normalized, length, state };
};

const foldAscii = (value: string) =>
  value >= "A" && value <= "Z" ? value.toLowerCase() : value;

const getMatchRanges = (content: string, query: string) => {
  const contentChars = Array.from(content);
  const queryChars = Array.from(query);
  const ranges: Array<[number, number]> = [];

  if (queryChars.length === 0 || queryChars.length > contentChars.length) {
    return { contentChars, queryChars, ranges };
  }

  for (
    let start = 0;
    start <= contentChars.length - queryChars.length;
    start++
  ) {
    const matches = queryChars.every(
      (character, offset) =>
        foldAscii(contentChars[start + offset]) === foldAscii(character),
    );
    if (!matches) continue;

    const end = start + queryChars.length;
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous[1]) {
      previous[1] = Math.max(previous[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  return { contentChars, queryChars, ranges };
};

export type SearchPreviewPart = {
  text: string;
  matched: boolean;
};

export type SearchPreview = {
  parts: SearchPreviewPart[];
  clippedBefore: boolean;
  clippedAfter: boolean;
};

export const getSearchPreview = (
  content: string,
  query: string,
  maxCodePoints = 160,
): SearchPreview => {
  const { contentChars, queryChars, ranges } = getMatchRanges(content, query);
  const windowLength = Math.min(maxCodePoints, contentChars.length);
  const firstMatch = ranges[0]?.[0] ?? 0;
  let start = Math.max(
    0,
    firstMatch - Math.floor(Math.max(0, windowLength - queryChars.length) / 2),
  );
  const end = Math.min(contentChars.length, start + windowLength);
  if (end - start < windowLength) {
    start = Math.max(0, end - windowLength);
  }

  const startOffset = contentChars
    .slice(0, start)
    .reduce((total, character) => total + character.length, 0);
  const endOffset = contentChars
    .slice(0, end)
    .reduce((total, character) => total + character.length, 0);
  const parts: SearchPreviewPart[] = [];
  let offset = start;

  ranges.forEach(([rangeStart, rangeEnd]) => {
    const visibleStart = Math.max(start, rangeStart);
    const visibleEnd = Math.min(end, rangeEnd);
    if (visibleStart >= visibleEnd) return;

    if (visibleStart > offset) {
      parts.push({
        text: contentChars.slice(offset, visibleStart).join(""),
        matched: false,
      });
    }
    parts.push({
      text: contentChars.slice(visibleStart, visibleEnd).join(""),
      matched: true,
    });
    offset = visibleEnd;
  });

  if (offset < end) {
    parts.push({
      text: contentChars.slice(offset, end).join(""),
      matched: false,
    });
  }
  if (parts.length === 0 && end > start) {
    parts.push({
      text: contentChars.slice(start, end).join(""),
      matched: false,
    });
  }

  return {
    parts,
    clippedBefore: startOffset > 0,
    clippedAfter: endOffset < content.length,
  };
};

export const getHistoryCursor = (
  message: Pick<ChatMessage, "createdAt" | "id">,
) => ({
  createdAt: message.createdAt,
  id: message.id,
});
