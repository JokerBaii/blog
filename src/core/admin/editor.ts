import { meSections, mountPageContentEditor } from "./page-content-editor";
import { chooseImage, confirmAction } from "./dialogs";
import { mountMarkdownEditor } from "./markdown-editor";
import { mountLivePreview } from "./live-preview";
import { mountAttachmentQueue } from "./attachment-queue";
type Article = {
  id: string;
  title: string;
  slug: string;
  description: string;
  tags: string[];
  category: string;
  published: boolean;
  content_markdown: string;
  updated_at: string;
  attachments: Attachment[];
};
type Attachment = { id: string; filename: string; size: number };
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const form = element<HTMLFormElement>("editor-form");
const list = element<HTMLDivElement>("article-list");
const status = element<HTMLSpanElement>("article-status");
const view = element<HTMLAnchorElement>("view-article");
const markdownEditor = mountMarkdownEditor(element<HTMLTextAreaElement>("content"));
let current: Article | null = null;
let dirty = false;
let busy = false;
let page = 1;
let total = 0;
let query = "";
let leaving = false;
const recoveryKey = "jokerbai-desk-recovery-v1";
const articleFields = ["title", "slug", "description", "tags", "category", "content"] as const;
const readRecovery = () => {
  try {
    const raw = sessionStorage.getItem(recoveryKey);
    const draft = raw ? JSON.parse(raw) : null;
    return draft && Date.now() - draft.createdAt < 86400000 ? draft : null;
  } catch { return null; }
};

const perPage = 20;
const notify = (text: string, error = false) => {
  const target = element("message");
  target.textContent = text;
  target.classList.toggle("error", error);
  target.setAttribute("role", error ? "alert" : "status");
};
const pagination = () => {
  element<HTMLButtonElement>("previous").disabled = busy || page <= 1;
  element<HTMLButtonElement>("next").disabled = busy || page * perPage >= total;
  element("page-info").textContent =
    `${page} / ${Math.max(1, Math.ceil(total / perPage))}`;
};
const run = async (action: () => Promise<void>) => {
  if (busy) return;
  busy = true;
  markdownEditor.setReadOnly(true);
  const controls = [
    ...document.querySelectorAll<
      | HTMLInputElement
      | HTMLButtonElement
      | HTMLSelectElement
      | HTMLTextAreaElement
    >("button,input,textarea,select"),
  ];
  const disabledBefore = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  element("workspace").setAttribute("aria-busy", "true");
  try {
    await action();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败，请重试。", true);
  } finally {
    busy = false;
    markdownEditor.setReadOnly(false);
    controls.forEach((control, index) => { control.disabled = disabledBefore[index]; });
    element("workspace").setAttribute("aria-busy", "false");
    if (input("slug").hidden) input("slug").disabled = true;
    pagination();
  }
};
const api = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`/api/admin/${path}`, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    if (response.status === 401) {
      // Keep per-tab edits before routing to the only login UI. No authentication data is stored here.
      try {
        await attachmentQueue.retainForLogin();
        sessionStorage.setItem(recoveryKey, JSON.stringify({
          article: dirty ? { current: current ? { id: current.id } : null, fields: Object.fromEntries(articleFields.map(id => [id, input(id).value])), published: input("published").checked, customSlug: !input("slug").hidden } : undefined,
          pageContent: pageContentEditor.snapshot(),
          section: document.querySelector<HTMLElement>("[data-view][aria-current=page]")?.dataset.view ?? "writing",
          createdAt: Date.now(),
        }));
        leaving = true;
      } catch {
        // Stay on the desk if the browser cannot retain edits; never silently discard them.
        throw new Error("登录已失效，浏览器无法暂存修改。请先复制正文，再打开 /login/ 重新登录。");
      }
      location.replace(`/login/?next=${encodeURIComponent(location.pathname + location.search)}`);
    }
    throw new Error(
      response.status === 401
        ? "登录已失效，请重新登录。"
        : (result?.error?.message ?? `操作失败（${response.status}）`),
    );
  }
  return response;
};
const pageContentEditor = mountPageContentEditor(api, run, notify);
const livePreview = mountLivePreview(markdownEditor.view, async content_markdown => (await api("preview", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content_markdown }),
})).json());
const canLeave = (includePageContent = false) =>
  (!dirty && (!includePageContent || !pageContentEditor.isDirty())) || confirmAction("还有未保存的修改，确定丢弃并离开吗？", "笔记还没有保存");
const markDirty = () => {
  dirty = true;
  element("save-state").textContent = "有未保存的修改";
};
form.addEventListener("input", markDirty);
const attachmentQueue = mountAttachmentQueue({
  changed: () => { markDirty(); element<HTMLTextAreaElement>("content").required = !attachmentQueue.hasPending(); }, busy: () => busy, notify,
  insert: text => markdownEditor.insert(`\n${text}\n`, ""),
  remove: href => markdownEditor.removeAttachment(href),
});
const updateSaveLabel = () => { element("save-article").textContent = input("published").checked ? "发布这一页 ↗" : "保存草稿 ↗"; };
input("published").addEventListener("change", () => { updateSaveLabel(); markDirty(); });
const renderAttachments = (items: Attachment[]) => {
  const root = element("attachment-list");
  root.replaceChildren();
  for (const attachment of items) {
    const row = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${attachment.filename} · ${(attachment.size / 1024).toFixed(1)} KB`;
    const insert = document.createElement("button");
    insert.type = "button";
    insert.textContent = "插入正文";
    insert.addEventListener("click", () => {
      if (busy) return;
      const href = `/api/attachments/${attachment.id}/download`;
      if (input("content").value.includes(href)) {
        notify("这个附件已经在正文里了。");
        markdownEditor.focus();
        return;
      }
      const label = attachment.filename.replace(/[\\\[\]]/g, "\\$&");
      markdownEditor.insert(`\n[${label}](${href})\n`, "");
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", async () => {
      if (busy || !await confirmAction(`确定删除附件“${attachment.filename}”吗？`, "删除附件")) return;
      void run(async () => {
        const wasDirty = dirty;
        await api(`attachments/${attachment.id}`, { method: "DELETE" });
        markdownEditor.removeAttachment(`/api/attachments/${attachment.id}/download`);
        if (current) {
          current.attachments = current.attachments.filter(
            (item) => item.id !== attachment.id,
          );
          renderAttachments(current.attachments);
        }
        if (!wasDirty) { dirty = false; element("save-state").textContent = "已保存"; }
        notify("附件已删除，正文中的对应链接也已同步移除。");
      });
    });
    row.append(name, insert, remove);
    root.append(row);
  }
};
const updateLocation = (section?: string, index?: string) => {
  const url = new URL(location.href);
  if (section) {
    url.searchParams.set("edit", section);
    url.searchParams.delete("item");
    if (index !== undefined) url.searchParams.set("item", index);
  }
  if (current) url.searchParams.set("article", current.slug);
  else url.searchParams.delete("article");
  history.replaceState(history.state, "", url);
};
const fill = (article: Article | null, syncLocation = true) => {
  current = article;
  if (syncLocation) updateLocation();
  attachmentQueue.reset();
  element<HTMLTextAreaElement>("content").required = true;
  form.reset();
  input("title").value = article?.title ?? "";
  input("slug").value = article?.slug ?? "";
  element<HTMLTextAreaElement>("description").value =
    article?.description ?? "";
  input("tags").value = article?.tags.join(", ") ?? "";
  input("category").value = article?.category ?? "tech";
  document.querySelectorAll<HTMLInputElement>("[name=article-category]").forEach(radio => { radio.checked = radio.value === input("category").value; });
  input("slug").hidden = true;
  input("slug").disabled = true;
  element("article-url").textContent = article ? `/blog/${article.slug}/` : "保存后自动生成独立地址，同名文章也不会冲突。";
  element<HTMLTextAreaElement>("content").value =
    article?.content_markdown ?? "";
  markdownEditor.setContent(article?.content_markdown ?? "");
  input("published").checked = article?.published ?? false;
  status.textContent = article
    ? article.published
      ? "已发布"
      : "草稿"
    : "新草稿";
  element("save-state").textContent = article ? "已保存" : "";
  view.hidden = !article?.published;
  element("delete-article").hidden = !article;
  view.href = article ? `/blog/${article.slug}/` : "#";
  livePreview.update();
  updateSaveLabel();
  renderAttachments(article?.attachments ?? []);
  dirty = false;
  list
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.id === current?.id),
    );
};
const loadList = async () => {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
    q: query,
  });
  const data = await (await api(`articles?${params}`)).json();
  total = data.total;
  list.replaceChildren();
  element("list-state").textContent = total
    ? `共 ${total} 篇文章，含草稿`
    : query
      ? "没有匹配的文章。"
      : "还没有文章，从第一篇开始吧。";
  for (const article of data.items as Article[]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "article-item";
    button.dataset.id = article.id;
    button.classList.toggle("active", article.id === current?.id);
    const title = document.createElement("strong");
    title.textContent = article.title;
    const info = document.createElement("small");
    info.textContent = `${article.published ? "已发布" : "草稿"} · ${new Date(article.updated_at).toLocaleDateString("zh-CN")}`;
    button.append(title, info);
    button.addEventListener("click", async () => {
      if (busy || article.id === current?.id || !await canLeave()) return;
      void run(async () => {
        const detail = await (await api(`articles/${article.id}`)).json();
        fill(detail);
        notify("");
      });
    });
    list.append(button);
  }
  pagination();
};
const showView = (section: string, index?: string) => {
  if (![...meSections, "writing", "projects", "links", "avatar"].includes(section)) section = "writing";
  const viewName = ["writing", "projects", "links", "avatar"].includes(section) ? section : "identity";
  element("writing-view").hidden = viewName !== "writing";
  element("content-view").hidden = !["identity", "projects", "links"].includes(viewName);
  element("avatar-view").hidden = viewName !== "avatar";
  document.querySelectorAll<HTMLElement>("[data-view]").forEach(button => {
    if (button.dataset.view === viewName) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (["identity", "projects", "links"].includes(viewName)) pageContentEditor.open(section, index);
  updateLocation(section, index);
};
document.querySelectorAll<HTMLElement>("[data-view]").forEach(button => {
  button.addEventListener("click", () => { if (!busy) showView(button.dataset.view!); });
});
const enterWorkspace = async () => {
  await loadList();
  await pageContentEditor.load();
  fill(null, false);
  const params = new URLSearchParams(location.search);
  const section = params.get("edit") ?? "writing";
  const index = params.get("item");
  const slug = params.get("article");
  const draft = readRecovery();
  if (slug && !draft?.article) {
    if (!/^[a-z0-9]+(?:-*[a-z0-9]+)*$/.test(slug)) throw new Error("文章地址无效。");
    fill(await (await api(`articles/by-slug/${encodeURIComponent(slug)}`)).json());
  }
  showView(section, index && /^\d{1,2}$/.test(index) ? index : undefined);
  let recovered = false;
  try {
    if (draft) {
      if (draft.article) {
        let article = null;
        if (draft.article.current?.id) {
          const response = await fetch(`/api/admin/articles/${encodeURIComponent(draft.article.current.id)}`, { credentials: "same-origin" });
          if (response.ok) article = await response.json();
          else if (response.status !== 404) throw new Error("暂时无法找回文章，请刷新重试。");
        }
        fill(article);
        for (const [id, value] of Object.entries(draft.article.fields)) {
          if ((articleFields as readonly string[]).includes(id) && typeof value === "string") input(id).value = value;
        }
        if (!article && draft.article.current) input("slug").value = "";
        markdownEditor.setContent(input("content").value);
        input("published").checked = draft.article.published === true;
        input("slug").hidden = !draft.article.customSlug;
        input("slug").disabled = input("slug").hidden;
        document.querySelectorAll<HTMLInputElement>("[name=article-category]").forEach(radio => { radio.checked = radio.value === input("category").value; });
        markDirty();
        livePreview.update();
      }
      await attachmentQueue.restoreAfterLogin();
      updateSaveLabel();
      showView(draft.section ?? "writing", draft.pageContent ? String(draft.pageContent.selected) : undefined);
      // Restore the selected ME subsection as well as the top-level navigation.
      if (draft.pageContent) pageContentEditor.restore(draft.pageContent);
      recovered = true;
    }
    sessionStorage.removeItem(recoveryKey);
  } catch (error) {
    notify(error instanceof Error ? error.message : "暂存内容无法读取，请刷新重试。", true);
    return;
  }
  if (recovered) notify("重新登录前的修改已找回，记得保存。♡");
};
element("logout").addEventListener("click", async () => {
  if (busy || !await canLeave(true)) return;
  void run(async () => {
    await api("logout", { method: "POST" });
    sessionStorage.removeItem(recoveryKey);
    await attachmentQueue.clearRecovery().catch(() => undefined);
    leaving = true;
    location.replace("/login/");
  });
});
element("new-article").addEventListener("click", async () => {
  if (!busy && await canLeave()) {
    fill(null);
    notify("");
    input("title").focus();
  }
});
element("delete-article").addEventListener("click", async () => {
  if (busy || !current) return;
  const article = current;
  if (!await confirmAction(
    `确定删除文章“${article.title}”吗？\n文章及其全部附件会永久删除，无法恢复。${dirty ? "\n当前未保存的修改也会丢弃。" : ""}`, "删除文章",
  )) return;
  void run(async () => {
    await api(`articles/${article.id}`, { method: "DELETE" });
    fill(null);
    page = Math.max(1, Math.min(page, Math.ceil(Math.max(0, total - 1) / perPage)));
    notify("文章和附件已删除。");
    try {
      await loadList();
    } catch {
      notify("文章和附件已删除，但列表刷新失败；请重新搜索。", true);
    }
  });
});
element<HTMLFormElement>("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  query = input("search").value.trim();
  page = 1;
  void run(loadList);
});
element("previous").addEventListener("click", () => {
  if (page > 1) {
    page--;
    void run(loadList);
  }
});
element("next").addEventListener("click", () => {
  if (page * perPage < total) {
    page++;
    void run(loadList);
  }
});
element("article-options-toggle").addEventListener("click", () => {
  const panel = element("article-options");
  panel.hidden = !panel.hidden;
  element("article-options-toggle").setAttribute("aria-expanded", String(!panel.hidden));
});
element("custom-slug").addEventListener("click", () => {
  input("slug").hidden = false;
  input("slug").disabled = false;
  input("slug").focus();
});
document.querySelectorAll<HTMLInputElement>("[name=article-category]").forEach(radio => {
  radio.addEventListener("change", () => { if (radio.checked) input("category").value = radio.value; });
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    const payload = {
      title: input("title").value,
      slug: input("slug").value,
      description: element<HTMLTextAreaElement>("description").value,
      content_markdown: element<HTMLTextAreaElement>("content").value,
      tags: input("tags")
        .value.split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      category: input("category").value,
      published: input("published").checked,
    };
    const submission = new FormData();
    submission.append("article", JSON.stringify(payload));
    attachmentQueue.appendTo(submission);
    const article = await (await api(current ? `articles/${current.id}` : "articles", { method: current ? "PUT" : "POST", body: submission })).json();
    fill(article);
    notify(
      article.published
        ? "文章已发布，博客首页和归档已可阅读。"
        : "草稿已保存，只有你能在后台看到。",
    );
    // A list refresh failure must not misreport a successful save or discard the article ID.
    try {
      await loadList();
    } catch {
      notify("文章已保存，但列表刷新失败；可以稍后重新搜索。", true);
    }
  });
});
window.addEventListener("beforeunload", (event) => {
  if (!leaving && (dirty || pageContentEditor.isDirty())) {
    event.preventDefault();
    event.returnValue = "";
  }
});
pagination();

element("avatar-library").addEventListener("click", async () => {
  if (busy) return;
  const choice = await chooseImage();
  if (!choice) return;
  void run(async () => {
    const response = await fetch(choice);
    if (!response.ok) throw new Error("贴纸暂时无法读取，请稍后重试。");
    const blob = await response.blob();
    const transfer = new DataTransfer();
    const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
    transfer.items.add(new File([blob], `avatar-sticker.${extension}`, { type: blob.type || "image/png" }));
    input("avatar-file").files = transfer.files;
    input("avatar-file").dispatchEvent(new Event("change"));
    element("avatar-choice-state").textContent = "已选好头像，点击「保存头像」生效。";
  });
});

element<HTMLFormElement>("avatar-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    const file = input("avatar-file").files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error("头像不能超过 2 MB。");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw new Error("请选择 PNG、JPG 或 WebP 图片。");
    // Decode the selected image before replacing the current portrait.
    const bitmap = await createImageBitmap(file).catch(() => {
      throw new Error("这张图片无法读取，请选择其他图片。");
    });
    bitmap.close();
    await api("avatar", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    element<HTMLImageElement>("current-avatar").src =
      `/api/avatar?v=${Date.now()}`;
    input("avatar-file").value = "";
    if (avatarPreview) { URL.revokeObjectURL(avatarPreview); avatarPreview = undefined; }
    element("avatar-choice-state").textContent = "头像已保存";
    notify("头像已更新，首页和关于页会使用新头像。");
  });
});

let avatarPreview: string | undefined;
input("avatar-file").addEventListener("change", () => {
  const file = input("avatar-file").files?.[0];
  if (!file) return;
  if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  avatarPreview = URL.createObjectURL(file);
  element<HTMLImageElement>("current-avatar").src = avatarPreview;
  element("avatar-choice-state").textContent = `${file.name} · 点击「保存头像」生效`;
});
window.addEventListener("pagehide", () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); });
// The server verifies the cookie before rendering this page.
void run(enterWorkspace);

document.querySelectorAll<HTMLButtonElement>("[data-format]").forEach(button => {
  button.addEventListener("click", () => {
    if (busy) return;
    const format = button.dataset.format;
    if (format === "bold") markdownEditor.insert("**");
    if (format === "italic") markdownEditor.insert("*");
    if (format === "heading") markdownEditor.insert("## ", "");
    if (format === "link") markdownEditor.insert("[", "](https://)");
    if (format === "code") markdownEditor.insert("\n```cpp\n", "\n```\n");
  });
});
document.addEventListener("keydown", event => {
  if (!(event.ctrlKey || event.metaKey) || element("workspace").hidden || busy || document.querySelector("dialog[open]")) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    const activeForm = !element("writing-view").hidden ? form : !element("content-view").hidden ? element<HTMLFormElement>("page-content-form") : element<HTMLFormElement>("avatar-form");
    activeForm.requestSubmit();
  } else if (key === "p") {
    event.preventDefault(); showView("writing"); input("search").focus();
  } else if (key === "v" && event.shiftKey && !element("writing-view").hidden) {
    event.preventDefault(); element("preview-button").click();
  }
});
