export type GlyphBox = { left: number; right: number; top: number; bottom: number };
export type GlyphCounter = { x: number; y: number; radiusX: number; radiusY: number };

export function findGlyphCounter(pixels: Uint8ClampedArray, width: number, height: number): GlyphCounter | null {
  if (width < 3 || height < 3 || pixels.length !== width * height * 4) return null;
  const visited = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let best: Uint32Array | null = null;
  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || pixels[start * 4 + 3] >= 128) continue;
    let head = 0;
    let tail = 1;
    let exterior = false;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) exterior = true;
      for (const next of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]) {
        if (next < 0 || visited[next] || pixels[next * 4 + 3] >= 128) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (!exterior && tail >= 6 && tail > (best?.length ?? 0)) best = queue.slice(0, tail);
  }
  if (!best) return null;
  let sumX = 0;
  let sumY = 0;
  for (const index of best) { sumX += index % width; sumY += Math.floor(index / width); }
  const centerX = sumX / best.length;
  const centerY = sumY / best.length;
  let closest = best[0];
  let distance = Infinity;
  for (const index of best) {
    const candidate = (index % width - centerX) ** 2 + (Math.floor(index / width) - centerY) ** 2;
    if (candidate < distance) { distance = candidate; closest = index; }
  }
  const x = closest % width;
  const y = Math.floor(closest / width);
  const empty = (x: number, y: number) => pixels[(y * width + x) * 4 + 3] < 128;
  let left = x, right = x, top = y, bottom = y;
  while (left > 0 && empty(left - 1, y)) left--;
  while (right + 1 < width && empty(right + 1, y)) right++;
  while (top > 0 && empty(x, top - 1)) top--;
  while (bottom + 1 < height && empty(x, bottom + 1)) bottom++;
  return { x: x + 0.5, y: y + 0.5, radiusX: (right - left + 1) * 0.5, radiusY: (bottom - top + 1) * 0.5 };
}

export function measureTitleChainCounter(
  context: CanvasRenderingContext2D | null,
  font: { fontWeight: string; fontFamily: string },
  glyph: GlyphBox
): GlyphCounter | null {
  if (!context) return null;
  const size = 128;
  context.canvas.width = size;
  context.canvas.height = size;
  context.font = `${font.fontWeight} 96px ${font.fontFamily}`;
  context.textBaseline = "alphabetic";
  context.fillStyle = "#fff";
  const metrics = context.measureText("a");
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  if (!(metrics.width > 0) || !(ascent + descent > 0)) return null;
  context.fillText("a", 8, 104);
  try {
    const counter = findGlyphCounter(context.getImageData(0, 0, size, size).data, size, size);
    if (!counter) return null;
    const inkLeft = Number.isFinite(metrics.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : 0;
    const inkRight = Number.isFinite(metrics.actualBoundingBoxRight) ? metrics.actualBoundingBoxRight : metrics.width;
    const sx = (glyph.right - glyph.left) / Math.max(1, inkLeft + inkRight);
    const sy = (glyph.bottom - glyph.top) / (ascent + descent);
    return {
      x: glyph.left + (counter.x - 8 + inkLeft) * sx,
      y: glyph.top + (counter.y - (104 - ascent)) * sy,
      radiusX: counter.radiusX * sx,
      radiusY: counter.radiusY * sy
    };
  } catch { return null; }
}
