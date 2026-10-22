import { bindHomeEventPortrait } from "./homeEventPortrait.ts";
import { waitForVideoFrame } from "./videoFrame.ts";
import { bindVideoStill } from "./videoStill.ts";

export function visibleSceneRatio(rect: Pick<DOMRect, "top" | "bottom" | "height">, viewport: number) {
  const height = Math.max(1, viewport);
  const overlap = Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0));
  return overlap / Math.min(Math.max(1, rect.height), height);
}

export function bindHomeEvent(root: HTMLElement) {
  const controller = new AbortController();
  const { signal } = controller;
  const video = root.querySelector<HTMLVideoElement>("[data-home-event-video]")!;
  const source = video.querySelector<HTMLSourceElement>("source[data-src]")!;
  bindVideoStill(video, root.querySelector<HTMLImageElement>(".kisara-home-board-still"), signal);
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const portrait = bindHomeEventPortrait(root);
  let visible = false;
  let suspended = document.hidden;
  let completed = false;
  let started = false;
  let pending = false;
  let generation = 0;
  let watchdog = 0;
  let retryTimer = 0;
  let retries = 0;
  let frameController: AbortController | null = null;
  let framePending: Promise<unknown> | null = null;
  const state = (value: string) => { root.dataset.state = value; };
  const hydrate = () => {
    root.querySelectorAll<HTMLImageElement>("img[loading]").forEach(image => { image.loading = "eager"; });
    if (motion.matches || source.hasAttribute("src") || signal.aborted) return;
    source.src = source.dataset.src!;
    video.preload = "auto";
    video.load();
  };
  const clearWatchdog = () => {
    window.clearTimeout(watchdog);
    watchdog = 0;
  };
  const pause = () => {
    generation += 1;
    frameController?.abort();
    frameController = null;
    pending = false;
    window.clearTimeout(retryTimer);
    retryTimer = 0;
    clearWatchdog();
    video.pause();
  };
  const showStill = (value: string, complete = false) => {
    completed = complete;
    pause();
    state(value);
    portrait.reveal();
  };
  const play = async (restart = false) => {
    if (signal.aborted || suspended || !visible || pending || motion.matches) return;
    if (!restart && (completed || video.ended)) { showStill("complete", true); return; }
    const attempt = ++generation;
    pending = true;
    hydrate();
    if (restart) {
      completed = false;
      if (video.error) video.load();
      try { video.currentTime = 0; } catch {}
      root.removeAttribute("data-frame-ready");
    }
    state("loading");
    clearWatchdog();
    watchdog = window.setTimeout(() => {
      if (signal.aborted || attempt !== generation || completed) return;
      showStill("ready");
    }, 20000);
    frameController?.abort();
    frameController = new AbortController();
    framePending = waitForVideoFrame(video, frameController.signal).then(ready => {
      if (signal.aborted || attempt !== generation || completed) return;
      if (ready) {
        root.setAttribute("data-frame-ready", "");
        state("playing");
        clearWatchdog();
      } else showStill("ready");
    });
    try {
      await video.play();
      // An older play promise must never pause a newer replay.
      if (signal.aborted || attempt !== generation) return;
      pending = false;
      started = true;
      if (suspended || !visible) pause();
    } catch {
      if (signal.aborted || attempt !== generation) return;
      showStill("ready");
      if (video.error) scheduleRetry();
    }
  };
  const recover = () => {
    if (signal.aborted || suspended || !visible || completed || pending || motion.matches) return;
    if (video.ended) { showStill("complete", true); return; }
    if (video.readyState >= 2 && video.paused && !video.error) void play(!started);
  };
  const scheduleRetry = () => {
    if (signal.aborted || completed || retries >= 2 || retryTimer || motion.matches
      || video.error?.code === 3 || video.error?.code === 4) return;
    const delay = 1000 * ++retries;
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      if (signal.aborted || suspended || !visible || completed) return;
      // Only an actual media error warrants restarting the request.
      if (video.error) video.load();
      void play(!started);
    }, delay);
  };
  const refresh = () => {
    if (signal.aborted) return;
    const next = !suspended && !document.hidden
      && visibleSceneRatio(root.getBoundingClientRect(), window.innerHeight) >= .35;
    root.toggleAttribute("data-scene-visible", next);
    portrait.setActive(next);
    if (next && motion.matches) {
      showStill("complete", true);
    }
    if (next === visible) return;
    visible = next;
    // The portrait scene is the foreground composition; do not wait for the
    // one-shot background video to finish before it enters.
    if (next) portrait.reveal();
    if (!next) pause();
    else if (!completed) void play(!started);
  };
  const reset = () => {
    pause();
    completed = false;
    started = false;
    retries = 0;
    visible = false;
    root.removeAttribute("data-scene-visible");
    root.removeAttribute("data-frame-ready");
    portrait.setActive(false);
    portrait.reset();
    try { video.currentTime = 0; } catch {}
    state("idle");
  };
  const suspend = () => {
    suspended = true;
    visible = false;
    root.removeAttribute("data-scene-visible");
    portrait.setActive(false);
    pause();
  };
  const resume = () => {
    suspended = document.hidden;
    refresh();
  };

  video.addEventListener("playing", () => {
    if (suspended || !visible || completed
      || (!pending && ["ready", "error"].includes(root.dataset.state ?? ""))) { pause(); return; }
  }, { signal });
  video.addEventListener("pause", () => {
    if (!completed && started) state("paused");
  }, { signal });
  video.addEventListener("ended", () => {
    showStill("complete", true);
  }, { signal });
  video.addEventListener("error", () => {
    showStill("error");
    if (visible) scheduleRetry();
  }, { signal });
  video.addEventListener("loadeddata", recover, { signal });
  video.addEventListener("canplay", recover, { signal });
  window.addEventListener("online", () => {
    if (visible && !completed) {
      if (video.error) scheduleRetry();
      else recover();
    }
  }, { signal });
  root.addEventListener("pointerdown", recover, { passive: true, signal });
  document.addEventListener("visibilitychange", () => document.hidden ? suspend() : resume(), { signal });
  window.addEventListener("pagehide", suspend, { signal });
  window.addEventListener("pageshow", resume, { signal });
  document.addEventListener("freeze", suspend, { signal });
  document.addEventListener("resume", resume, { signal });
  motion.addEventListener("change", () => {
    if (motion.matches) {
      if (visible) showStill("complete", true);
      else pause();
    }
    else if (visible && !completed) void play();
  }, { signal });

  const preloadObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
    if (document.hidden || !entries.some(entry => entry.isIntersecting)) return;
    if (!motion.matches) hydrate();
    preloadObserver?.disconnect();
  }, { rootMargin: `${Math.round(window.innerHeight * .9)}px 0px` }) : null;
  const visibilityObserver = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(refresh, { threshold: [0, .15, .35, .6, 1] }) : null;
  if (!visibilityObserver) window.addEventListener("scroll", refresh, { passive: true, signal });
  window.addEventListener("resize", refresh, { passive: true, signal });
  preloadObserver?.observe(root);
  visibilityObserver?.observe(root);
  refresh();
  return {
    reset,
    refresh,
    preload: hydrate,
    prepareCoveredEntry() {
      hydrate();
      refresh();
      // Releasing the visual cover is not permission to abandon the download.
      return new Promise<void>(resolve => {
        const finish = () => { window.clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
        const timer = window.setTimeout(finish, 1800);
        signal.addEventListener("abort", finish, { once: true });
        Promise.resolve(framePending).then(finish);
      });
    },
    destroy() {
      pause();
      portrait.destroy();
      controller.abort();
      preloadObserver?.disconnect();
      visibilityObserver?.disconnect();
    },
  };
}
