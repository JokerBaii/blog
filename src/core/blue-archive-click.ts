import type { BAClickFX } from "ba-click-fx";

declare global {
  interface Window {
    __jokerbaiBafx?: { instance?: BAClickFX; host: HTMLDivElement };
  }
}
if (!window.__jokerbaiBafx) {
  const host = document.createElement("div");
  host.dataset.clickEffect = "blue-archive";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:0;top:0;pointer-events:none;z-index:2147483000;overflow:hidden;";
  document.documentElement.append(host);
  const state = (window.__jokerbaiBafx = {
    host,
    instance: undefined as BAClickFX | undefined,
  });
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let loading: Promise<BAClickFX | undefined> | undefined;
  let activePointer: number | undefined;
  const resize = () => {
    const zoom =
      Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    host.style.zoom = String(1 / zoom);
    host.style.width = `${innerWidth}px`;
    host.style.height = `${innerHeight}px`;
    state.instance?.resize(
      innerWidth,
      innerHeight,
      Math.min(devicePixelRatio || 1, 1.5),
    );
  };
  const initialize = () => {
    if (motion.matches || document.body.hasAttribute("data-blank")) return Promise.resolve(undefined);
    return (loading ??= import("ba-click-fx")
      .then(({ BAClickFX }) => {
        resize();
        const fx = new BAClickFX({
          target: host,
          inputSource: "manual",
          outputCompositing: "browser-overlay",
          hostCompositing: "screen",
          hostCompositingSurface: "dom-backdrop",
          maxDpr: 1.5,
          touchAction: "auto",
          trailAlways: !document.body.hasAttribute("data-blank"),
        });
        state.instance = fx;
        fx.setPaused(document.hidden || motion.matches || document.body.hasAttribute("data-blank"), { clear: true });
        return fx;
      })
      .catch((error) => {
        console.warn("Click effect could not start", error);
        return undefined;
      }));
  };
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isPrimary || event.button > 0 || motion.matches || document.body.hasAttribute("data-blank")) return;
      activePointer = event.pointerId;
      const { clientX: x, clientY: y, pointerId, pointerType } = event;
      void initialize().then((fx) => {
        if (!fx) return;
        if (activePointer === pointerId)
          fx.pointerDown({
            x,
            y,
            pointerId,
            pointerType: pointerType as "mouse" | "touch" | "pen",
          });
        else fx.boom(x, y);
      });
    },
    { passive: true },
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (motion.matches || !state.instance || document.body.hasAttribute("data-blank")) return;
      if (event.pointerType !== "mouse" && activePointer !== event.pointerId) return;
      state.instance.pointerMove({
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        pointerType: event.pointerType as "mouse" | "touch" | "pen",
      });
    },
    { passive: true },
  );
  const release = (event: PointerEvent) => {
    if (activePointer !== event.pointerId) return;
    state.instance?.pointerUp(event.pointerId);
    activePointer = undefined;
  };
  document.addEventListener("pointerup", release, { passive: true });
  document.addEventListener(
    "pointercancel",
    (event) => {
      state.instance?.pointerCancel(event.pointerId);
      activePointer = undefined;
    },
    { passive: true },
  );
  const pause = () => {
    state.instance?.setPaused(document.hidden || motion.matches || document.body.hasAttribute("data-blank"), {
      clear: true,
    });
  };
  document.addEventListener("visibilitychange", pause);
  motion.addEventListener("change", () => {
    pause();
    if (!motion.matches) void initialize();
  });
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("astro:after-swap", () => {
    if (!host.isConnected) document.documentElement.append(host);
    state.instance?.clear();
    pause();
    activePointer = undefined;
    resize();
  });
  resize();
  if ("requestIdleCallback" in window)
    window.requestIdleCallback(
      () => {
        void initialize();
      },
      { timeout: 1800 },
    );
  else
    setTimeout(() => {
      void initialize();
    }, 800);
}
