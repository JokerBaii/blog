import { isAdministrator } from "./admin/access";
import { getCanonicalPath } from "./themes/registry";
let dispose: (() => void) | undefined;
const mount = () => {
  dispose?.();
  const menu = document.querySelector<HTMLElement>("[data-context-menu], [data-blank-context-menu]");
  if (!menu) return;
  const mark = (selector: string, section: string, indexed = false) => {
    document.querySelectorAll<HTMLElement>(selector).forEach((node, index) => {
      node.dataset.adminEdit = section;
      if (indexed) node.dataset.adminItem = String(index);
    });
  };
  mark(".blank-profile, .about-id-card, .identity-card", "identity");
  mark(".about-avatar-card, .identity-avatar, img[src='/api/avatar']", "avatar");
  mark(".about-status-card, .blank-status-list", "status");
  mark(".about-tech-card, .blank-tech-list > div", "tech", true);
  mark(".about-media-card, .blank-favorites-list > li", "anime", true);
  mark(".about-xp-card, .blank-preferences > li", "favorites", true);
  mark(".about-game-card, .blank-favorite-games > li", "relaxation", true);
  mark(".about-activity-grid > article, .blank-signals > div", "signals", true);
  mark(".works-card, .blank-project", "projects", true);
  mark(".links-card", "links", true);
  mark(".love-counter", "identity");
  const entry = document.createElement("button");
  entry.type = "button";
  entry.dataset.adminEditEntry = "";
  let authorized = false;
  let active = true;
  void isAdministrator().then(value => { if (active) authorized = value; });
  let href = "/admin/?edit=identity";
  const select = (target: EventTarget | null) => {
    const source = target instanceof Element ? target : null;
    const link = source?.closest<HTMLAnchorElement>("a[href]");
    const articleSlug = (path: string) => getCanonicalPath(path).match(/^\/blog\/([a-z0-9]+(?:-*[a-z0-9]+)*)\/?$/)?.[1];
    const slug = (link?.origin === location.origin ? articleSlug(link.pathname) : undefined)
      ?? (source?.closest(".article, .blank-article-header, .blank-article-body") ? articleSlug(location.pathname) : undefined);
    const node = source?.closest<HTMLElement>("[data-admin-edit]");
    entry.hidden = !authorized || (!slug && !node);
    if (!authorized) return null;
    if (slug) {
      href = `/admin/?${new URLSearchParams({ edit: "writing", article: slug })}`;
      entry.textContent = "✎ 编辑这篇文章";
      return source;
    }
    if (!node) return null;
    const section = node.dataset.adminEdit!;
    const params = new URLSearchParams({ edit: section });
    if (node?.dataset.adminItem) params.set("item", node.dataset.adminItem);
    href = `/admin/?${params}`;
    entry.textContent = section === "avatar" ? "✎ 更换头像" : section === "links" ? "✎ 编辑网站收藏" : section === "identity" ? "✎ 编辑个人资料" : "✎ 编辑这张卡片";
    return node;
  };
  select(null);
  entry.addEventListener("click", () => window.location.assign(href));
  menu.prepend(entry);
  const context = (event: MouseEvent) => {
    const node = select(event.target);
    if (node && document.body.hasAttribute("data-blank") && !window.getSelection()?.toString()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.dispatchEvent(new CustomEvent("yuimi:context-menu-request", { detail: { clientX: event.clientX, clientY: event.clientY } }));
    }
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) select(document.activeElement);
  };
  document.addEventListener("contextmenu", context, true);
  document.addEventListener("keydown", keyboard, true);
  dispose = () => {
    active = false;
    document.removeEventListener("contextmenu", context, true);
    document.removeEventListener("keydown", keyboard, true);
    entry.remove();
  };
};
mount();
document.addEventListener("astro:page-load", mount);
document.addEventListener("astro:before-swap", () => dispose?.());
