import {
  canSubmitImageBatch,
  getImageRevalidationIndexes,
} from "@/lib/image-submissions.ts";
import { api, calculateSHA256, convertImageToWebP } from "@/lib/utils.ts";
import ky from "ky";
import { type Dispatch, type SetStateAction, useRef } from "react";
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
  retryImageUpload: (submissionId: string, index: number) => Promise<void>;
  retryImageSubmission: (submissionId: string) => Promise<boolean>;
  confirmUploadedImages: (submissionId: string) => void;
  releaseUploadedImages: (submissionId: string) => void;
};

type ImageBatch = {
  files: { file: File; key?: string }[];
  replyTo?: ReplyRef;
};

export function useRoomImages({
  userId,
  setChats,
  sendSubmission,
  requestStickToBottom,
}: UseRoomImagesParams): UseRoomImagesReturn {
  const imageBatchesRef = useRef(new Map<string, ImageBatch>());

  const confirmUploadedImages = (submissionId: string) => {
    const batch = imageBatchesRef.current.get(submissionId);
    if (!batch || batch.files.some(({ key }) => !key)) return;
    const content = JSON.stringify(batch.files.map(({ key }) => key!));
    sendSubmission({
      submissionId,
      type: "image",
      content,
      replyTo: batch.replyTo,
    });
  };

  const uploadBatchFiles = async (
    submissionId: string,
    indexes: number[],
  ): Promise<boolean> => {
    const batch = imageBatchesRef.current.get(submissionId);
    if (!batch) return false;

    setChats((previous) =>
      previous.map((chat) =>
        chat.submissionId === submissionId
          ? {
              ...chat,
              localFiles: chat.localFiles?.map((localFile, index) =>
                indexes.includes(index)
                  ? {
                      ...localFile,
                      isUploading: true,
                      uploadFailed: false,
                    }
                  : localFile,
              ),
            }
          : chat,
      ),
    );

    const prepared = await Promise.all(
      indexes.map(async (index) => {
        try {
          const converted = await convertImageToWebP(batch.files[index].file);
          return {
            index,
            file: converted,
            key: await calculateSHA256(converted),
          };
        } catch {
          return { index, error: true as const };
        }
      }),
    );
    const ready = prepared.flatMap((result) =>
      "key" in result ? [result] : [],
    );
    const failedIndexes = new Set(
      prepared.flatMap((result) => ("error" in result ? [result.index] : [])),
    );

    if (ready.length > 0) {
      try {
        const presigned = await api
          .post<
            { url: string | null; key: string }[]
          >("room/upload/presigned", { json: { sha256List: ready.map(({ key }) => key) } })
          .json();
        const uploaded = await Promise.allSettled(
          presigned.map(async ({ url, key }, index) => {
            if (url) await ky.put(url, { body: ready[index].file });
            return { index: ready[index].index, key };
          }),
        );
        uploaded.forEach((result, index) => {
          if (result.status === "fulfilled") {
            batch.files[result.value.index].key = result.value.key;
          } else {
            failedIndexes.add(ready[index].index);
          }
        });
      } catch {
        ready.forEach(({ index }) => failedIndexes.add(index));
      }
    }

    const content = JSON.stringify(
      batch.files.flatMap(({ key }) => (key ? [key] : [])),
    );
    setChats((previous) =>
      previous.map((chat) =>
        chat.submissionId === submissionId
          ? {
              ...chat,
              content,
              localFiles: chat.localFiles?.map((localFile, index) =>
                indexes.includes(index)
                  ? {
                      ...localFile,
                      isUploading: false,
                      key: batch.files[index].key,
                      uploadFailed: failedIndexes.has(index),
                    }
                  : localFile,
              ),
            }
          : chat,
      ),
    );
    return canSubmitImageBatch(batch.files, failedIndexes);
  };

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

    imageBatchesRef.current.set(imageSubmissionId, {
      files: rawImages.map((file) => ({ file })),
      replyTo: replyOnText ? undefined : replyTo,
    });

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

    const allUploaded = await uploadBatchFiles(
      imageSubmissionId,
      rawImages.map((_, index) => index),
    );
    if (allUploaded) confirmUploadedImages(imageSubmissionId);
    submitText();
  };

  const retryImageUpload = async (submissionId: string, index: number) => {
    await uploadBatchFiles(submissionId, [index]);
  };

  const retryImageSubmission = async (submissionId: string) => {
    const batch = imageBatchesRef.current.get(submissionId);
    if (!batch) return false;

    const allUploaded = await uploadBatchFiles(
      submissionId,
      getImageRevalidationIndexes(batch.files),
    );
    if (allUploaded) confirmUploadedImages(submissionId);
    return true;
  };

  const releaseUploadedImages = (submissionId: string) => {
    imageBatchesRef.current.delete(submissionId);
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

  return {
    sendImages,
    sendSticker,
    retryImageUpload,
    retryImageSubmission,
    confirmUploadedImages,
    releaseUploadedImages,
  };
}
