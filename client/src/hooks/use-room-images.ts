import { api, calculateSHA256, convertImageToWebP } from "@/lib/utils.ts";
import ky from "ky";
import { type Dispatch, type SetStateAction } from "react";
import { gm, type ReplyRef, type UIChatMessage } from "web-chat-share";

type UseRoomImagesParams = {
  userId: string;
  setChats: Dispatch<SetStateAction<UIChatMessage[]>>;
  sendMessage: (msg: string) => void;
  readyState: number;
  requestStickToBottom: () => void;
};

type UseRoomImagesReturn = {
  sendImages: (
    rawImages: File[],
    textMessage?: string,
    replyTo?: ReplyRef,
  ) => Promise<void>;
  // Sticker fast path: the image is already in storage (keyed by sha256), so
  // skip WebP conversion and re-upload entirely — just optimistically append
  // an image message carrying the key and fire the WS send. See ADR 0004.
  sendSticker: (key: string) => void;
};

export function useRoomImages({
  userId,
  setChats,
  sendMessage,
  readyState,
  requestStickToBottom,
}: UseRoomImagesParams): UseRoomImagesReturn {
  // A reply attaches to exactly one message: the text caption if present,
  // otherwise the image. Both the optimistic local entry and the wire send
  // carry it, so the sender sees the Quote immediately. See ADR 0003.
  const sendImages = async (
    rawImages: File[],
    textMessage?: string,
    replyTo?: ReplyRef,
  ) => {
    const messageId = crypto.randomUUID();
    const replyOnText = !!textMessage;

    requestStickToBottom();
    setChats((prev) => {
      const next = [
        ...prev,
        {
          id: messageId,
          authorType: "user" as const,
          userId,
          type: "image" as const,
          content: "",
          localFiles: rawImages.map((file) => ({
            file,
            isUploading: true,
          })),
          replyTo: replyOnText ? undefined : replyTo,
          createdAt: new Date().toISOString(),
        },
      ];
      if (textMessage) {
        next.push({
          id: crypto.randomUUID(),
          authorType: "user" as const,
          userId,
          type: "text" as const,
          content: textMessage,
          replyTo,
          createdAt: new Date().toISOString(),
        });
      }
      return next;
    });

    try {
      const settled = await Promise.allSettled(
        rawImages.map(convertImageToWebP),
      );
      const succeeded: { originalIndex: number; converted: File }[] = [];

      settled.forEach((result, i) => {
        if (result.status === "fulfilled") {
          succeeded.push({ originalIndex: i, converted: result.value });
        } else {
          setChats((prev) =>
            prev.map((c) =>
              c.id === messageId
                ? {
                    ...c,
                    localFiles: c.localFiles?.map((f, idx) =>
                      idx === i
                        ? { ...f, isUploading: false, uploadFailed: true }
                        : f,
                    ),
                  }
                : c,
            ),
          );
        }
      });

      if (succeeded.length === 0) return;

      const converted = succeeded.map((r) => r.converted);
      const sha256List = await Promise.all(converted.map(calculateSHA256));

      const presigned = await api
        .post<{ url: string | null; key: string }[]>("room/upload/presigned", {
          json: { sha256List },
        })
        .json();

      await Promise.all(
        presigned.map(async ({ url, key }, i) => {
          if (url) {
            await ky.put(url, { body: converted[i] });
          }
          // Stamp the storage key onto the localFile so the sender can
          // favorite/copy their own just-sent image — the optimistic message's
          // `content` stays empty (server doesn't echo to the sender). See ADR 0004.
          setChats((prev) =>
            prev.map((c) =>
              c.id === messageId
                ? {
                    ...c,
                    localFiles: c.localFiles?.map((f, idx) =>
                      idx === succeeded[i].originalIndex
                        ? { ...f, isUploading: false, key }
                        : f,
                    ),
                  }
                : c,
            ),
          );
        }),
      );

      if (readyState !== WebSocket.OPEN) {
        setChats((prev) =>
          prev.map((c) =>
            c.id === messageId ? { ...c, sendFailed: true } : c,
          ),
        );
        return;
      }

      sendMessage(
        gm({
          type: "send",
          data: {
            type: "image",
            content: JSON.stringify(sha256List),
            replyTo: replyOnText ? undefined : replyTo,
          },
        }),
      );

      if (textMessage) {
        sendMessage(
          gm({
            type: "send",
            data: {
              type: "text",
              content: textMessage,
              replyTo,
            },
          }),
        );
      }
    } catch {
      setChats((prev) =>
        prev.map((c) =>
          c.id === messageId
            ? {
                ...c,
                localFiles: c.localFiles?.map((f) =>
                  f.isUploading
                    ? { ...f, isUploading: false, uploadFailed: true }
                    : f,
                ),
              }
            : c,
        ),
      );
    }
  };

  // Sticker fast path. The bytes already exist in object storage under `key`,
  // so there is nothing to upload: append an optimistic image message and send
  // the wire message. If the socket isn't OPEN, mark the message send-failed
  // (the bytes exist but no peer will receive them) — mirroring sendImages.
  // See ADR 0004.
  const sendSticker = (key: string) => {
    const messageId = crypto.randomUUID();
    requestStickToBottom();
    setChats((prev) => [
      ...prev,
      {
        id: messageId,
        authorType: "user" as const,
        userId,
        type: "image" as const,
        content: JSON.stringify([key]),
        createdAt: new Date().toISOString(),
      },
    ]);

    if (readyState !== WebSocket.OPEN) {
      setChats((prev) =>
        prev.map((c) => (c.id === messageId ? { ...c, sendFailed: true } : c)),
      );
      return;
    }

    sendMessage(
      gm({
        type: "send",
        data: {
          type: "image",
          content: JSON.stringify([key]),
        },
      }),
    );
  };

  return { sendImages, sendSticker };
}
