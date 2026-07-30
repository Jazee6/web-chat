import { api, calculateSHA256, convertImageToWebP } from "@/lib/utils.ts";
import ky from "ky";
import { type Dispatch, type SetStateAction } from "react";
import type {
  MessageSubmission,
  ReplyRef,
  UIChatMessage,
} from "web-chat-share";

type UseRoomImagesParams = {
  userId: string;
  setChats: Dispatch<SetStateAction<UIChatMessage[]>>;
  sendSubmission: (submission: MessageSubmission) => void;
  requestStickToBottom: () => void;
};

type UseRoomImagesReturn = {
  sendImages: (
    rawImages: File[],
    textMessage?: string,
    replyTo?: ReplyRef,
  ) => Promise<void>;
  // Sticker fast path: the image already exists under its storage key. See
  // ADR 0004; retries reuse this key through the Message Submission registry.
  sendSticker: (key: string) => void;
};

export function useRoomImages({
  userId,
  setChats,
  sendSubmission,
  requestStickToBottom,
}: UseRoomImagesParams): UseRoomImagesReturn {
  // A Reply attaches to exactly one message: the text caption if present,
  // otherwise the image. Image and caption are independent submissions.
  const sendImages = async (
    rawImages: File[],
    textMessage?: string,
    replyTo?: ReplyRef,
  ) => {
    const imageSubmissionId = crypto.randomUUID();
    const textSubmissionId = textMessage ? crypto.randomUUID() : undefined;
    const replyOnText = !!textMessage;

    requestStickToBottom();
    setChats((previous) => {
      const next: UIChatMessage[] = [
        ...previous,
        {
          id: imageSubmissionId,
          submissionId: imageSubmissionId,
          authorType: "user",
          userId,
          type: "image",
          content: "",
          localFiles: rawImages.map((file) => ({
            file,
            isUploading: true,
          })),
          replyTo: replyOnText ? undefined : replyTo,
          createdAt: new Date().toISOString(),
        },
      ];
      if (textMessage && textSubmissionId) {
        next.push({
          id: textSubmissionId,
          submissionId: textSubmissionId,
          sendState: "sending",
          authorType: "user",
          userId,
          type: "text",
          content: textMessage,
          replyTo,
          createdAt: new Date().toISOString(),
        });
      }
      return next;
    });

    // Preserve image-before-caption ordering when images succeed, while still
    // submitting the independent caption if every upload fails.
    const submitText = () => {
      if (textMessage && textSubmissionId) {
        sendSubmission({
          submissionId: textSubmissionId,
          type: "text",
          content: textMessage,
          replyTo,
        });
      }
    };

    const convertedResults = await Promise.allSettled(
      rawImages.map(convertImageToWebP),
    );
    const converted: {
      originalIndex: number;
      file: File;
    }[] = [];
    convertedResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        converted.push({ originalIndex: index, file: result.value });
      }
    });

    const hashResults = await Promise.allSettled(
      converted.map(async ({ originalIndex, file }) => ({
        originalIndex,
        file,
        key: await calculateSHA256(file),
      })),
    );
    const hashed = hashResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );

    const failedIndexes = new Set<number>();
    convertedResults.forEach((result, index) => {
      if (result.status === "rejected") failedIndexes.add(index);
    });
    hashResults.forEach((result, index) => {
      if (result.status === "rejected") {
        failedIndexes.add(converted[index].originalIndex);
      }
    });

    let presigned: { url: string | null; key: string }[];
    try {
      if (hashed.length === 0) throw new Error("No images ready to upload");
      presigned = await api
        .post<
          { url: string | null; key: string }[]
        >("room/upload/presigned", { json: { sha256List: hashed.map(({ key }) => key) } })
        .json();
    } catch {
      hashed.forEach(({ originalIndex }) => failedIndexes.add(originalIndex));
      setChats((previous) =>
        previous.map((chat) =>
          chat.id === imageSubmissionId
            ? {
                ...chat,
                localFiles: chat.localFiles?.map((localFile, index) =>
                  failedIndexes.has(index)
                    ? {
                        ...localFile,
                        isUploading: false,
                        uploadFailed: true,
                      }
                    : localFile,
                ),
              }
            : chat,
        ),
      );
      submitText();
      return;
    }

    const uploadResults = await Promise.allSettled(
      presigned.map(async ({ url, key }, index) => {
        if (url) await ky.put(url, { body: hashed[index].file });
        return { originalIndex: hashed[index].originalIndex, key };
      }),
    );
    const uploaded = uploadResults.flatMap((result, index) => {
      if (result.status === "fulfilled") return [result.value];
      failedIndexes.add(hashed[index].originalIndex);
      return [];
    });
    const uploadedByIndex = new Map(
      uploaded.map(({ originalIndex, key }) => [originalIndex, key]),
    );
    const storageKeys = uploaded.map(({ key }) => key);
    const content = JSON.stringify(storageKeys);

    setChats((previous) =>
      previous.map((chat) =>
        chat.id === imageSubmissionId
          ? {
              ...chat,
              content,
              localFiles: chat.localFiles?.map((localFile, index) => {
                const key = uploadedByIndex.get(index);
                return key
                  ? { ...localFile, isUploading: false, key }
                  : {
                      ...localFile,
                      isUploading: false,
                      uploadFailed: true,
                    };
              }),
            }
          : chat,
      ),
    );

    if (storageKeys.length > 0) {
      sendSubmission({
        submissionId: imageSubmissionId,
        type: "image",
        content,
        replyTo: replyOnText ? undefined : replyTo,
      });
    }
    submitText();
  };

  const sendSticker = (key: string) => {
    const submissionId = crypto.randomUUID();
    const content = JSON.stringify([key]);
    requestStickToBottom();
    setChats((previous) => [
      ...previous,
      {
        id: submissionId,
        submissionId,
        sendState: "sending",
        authorType: "user",
        userId,
        type: "image",
        content,
        createdAt: new Date().toISOString(),
      },
    ]);
    sendSubmission({ submissionId, type: "image", content });
  };

  return { sendImages, sendSticker };
}
