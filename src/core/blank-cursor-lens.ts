let cleanup: (() => void) | undefined;
const initialize = () => {
  cleanup?.();
  if (!document.body.hasAttribute("data-blank")) return;
  const enabled = matchMedia("(hover: hover) and (pointer: fine)");
  const lens = document.createElement("div");
  lens.className = "blank-cursor-lens";
  lens.setAttribute("aria-hidden", "true");
  lens.hidden = true;
  document.body.append(lens);
  let frame = 0;
  let x = 0;
  let y = 0;
  const hide = () => { cancelAnimationFrame(frame); frame = 0; lens.hidden = true; };
  const move = (event: PointerEvent) => {
    if (!enabled.matches || event.pointerType !== "mouse") return;
    x = event.clientX;
    y = event.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      lens.style.left = `${x}px`;
      lens.style.top = `${y}px`;
      lens.hidden = false;
    });
  };
  document.addEventListener("pointermove", move, { passive: true });
  document.documentElement.addEventListener("pointerleave", hide);
  window.addEventListener("blur", hide);
  enabled.addEventListener("change", hide);
  cleanup = () => {
    cancelAnimationFrame(frame);
    lens.remove();
    document.removeEventListener("pointermove", move);
    document.documentElement.removeEventListener("pointerleave", hide);
    window.removeEventListener("blur", hide);
    enabled.removeEventListener("change", hide);
  };
};
initialize();
document.addEventListener("astro:page-load", initialize);
document.addEventListener("astro:before-swap", () => cleanup?.());
