// DOM rects use viewport pixels; CSS positions and canvas layouts use unzoomed pixels.
export function getKisaraScale() {
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function getKisaraLocalRect(element: Element) {
  const rect = element.getBoundingClientRect();
  const scale = getKisaraScale();
  return {
    left: rect.left / scale, top: rect.top / scale,
    right: rect.right / scale, bottom: rect.bottom / scale,
    width: rect.width / scale, height: rect.height / scale,
  };
}
