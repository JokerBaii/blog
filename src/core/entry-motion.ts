import { springStep } from "@/themes/fuyukawa-kagari/lib/manga-runtime.mjs";

export function mountEntryMotion(gate: HTMLDialogElement, signal: AbortSignal) {
  const picture = gate.querySelector<HTMLElement>(".entry-picture");
  if (!picture || gate.dataset.entryTheme === "blank") return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const pointer = matchMedia("(hover: hover) and (pointer: fine) and (min-width: 721px)");
  let frame = 0, last = 0;
  let x = 0, y = 0, vx = 0, vy = 0, targetX = 0, targetY = 0;
  const allowed = () => !signal.aborted && gate.open && gate.dataset.ready === "true"
    && !document.hidden && !reduced.matches && pointer.matches;
  const reset = () => {
    cancelAnimationFrame(frame);
    frame = last = x = y = vx = vy = targetX = targetY = 0;
    picture.style.removeProperty("--entry-x");
    picture.style.removeProperty("--entry-y");
  };
  const tick = (now: number) => {
    frame = 0;
    if (!allowed()) { reset(); return; }
    const seconds = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    ({ position: x, velocity: vx } = springStep(x, vx, targetX, seconds));
    ({ position: y, velocity: vy } = springStep(y, vy, targetY, seconds));
    const moving = Math.abs(x - targetX) + Math.abs(y - targetY) + Math.abs(vx) + Math.abs(vy) > .002;
    if (!moving) { x = targetX; y = targetY; vx = vy = last = 0; }
    picture.style.setProperty("--entry-x", x.toFixed(4));
    picture.style.setProperty("--entry-y", y.toFixed(4));
    if (moving) frame = requestAnimationFrame(tick);
  };
  const wake = () => { if (allowed() && !frame) frame = requestAnimationFrame(tick); };
  gate.addEventListener("pointermove", event => {
    if (event.pointerType !== "mouse" || !allowed()) return;
    targetX = Math.max(-1, Math.min(1, event.clientX / innerWidth * 2 - 1));
    targetY = Math.max(-1, Math.min(1, event.clientY / innerHeight * 2 - 1));
    wake();
  }, { passive: true, signal });
  gate.addEventListener("pointerleave", () => { targetX = targetY = 0; wake(); }, { signal });
  gate.addEventListener("close", reset, { signal });
  window.addEventListener("blur", reset, { signal });
  window.addEventListener("resize", reset, { passive: true, signal });
  document.addEventListener("visibilitychange", reset, { signal });
  reduced.addEventListener("change", reset, { signal });
  pointer.addEventListener("change", reset, { signal });
  signal.addEventListener("abort", reset, { once: true });
}
