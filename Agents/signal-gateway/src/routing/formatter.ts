export function normalizeReply(text: string): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "I don't have a reply for that.";

  return trimmed
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .trim();
}

export function chunkText(
  text: string,
  maxChars: number,
  maxChunks: number,
): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0 && chunks.length < maxChunks) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      remaining = "";
      break;
    }

    let splitAt =
      remaining.lastIndexOf("\n\n", maxChars) >= 0
        ? remaining.lastIndexOf("\n\n", maxChars)
        : remaining.lastIndexOf("\n", maxChars) >= 0
          ? remaining.lastIndexOf("\n", maxChars)
          : remaining.lastIndexOf(" ", maxChars) >= 0
            ? remaining.lastIndexOf(" ", maxChars)
            : maxChars;

    if (splitAt <= 0) splitAt = maxChars;

    const chunk = remaining.slice(0, splitAt).trim();
    chunks.push(chunk);
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0 && chunks.length > 0) {
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n\n[truncated]`;
  }

  if (chunks.length > 1) {
    return chunks.map((chunk, i) => `(${i + 1}/${chunks.length}) ${chunk}`);
  }

  return chunks;
}
