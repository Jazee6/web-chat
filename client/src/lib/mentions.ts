export type MentionRange = {
  start: number;
  end: number;
};

export type MentionInsertion = {
  value: string;
  caret: number;
};

const wordCharacter = /[\p{L}\p{N}_]/u;

const hasBoundaryBefore = (content: string, index: number) =>
  index === 0 ||
  (content[index - 1] !== "@" && !wordCharacter.test(content[index - 1]));

const hasBoundaryAfter = (content: string, index: number) =>
  index === content.length || !wordCharacter.test(content[index]);

export const insertMention = (
  content: string,
  name: string,
  start = content.length,
  end = start,
): MentionInsertion => {
  const needsLeadingSpace =
    start > 0 &&
    (content[start - 1] === "@" || wordCharacter.test(content[start - 1]));
  const mention = `${needsLeadingSpace ? " " : ""}@${name} `;

  return {
    value: `${content.slice(0, start)}${mention}${content.slice(end)}`,
    caret: start + mention.length,
  };
};

export const findMentionRanges = (
  content: string,
  userNames: string[],
): MentionRange[] => {
  const names = [...new Set(userNames)]
    .filter((name) => name.length > 0 && name.toLocaleLowerCase() !== "ai")
    .sort((a, b) => b.length - a.length);
  const ranges: MentionRange[] = [];

  for (let start = content.indexOf("@"); start !== -1; ) {
    if (hasBoundaryBefore(content, start)) {
      const aiEnd = start + 3;
      if (
        content.slice(start + 1, aiEnd).toLocaleLowerCase() === "ai" &&
        hasBoundaryAfter(content, aiEnd)
      ) {
        ranges.push({ start, end: aiEnd });
        start = content.indexOf("@", aiEnd);
        continue;
      }

      const name = names.find(
        (candidate) =>
          content.startsWith(candidate, start + 1) &&
          hasBoundaryAfter(content, start + 1 + candidate.length),
      );
      if (name) {
        const end = start + 1 + name.length;
        ranges.push({ start, end });
        start = content.indexOf("@", end);
        continue;
      }
    }

    start = content.indexOf("@", start + 1);
  }

  return ranges;
};
