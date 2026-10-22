import { createComicMotion, settleWithin } from "./comicMotion.ts";

export type ChapterKind = "002" | "003" | "004" | "stage";

export function chapterPose(kind: ChapterKind, reverse: boolean, entering: boolean) {
  const direction = reverse ? -1 : 1;
  const side = entering ? direction : -direction;
  if (kind === "002") return `translate3d(0,${side * 18}px,0) scale(${entering === reverse ? 1.045 : .985})`;
  if (kind === "003") return `translate3d(${side * 48}px,0,0)`;
  if (kind === "004") return `translate3d(0,${side * 24}px,0)`;
  return `translate3d(0,${side * 32}px,0)`;
}

const kindOf = (node: HTMLElement) => (node.dataset.kisaraHomeStop ?? "stage") as ChapterKind;
const surfaceOf = (node: HTMLElement) => node.querySelector<HTMLElement>({
  "002": ".kisara-fridge-scene",
  "003": ".kisara-home-video-stage",
  "004": ".kisara-transmission-shelf",
  stage: ".kisara-chibi-stage",
}[kindOf(node)]);

export function createChapterTransition(signal: AbortSignal, reducedMotion: boolean) {
  const motion = createComicMotion(signal, reducedMotion);
  let active = false;
  let flight: HTMLElement | null = null;
  const clear = () => {
    motion.cancel();
    flight?.remove();
    flight = null;
  };
  signal.addEventListener("abort", clear, { once: true });
  document.addEventListener("keydown", event => {
    if (!active || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") motion.finish();
    if (["Tab", "Enter", " ", "Escape"].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true, signal });
  return {
    get active() { return active; },
    async run(from: HTMLElement, to: HTMLElement, reverse: boolean, commit: () => void | Promise<unknown>) {
      if (active || signal.aborted) return false;
      active = true;
      let committed = false;
      const relocate = async () => {
        if (committed || signal.aborted) return;
        committed = true;
        let failure: unknown;
        await settleWithin(Promise.resolve().then(commit).catch(error => { failure = error; }), 2000, signal);
        if (failure) throw failure;
      };
      try {
        if (reducedMotion || document.hidden) {
          await relocate();
          return true;
        }
        const overlay = document.createElement("div");
        overlay.className = "kisara-chapter-flight";
        overlay.dataset.chapter = kindOf(to);
        overlay.setAttribute("aria-hidden", "true");
        overlay.inert = true;
        overlay.style.opacity = "0";
        flight = overlay;
        document.body.append(overlay);
        await Promise.all([
          motion.animate(surfaceOf(from), [
            { opacity: 1, transform: "none" },
            { opacity: .35, transform: chapterPose(kindOf(from), reverse, false) },
          ], 200),
          motion.animate(overlay, [{ opacity: 0 }, { opacity: 1 }], 200),
        ]);
        if (signal.aborted) return false;
        // Section backgrounds and joining strips stay opaque and stationary.
        // Only their inner scene moves, so the fixed Gate can never show through.
        await relocate();
        if (signal.aborted) return false;
        const detailSelector = kindOf(to) === "004" ? ".kisara-transmission-shelf > a"
          : kindOf(to) === "stage" ? ".kisara-chibi-figure" : null;
        const details = detailSelector ? [...to.querySelectorAll<HTMLElement>(detailSelector)] : [];
        if (reverse) details.reverse();
        await Promise.all([
          motion.animate(overlay, [{ opacity: 1 }, { opacity: 0 }], 180),
          motion.animate(surfaceOf(to), [
            { opacity: .65, transform: chapterPose(kindOf(to), reverse, true) },
            { opacity: 1, transform: "none" },
          ], 280),
          ...details.map((node, index) => motion.animate(node, [
            { opacity: 0, transform: `translate3d(0,${reverse ? -24 : 24}px,0)` },
            { opacity: 1, transform: "none" },
          ], 220, index * 35)),
        ]);
        return !signal.aborted;
      } catch (error) {
        if (committed) throw error;
        await relocate();
        return !signal.aborted;
      } finally {
        clear();
        active = false;
      }
    },
  };
}
