export function waitForVideoFrame(video: HTMLVideoElement, signal: AbortSignal, timeout = 15000) {
  return new Promise<boolean>(resolve => {
    let frame = 0;
    let paint = 0;
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (frame) video.cancelVideoFrameCallback?.(frame);
      if (paint) window.cancelAnimationFrame(paint);
      signal.removeEventListener("abort", abort);
      document.removeEventListener("visibilitychange", visibility);
      video.removeEventListener("error", abort);
      for (const name of ["playing", "loadeddata", "seeked"]) video.removeEventListener(name, fallback);
      resolve(ready);
    };
    const abort = () => finish(false);
    const visibility = () => { if (document.hidden) abort(); };
    const fallback = () => {
      if (paint || video.seeking || video.paused || video.readyState < 2) return;
      paint = window.requestAnimationFrame(() => {
        paint = window.requestAnimationFrame(() => {
          paint = 0;
          if (!video.seeking && !video.paused && video.readyState >= 2) finish(true);
        });
      });
    };
    const inspect: VideoFrameRequestCallback = (_, metadata) => {
      frame = 0;
      if (settled) return;
      // A seek may retain the previous presentation frame until decoding catches up.
      if (!video.seeking && metadata.mediaTime <= video.currentTime + .1) finish(true);
      else frame = video.requestVideoFrameCallback(inspect);
    };
    signal.addEventListener("abort", abort, { once: true });
    document.addEventListener("visibilitychange", visibility);
    video.addEventListener("error", abort);
    timer = setTimeout(abort, timeout);
    if (signal.aborted || document.hidden) { abort(); return; }
    if (video.requestVideoFrameCallback) frame = video.requestVideoFrameCallback(inspect);
    else {
      for (const name of ["playing", "loadeddata", "seeked"]) video.addEventListener(name, fallback);
      fallback();
    }
  });
}
