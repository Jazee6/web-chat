export const getImageRevalidationIndexes = (
  files: readonly { key?: string }[],
): number[] => files.map((_, index) => index);

export const canSubmitImageBatch = (
  files: readonly { key?: string }[],
  failedIndexes: ReadonlySet<number>,
): boolean =>
  failedIndexes.size === 0 && files.every(({ key }) => key !== undefined);
