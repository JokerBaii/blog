const coverFocus: Record<string, string> = {};

export function getCoverStyle(cover: string | null | undefined) {
  const focus = coverFocus[cover ?? ""];
  return focus ? `--cover-focus: ${focus};` : undefined;
}
