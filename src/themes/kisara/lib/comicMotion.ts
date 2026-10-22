export function settleWithin(task: Promise<unknown>, timeout: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeout);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
    void task.then(finish, finish);
  });
}

export function createComicMotion(signal: AbortSignal, reducedMotion: boolean) {
  const animations = new Set<Animation>();
  const restore: Array<() => void> = [];
  let generation = 0;
  const cancel = () => {
    generation++;
    animations.forEach(animation => animation.cancel());
    animations.clear();
    restore.splice(0).forEach(reset => reset());
  };
  const finish = () => animations.forEach(animation => {
    try { animation.finish(); } catch { /* A cancelled animation is already settled. */ }
  });
  const animate = async (node: HTMLElement | null, frames: Keyframe[], duration: number, delay = 0, easing = "cubic-bezier(.23,1,.32,1)") => {
    if (!node || signal.aborted) return;
    const serial = generation;
    const properties = ["opacity", "transform", "clipPath"] as const;
    const original = Object.fromEntries(properties.map(key => [key, node.style[key]]));
    restore.push(() => { Object.assign(node.style, original); });
    const finalFrame = frames[frames.length - 1];
    const settle = () => properties.forEach(key => {
      if (finalFrame[key] !== undefined) node.style[key] = String(finalFrame[key]);
    });
    if (reducedMotion || document.hidden || !node.animate) { settle(); return; }
    const animation = node.animate(frames, { duration, delay, easing, fill: "both" });
    animations.add(animation);
    await settleWithin(animation.finished, duration + delay + 160, signal);
    if (signal.aborted || serial !== generation) return;
    settle();
    animation.cancel();
    animations.delete(animation);
  };
  signal.addEventListener("abort", cancel, { once: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) finish(); }, { signal });
  window.addEventListener("resize", finish, { signal });
  return {
    cancel, finish, animate,
    async play(scene: HTMLElement, reverse = false) {
      cancel();
      const serial = generation;
      const paper = scene.querySelector<HTMLElement>(".kisara-comic-paper");
      // Keep the page intact: the paper must not outlive its panels as an empty iris.
      const page = reverse ? [
        { opacity: 1, transform: "translate3d(0,0,0)" },
        { opacity: 0, transform: "translate3d(0,-24px,0)" },
      ] : [
        { opacity: 0, transform: "translate3d(0,18px,0)" },
        { opacity: 1, transform: "translate3d(0,0,0)" },
      ];
      const reveal = [
        { opacity: 0, transform: "translate3d(0,8px,0)" },
        { opacity: 1, transform: "translate3d(0,0,0) scale(1)" },
      ];
      const fade = [{ opacity: 0 }, { opacity: 1 }];
      const ordered = (frames: Keyframe[]) => reverse ? [...frames].reverse() : frames;
      const jobs = [
        animate(scene, page, reverse ? 280 : 320),
        animate(paper, [{ opacity: 1, clipPath: "none" }, { opacity: 1, clipPath: "none" }], reverse ? 280 : 320),
      ];
      const panels = [...scene.querySelectorAll<HTMLElement>(".kisara-comic-panel")];
      panels.forEach((panel, index) => {
        jobs.push(animate(panel, ordered(reveal), 220, reverse ? (panels.length - 1 - index) * 15 : index * 25));
      });
      scene.querySelectorAll<HTMLElement>("[data-comic-caption]").forEach((caption, index) => {
        jobs.push(animate(caption, ordered(fade), reverse ? 180 : 160, reverse ? 0 : 80 + Math.min(index, 6) * 15));
      });
      await Promise.all(jobs);
      if (!reverse && paper && serial === generation && !signal.aborted) paper.style.clipPath = "none";
    },
  };
}
