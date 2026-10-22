export function clampWaifuPosition(left, top, width, height, viewportWidth, viewportHeight) {
  const margin = 8;
  const clamp = (value, maximum) => Math.min(Math.max(margin, maximum - margin), Math.max(margin, value));
  return {
    left: clamp(left, viewportWidth - width),
    top: clamp(top, viewportHeight - height)
  };
}

export function mountWaifuAnchor(root, win = window) {
  const doc = root.ownerDocument;
  if (root.parentElement !== doc.body) doc.body.appendChild(root);
  // Ignore old library drag coordinates; start from the theme's viewport anchor.
  for (const property of ["top", "bottom", "left", "right", "translate"]) root.style.removeProperty(property);
  let x = 0, y = 0, drag = null;
  const moveTo = (left, top) => {
    const rect = root.getBoundingClientRect();
    const origin = { left: rect.left - x, top: rect.top - y };
    const next = clampWaifuPosition(left, top, rect.width, rect.height, win.innerWidth, win.innerHeight);
    x = next.left - origin.left;
    y = next.top - origin.top;
    root.style.translate = `${x}px ${y}px`;
  };
  const stop = (event) => {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const pointerId = drag.id;
    drag = null;
    if (root.hasPointerCapture?.(pointerId)) root.releasePointerCapture(pointerId);
    root.classList.remove("is-waifu-dragging");
  };
  const down = (event) => {
    if (drag || event.button !== 0 || !event.isPrimary || event.target.id !== "live2d") return;
    const rect = root.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
    root.setPointerCapture?.(event.pointerId);
    root.classList.add("is-waifu-dragging");
  };
  const move = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    moveTo(event.clientX - drag.x, event.clientY - drag.y);
  };
  const resize = () => {
    stop();
    if (root.classList.contains("waifu-hidden")) return;
    const rect = root.getBoundingClientRect();
    moveTo(rect.left, rect.top);
  };
  const visibility = () => { if (doc.visibilityState === "hidden") stop(); };
  root.addEventListener("pointerdown", down);
  root.addEventListener("pointermove", move);
  root.addEventListener("pointerup", stop);
  root.addEventListener("pointercancel", stop);
  root.addEventListener("lostpointercapture", stop);
  win.addEventListener("resize", resize);
  win.addEventListener("blur", resize);
  doc.addEventListener("visibilitychange", visibility);
  resize();
  return () => {
    stop();
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("pointermove", move);
    root.removeEventListener("pointerup", stop);
    root.removeEventListener("pointercancel", stop);
    root.removeEventListener("lostpointercapture", stop);
    win.removeEventListener("resize", resize);
    win.removeEventListener("blur", resize);
    doc.removeEventListener("visibilitychange", visibility);
  };
}
