// Reveal a terminal still only after decoding; until then the video keeps its last frame.
export function bindVideoStill(video: HTMLVideoElement, image: HTMLImageElement | null, signal: AbortSignal) {
  if (!image || signal.aborted) return;
  let decoding = false;
  const warm = async () => {
    if (signal.aborted || decoding || image.hasAttribute("data-video-still-ready")) return;
    image.loading = "eager";
    decoding = true;
    try {
      await image.decode();
      if (!signal.aborted && image.naturalWidth > 0) image.setAttribute("data-video-still-ready", "");
    } catch {
      // A failed still must not replace the decoded video with its initial poster.
    } finally {
      decoding = false;
    }
  };
  for (const event of ["loadedmetadata", "playing", "ended"]) {
    video.addEventListener(event, warm, { signal });
  }
  image.addEventListener("load", warm, { signal });
  if (video.readyState >= 1 || image.complete) void warm();
}
