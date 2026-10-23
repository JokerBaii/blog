import { browserUuid } from "./browser";
import stickerChoices from "../data/sticker-choices.json";
import { chooseImage, confirmAction } from "./dialogs";

type RequestApi = (path: string, options?: RequestInit) => Promise<Response>;
type Run = (action: () => Promise<void>) => Promise<void>;
type Notify = (message: string, error?: boolean) => void;
type ContentValue = string | ContentValue[] | { [key: string]: ContentValue };
const labels: Record<string, string> = {
  identity: "基本资料", status: "此刻状态", tech: "技术线", anime: "喜欢的番剧",
  favorites: "日常偏爱", relaxation: "放松方式", signals: "最近的电波", projects: "作品卡片",
  displayName: "昵称", handle: "账号标识", siteName: "小站名称", bio: "个人简介", github: "GitHub 链接", qq: "QQ", intro: "ME 开场介绍",
  name: "名称", note: "说明", title: "标题", subtitle: "小字说明", image: "图片地址", label: "名称", text: "内容",
  type: "英文小标题", statusValue: "当前状态", summary: "卡片介绍", details: "标签", sticker: "角色贴纸地址",
  links: "网站收藏", href: "网站地址", domain: "显示域名", category: "英文分类", description: "网站说明", art: "网站配图",
  color: "主色", wash: "背景色", loveSince: "表白日期",
};
export const meSections = ["identity", "status", "tech", "anime", "favorites", "relaxation", "signals"];

export function mountPageContentEditor(api: RequestApi, run: Run, notify: Notify) {
  const form = document.getElementById("page-content-form") as HTMLFormElement;
  const fields = document.getElementById("page-content-fields")!;
  const tabs = document.getElementById("content-tabs")!;
  const items = document.getElementById("content-items")!;
  const state = document.getElementById("page-content-state")!;
  let content: Record<string, ContentValue> | undefined;
  let dirty = false;
  let section = "identity";
  let selected = 0;
  const changed = (message = "有未保存的修改") => { dirty = true; state.textContent = message; };
  const renderFields = (value: ContentValue, root: HTMLElement, path: (string | number)[]) => {
    if (typeof value !== "string") {
      for (const [key, child] of Object.entries(value)) {
        renderFields(child, root, [...path, Array.isArray(value) ? Number(key) : key]);
      }
      return;
    }
    const field = String(path.at(-1));
    if (["id", "key", "line"].includes(field)) return;
    const wrapper = document.createElement("div");
    wrapper.className = "content-field";
    const label = document.createElement("label");
    label.textContent = typeof path.at(-1) === "number" ? `第 ${Number(path.at(-1)) + 1} 条` : labels[field === "status" ? "statusValue" : field] ?? field;
    const control = document.createElement(["bio", "intro", "summary", "text", "description"].includes(field) ? "textarea" : "input");
    control.value = value;
    control.id = `page-${path.join("-")}`;
    control.maxLength = 4000;
    if (control instanceof HTMLInputElement) {
      if (field === "loveSince") control.type = "date";
      if (["color", "wash"].includes(field)) control.type = "color";
      if (field === "href") control.type = "url";
    } else control.rows = 3;
    label.htmlFor = control.id;
    if (["displayName", "siteName", "name", "title", "href", "domain"].includes(field)) control.required = true;
    control.addEventListener("input", () => {
      let target = content as Record<string | number, ContentValue>;
      for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, ContentValue>;
      target[path.at(-1)!] = control.value;
      changed();
      // Keep the item name in sync without rebuilding the active form.
      if (["title", "name", "label"].includes(field)) {
        const active = items.querySelector<HTMLElement>("[aria-current='true'] strong");
        if (active) active.textContent = control.value;
      }
    });
    wrapper.append(label, control);
    if (["image", "sticker", "art"].includes(field)) {
      wrapper.classList.add("image-field");
      const preview = document.createElement("img");
      preview.src = value;
      preview.alt = "当前配图";
      preview.width = 96;
      preview.height = 96;
      preview.addEventListener("error", () => { preview.hidden = true; });
      control.addEventListener("input", () => { preview.hidden = false; preview.src = control.value; });
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choose-sticker";
      button.textContent = "♡ 从图片库选择";
      button.addEventListener("click", async () => {
        const choice = await chooseImage(control.value);
        if (!choice) return;
        control.value = choice;
        control.dispatchEvent(new Event("input", { bubbles: true }));
      });
      wrapper.append(preview, button);
    }
    root.append(wrapper);
  };
  const render = () => {
    fields.replaceChildren();
    items.replaceChildren();
    tabs.replaceChildren();
    if (!content) return;
    const sections = meSections.includes(section) ? meSections : [section];
    tabs.hidden = sections.length === 1;
    for (const key of sections) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.textContent = labels[key];
      tab.setAttribute("aria-pressed", String(key === section));
      tab.addEventListener("click", () => { section = key; selected = 0; render(); });
      tabs.append(tab);
    }
    const value = content[section];
    const indexed = Array.isArray(value) && value.some(item => typeof item !== "string");
    items.hidden = !indexed && section !== "links";
    if (indexed) {
      const entries = value as Record<string, ContentValue>[];
      selected = Math.max(0, Math.min(selected, entries.length - 1));
      entries.forEach((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "content-item";
        button.setAttribute("aria-current", String(index === selected));
        const number = document.createElement("span");
        number.textContent = String(index + 1).padStart(2, "0");
        const title = document.createElement("strong");
        title.textContent = String(item.title ?? item.name ?? item.label ?? `第 ${index + 1} 项`);
        button.append(number, title);
        button.addEventListener("click", () => { selected = index; render(); });
        items.append(button);
      });
      if (entries[selected]) renderFields(entries[selected], fields, [section, selected]);
    } else renderFields(value, fields, [section]);
    if (section === "links") {
      const sites = value as ContentValue[];
      const add = document.createElement("button");
      add.type = "button";
      add.className = "add-website";
      add.textContent = "＋ 添加网站";
      add.addEventListener("click", () => {
        if (sites.length >= 50) { notify("最多收藏 50 个网站。", true); return; }
        sites.push({ id: `site-${browserUuid()}`, name: "新的网站", href: "https://example.com/", domain: "example.com", category: "MY BOOKMARK", description: "", color: "#9b98bc", wash: "#f4f1fa", line: "#e2ddef", art: stickerChoices[sites.length % stickerChoices.length].src });
        selected = sites.length - 1;
        changed("网站已添加，编辑后记得保存");
        render();
        document.getElementById(`page-links-${selected}-name`)?.focus();
      });
      items.append(add);
      if (sites.length) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger remove-website";
        remove.textContent = "移除这个网站";
        remove.addEventListener("click", async () => {
          const item = sites[selected] as Record<string, ContentValue>;
          if (!await confirmAction(`从收藏中移除“${item.name}”？保存修改后生效。`, "移除网站")) return;
          sites.splice(selected, 1);
          changed("网站已移除，记得保存");
          render();
        });
        fields.append(remove);
      } else {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "这里还没有收藏，添加第一个喜欢的网站吧。";
        fields.append(empty);
      }
    }
  };
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!content) return;
    void run(async () => {
      state.textContent = "正在保存…";
      try {
        await api("page-content", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(content) });
      } catch (error) { state.textContent = "保存失败，修改仍保留"; throw error; }
      dirty = false;
      state.textContent = "已保存 ♡";
      notify("修改已保存，两种主题会同步更新。");
    });
  });
  return {
    snapshot: () => dirty && content ? { content, section, selected } : undefined,
    restore: (draft: { content: Record<string, ContentValue>; section: string; selected: number }) => {
      content = draft.content;
      section = draft.section in content ? draft.section : "identity";
      selected = draft.selected;
      changed("重新登录前的修改已找回，记得保存");
      render();
    },
    load: async () => {
      content = await (await api("page-content")).json();
      dirty = false;
      state.textContent = "";
      render();
    },
    isDirty: () => dirty,
    open: (key: string, index?: string) => {
      if (!content || !(key in content)) return;
      section = key;
      selected = index === undefined ? 0 : Number(index);
      render();
      const prefix = `page-${section}-${Array.isArray(content[section]) && typeof content[section][selected] !== "string" ? `${selected}-` : ""}`;
      const target = ["title", "name", "displayName", "label"].map(name => document.getElementById(`${prefix}${name}`)).find(Boolean) ?? fields.querySelector<HTMLElement>("input,textarea");
      target?.focus({ preventScroll: true });
    },
  };
}
