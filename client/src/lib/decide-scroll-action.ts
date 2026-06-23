export type ScrollAction =
  | { kind: "history-compensate"; diff: number }
  | { kind: "stick-to-bottom" }
  | { kind: "noop" };

export type ScrollInput = {
  scrollHeight: number;
  prevScrollHeight: number;
  isLoadingHistory: boolean;
  isStick: boolean;
};

export function decideScrollAction(input: ScrollInput): ScrollAction {
  if (input.isLoadingHistory) {
    return {
      kind: "history-compensate",
      diff: input.scrollHeight - input.prevScrollHeight,
    };
  }
  if (input.isStick) {
    return { kind: "stick-to-bottom" };
  }
  return { kind: "noop" };
}
