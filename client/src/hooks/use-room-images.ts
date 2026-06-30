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
                      idx === i ? { ...f, isUploading: false, uploadFailed: true } : f,
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
        presigned.map(async ({ url }, i) => {
          if (url) {
            await ky.put(url, { body: converted[i] });
          }
          setChats((prev) =>
            prev.map((c) =>
              c.id === messageId
                ? {
                    ...c,
                    localFiles: c.localFiles?.map((f, idx) =>
                      idx === succeeded[i].originalIndex
                        ? { ...f, isUploading: false }
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
                  f.isUploading ? { ...f, isUploading: false, uploadFailed: true } : f,
                ),
              }
            : c,
        ),
      );
    }
  };

  return { sendImages };
}
