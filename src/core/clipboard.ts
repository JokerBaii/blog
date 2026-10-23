export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* Use the local HTTP fallback. */ }
  }
  const previous = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.style.cssText = "position:fixed;left:-9999px;top:0;";
  document.body.append(field);
  field.select();
  try {
    if (!document.execCommand("copy")) throw new Error("复制失败，请手动复制。");
  } finally {
    field.remove();
    previous?.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}
