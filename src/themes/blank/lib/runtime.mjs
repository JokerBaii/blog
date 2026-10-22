import { mountCollection } from "./collection.mjs";

export function menuPosition(x, y, width, height, viewportWidth, viewportHeight) {
  return {
    left: Math.max(8, Math.min(x, viewportWidth - width - 8)),
    top: Math.max(8, Math.min(y, viewportHeight - height - 8))
  };
}

export function readingProgress(top, height, viewportHeight, headerHeight) {
  const travel = Math.max(0, height - viewportHeight + headerHeight);
  if (!travel) return Math.max(0, Math.min(1, (viewportHeight - top) / Math.max(1, height)));
  return Math.max(0, Math.min(1, (headerHeight - top) / travel));
}

export function mountMenu(doc, win) {
  const menu = doc.querySelector("[data-blank-context-menu]");
  const trigger = doc.querySelector("[data-blank-menu-trigger]");
  if (!menu || !trigger) return () => {};
  const listeners = [];
  const on = (node, event, handler, options) => {
    node.addEventListener(event, handler, options);
    listeners.push(() => node.removeEventListener(event, handler, options));
  };
  let returnFocus = trigger;
  const items = () => [...menu.querySelectorAll("button, a[href]")];
  const close = (restoreFocus = false) => {
    if (menu.hidden) return;
    const focusedInside = menu.contains(doc.activeElement);
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if ((restoreFocus || focusedInside) && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  };
  const open = (x, y, keyboard = false) => {
    if (menu.hidden) returnFocus = doc.activeElement !== doc.body && doc.activeElement?.focus ? doc.activeElement : trigger;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    const rect = menu.getBoundingClientRect();
    const position = menuPosition(x, y, rect.width, rect.height, win.innerWidth, win.innerHeight);
    menu.style.left = `${position.left}px`;
    menu.style.top = `${position.top}px`;
    if (keyboard) items()[0]?.focus({ preventScroll: true });
  };
  on(trigger, "click", () => {
    if (!menu.hidden) { close(true); return; }
    const rect = trigger.getBoundingClientRect();
    open(rect.right - 252, rect.bottom + 8, true);
  });
  on(doc, "contextmenu", (event) => {
    // Keep the native menu for text selection, links, and form controls.
    if (event.target?.closest?.("a, input, textarea, select, [contenteditable], pre") || win.getSelection()?.toString()) return;
    event.preventDefault();
    open(event.clientX, event.clientY, true);
  });
  on(win, "yuimi:context-menu-request", (event) => {
    if (win.getSelection()?.toString()) return;
    const x = Number(event.detail?.clientX);
    const y = Number(event.detail?.clientY);
    open(Number.isFinite(x) ? x : win.innerWidth / 2, Number.isFinite(y) ? y : win.innerHeight / 2, true);
  });
  on(doc, "keydown", (event) => {
    if (event.key === "Escape") { close(true); return; }
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      if (doc.activeElement?.matches?.("a, input, textarea, select, [contenteditable], pre")) return;
      event.preventDefault();
      const rect = doc.activeElement?.getBoundingClientRect?.() ?? trigger.getBoundingClientRect();
      open(rect.left, rect.bottom + 8, true);
      return;
    }
    if (menu.hidden || !menu.contains(doc.activeElement)) return;
    const controls = items();
    const index = controls.indexOf(doc.activeElement);
    let next;
    if (event.key === "ArrowDown") next = (index + 1) % controls.length;
    if (event.key === "ArrowUp") next = (index - 1 + controls.length) % controls.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = controls.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      controls[next]?.focus();
    }
  });
  on(doc, "click", (event) => {
    const target = event.target;
    const theme = target?.closest?.("[data-theme-select]");
    if (theme && menu.contains(theme)) {
      close(true);
      win.__yuimiTheme?.select(theme.dataset.themeSelect);
    } else if (target?.closest?.("a") && menu.contains(target)) close();
    else if (!menu.contains(target) && !trigger.contains(target)) close();
  });
  on(doc, "focusin", (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) close();
  });
  on(win, "resize", () => close());
  on(win, "scroll", () => close(), { passive: true });
  on(win, "pagehide", () => close());
  trigger.hidden = false;
  return () => { close(); listeners.forEach((remove) => remove()); };
}

export function mountReading(doc, win) {
  const prose = doc.querySelector("[data-blank-prose]");
  const progress = doc.querySelector("[data-blank-progress]");
  if (!prose || !progress) return () => {};
  const header = doc.querySelector(".blank-header");
  const links = [...doc.querySelectorAll("[data-blank-toc] a")];
  const sections = links.map((link) => {
    try { return doc.getElementById(decodeURIComponent(link.hash.slice(1))); }
    catch { return null; }
  });
  let frame = 0;
  let active = -1;
  let disposed = false;
  const update = () => {
    frame = 0;
    if (doc.hidden || disposed) return;
    const headerHeight = header?.getBoundingClientRect().height ?? 80;
    const rect = prose.getBoundingClientRect();
    progress.style.transform = `scaleX(${readingProgress(rect.top, rect.height, win.innerHeight, headerHeight)})`;
    let next = -1;
    for (let index = 0; index < sections.length; index++) {
      if (sections[index] && sections[index].getBoundingClientRect().top <= headerHeight + 48) next = index;
    }
    if (next !== active) {
      if (active >= 0) links[active].removeAttribute("aria-current");
      if (next >= 0) links[next].setAttribute("aria-current", "location");
      active = next;
    }
  };
  const schedule = () => { if (!frame && !disposed && !doc.hidden) frame = win.requestAnimationFrame(update); };
  const visibility = () => {
    if (doc.hidden) { win.cancelAnimationFrame(frame); frame = 0; }
    else schedule();
  };
  win.addEventListener("scroll", schedule, { passive: true });
  win.addEventListener("resize", schedule);
  win.addEventListener("pageshow", schedule);
  doc.addEventListener("visibilitychange", visibility);
  prose.addEventListener("load", schedule, true);
  prose.addEventListener("toggle", schedule, true);
  const observer = win.ResizeObserver ? new win.ResizeObserver(schedule) : null;
  observer?.observe(prose);
  schedule();
  return () => {
    disposed = true;
    win.cancelAnimationFrame(frame);
    observer?.disconnect();
    win.removeEventListener("scroll", schedule);
    win.removeEventListener("resize", schedule);
    win.removeEventListener("pageshow", schedule);
    doc.removeEventListener("visibilitychange", visibility);
    prose.removeEventListener("load", schedule, true);
    prose.removeEventListener("toggle", schedule, true);
  };
}

export function mountBlank(doc, win) {
  const cleanups = [
    mountMenu(doc, win),
    ...[...doc.querySelectorAll("[data-blank-collection]")].map((root) => mountCollection(root, win)),
    mountReading(doc, win)
  ];
  const missingPath = doc.querySelector("[data-blank-missing-path]");
  const from = new URL(win.location.href).searchParams.get("from");
  if (missingPath && from) {
    missingPath.textContent = from;
    missingPath.hidden = false;
  }
  const teardown = (event) => {
    if (event.persisted) return;
    cleanups.forEach((cleanup) => cleanup());
    win.removeEventListener("pagehide", teardown);
  };
  win.addEventListener("pagehide", teardown);
  return () => teardown({ persisted: false });
}
