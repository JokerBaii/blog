import { isAdministrator } from "./admin/access";
import { mountEntryMotion } from "./entry-motion";

const admittedKey = "jokerbai-entry-admitted-v1";
let dispose: (() => void) | undefined;
let currentGate: HTMLElement | null = null;
function mount() {
  const gate = document.getElementById("entry-gate") as HTMLDialogElement | null;
  if (!gate || currentGate === gate) return;
  dispose?.();
  currentGate = gate;
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  mountEntryMotion(gate, signal);
  const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  let active = true;
  let busy = false;
  let authorized = false;
  let ready = false;
  const standalone = gate.dataset.standalone === "true";
  const home = gate.dataset.entryTheme === "blank" ? "/themes/blank/" : "/";
  const destination = gate.dataset.next || home;
  const remember = (role: string) => { try { sessionStorage.setItem(admittedKey, role); } catch {} };
  const leave = (role: string) => {
    remember(role);
    if (standalone) location.replace(role === "author" ? destination : home);
    else gate.close();
  };
  const showWelcome = () => {
    if (!active) return;
    ready = true;
    node("entry-loading").hidden = true;
    node("entry-welcome").hidden = false;
    gate.dataset.ready = "true";
    node("entry-login-form").hidden = authorized;
    node("entry-author").hidden = !authorized;
    node("entry-traveler").textContent = authorized ? "退出并以旅人身份浏览 →" : "以旅人身份进入 →";
    node("entry-error").textContent = "";
    if (gate.open) node("entry-traveler").focus({ preventScroll: true });
  };
  const travel = async () => {
    if (busy) return;
    busy = true;
    try {
      if (authorized) {
        const response = await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
        if (!response.ok) throw new Error("暂时无法切换身份，请稍后重试。");
        authorized = false;
        await isAdministrator(true);
        leave("traveler");
        if (!standalone) location.reload();
      } else leave("traveler");
    } catch (error) { node("entry-error").textContent = error instanceof Error ? error.message : "请稍后重试。"; }
    finally { busy = false; }
  };
  gate.addEventListener("cancel", event => { event.preventDefault(); if (!busy) leave(authorized ? "author" : "traveler"); }, { signal });
  gate.addEventListener("wheel", event => event.stopPropagation(), { passive: true, signal });
  node("entry-skip").addEventListener("click", () => leave(authorized ? "author" : "traveler"), { signal });
  node("entry-traveler").addEventListener("click", () => { void travel(); }, { signal });
  node("entry-author").addEventListener("click", () => remember("author"), { signal });
  document.querySelectorAll<HTMLElement>("[data-entry-open]").forEach(button => {
    button.addEventListener("click", async () => {
      authorized = await isAdministrator(true);
      showWelcome();
      if (!gate.open) gate.showModal();
      (authorized ? node("entry-author") : node("entry-username")).focus({ preventScroll: true });
    }, { signal });
  });
  node<HTMLFormElement>("entry-login-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = gate.querySelector<HTMLButtonElement>(".entry-primary")!;
    button.disabled = true;
    node("entry-error").textContent = "";
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: node<HTMLInputElement>("entry-username").value.trim(), password: node<HTMLInputElement>("entry-password").value }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? "暂时无法登录，请稍后重试。");
      node<HTMLInputElement>("entry-password").value = "";
      remember("author");
      location.assign(destination);
    } catch (error) { node("entry-error").textContent = error instanceof Error ? error.message : "暂时无法登录，请稍后重试。"; }
    finally { busy = false; button.disabled = false; }
  }, { signal });
  // Count completed critical resources. Lazy images and optional effects never hold the gate.
  if (gate.open) {
    const images = [...document.images].filter(image => image.loading !== "lazy" && (gate.contains(image) || image.getBoundingClientRect().top < innerHeight)).slice(0, 8);
    const auth = isAdministrator().then(value => { authorized = value; });
    const dom = document.readyState === "loading" ? new Promise<void>(resolve => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true, signal })) : Promise.resolve();
    const tasks: Promise<unknown>[] = [dom, document.fonts.ready, auth, ...images.map(image => image.decode().catch(() => undefined))];
    let completed = 0;
    const bounded = (task: Promise<unknown>) => new Promise<void>(resolve => {
      const timer = window.setTimeout(resolve, 8000);
      task.catch(() => undefined).finally(() => { clearTimeout(timer); resolve(); });
    });
    void Promise.all(tasks.map(task => bounded(task).finally(() => {
      if (!active || ready || !gate.open) return;
      const percent = Math.round(++completed / tasks.length * 100);
      node("entry-progress").style.setProperty("--entry-progress", `${percent}%`);
      node("entry-progress").setAttribute("aria-valuenow", String(percent));
      node("entry-percent").textContent = `${percent}%`;
      node("entry-load-note").textContent = percent === 100 ? "这一页，准备好了" : "正在拼好这个小世界";
    }))).then(() => {
      if (!active || !gate.open || ready) return;
      if (authorized) leave("author");
      else showWelcome();
    });
  }
  dispose = () => { currentGate = null; active = false; lifecycle.abort(); if (gate.open) gate.close(); };
}
mount();
document.addEventListener("astro:page-load", mount);
document.addEventListener("astro:before-swap", () => dispose?.());
