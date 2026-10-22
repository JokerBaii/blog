type StageLoader = () => Promise<{ initKisaraChibiStage: (root: HTMLElement) => void }>;

export function watchChibiStage(loadStage: StageLoader = () => import("./chibiStage")) {
  const root = document.querySelector<HTMLElement>("[data-kisara-chibi-stage]");
  if (!root || root.dataset.loaderBound) return;
  root.dataset.loaderBound = "true";
  const lifecycle = new AbortController();
  let loading = false;
  let loaded = false;
  let observer: IntersectionObserver | null = null;
  const load = async () => {
    if (loading || loaded || lifecycle.signal.aborted || document.hidden) return;
    loading = true;
    try {
      const module = await loadStage();
      if (!root.isConnected || lifecycle.signal.aborted) return;
      module.initKisaraChibiStage(root);
      loaded = true;
      observer?.disconnect();
    } catch (error) {
      // Leave the static cast visible; a later pointer/focus entry can retry.
      console.warn("Kisara stage interaction failed to load", error);
    } finally {
      loading = false;
    }
  };
  const nearViewport = () => {
    if (loaded || lifecycle.signal.aborted) return;
    const rect = root.getBoundingClientRect();
    if (rect.bottom >= -400 && rect.top <= window.innerHeight + 400) void load();
  };
  if (typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load();
    }, { rootMargin: "400px 0px" });
    observer.observe(root);
  } else {
    window.addEventListener("scroll", nearViewport, { passive: true, signal: lifecycle.signal });
    nearViewport();
  }
  root.addEventListener("pointerenter", load, { once: true, signal: lifecycle.signal });
  root.addEventListener("focusin", load, { signal: lifecycle.signal });
  root.addEventListener("pointerdown", load, { passive: true, signal: lifecycle.signal });
  document.addEventListener("visibilitychange", nearViewport, { signal: lifecycle.signal });
  const cleanup = () => {
    observer?.disconnect();
    lifecycle.abort();
    delete root.dataset.loaderBound;
  };
  document.addEventListener("astro:before-swap", cleanup, { once: true, signal: lifecycle.signal });
}

if (typeof document !== "undefined") {
  document.addEventListener("astro:page-load", () => watchChibiStage());
  watchChibiStage();
}
