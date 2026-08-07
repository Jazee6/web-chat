export const isMessageSubmitKey = (
  event: {
    key: string;
    shiftKey: boolean;
    isComposing: boolean;
    keyCode: number;
  },
  compositionActive: boolean,
) =>
  event.key === "Enter" &&
  !event.shiftKey &&
  !compositionActive &&
  !event.isComposing &&
  event.keyCode !== 229;
