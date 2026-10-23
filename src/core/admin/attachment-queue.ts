import { browserUuid } from "./browser";
type Pending = { key: string; file: File };

// Files stay in this tab until Save; IndexedDB only carries them across an expired-session login.
export function mountAttachmentQueue(options: {
  changed: () => void; busy: () => boolean; notify: (message: string, error?: boolean) => void;
  insert: (markdown: string) => void; remove: (href: string) => void;
}) {
  const input = document.getElementById("upload-file") as HTMLInputElement;
  const list = document.getElementById("pending-attachments")!;
  const label = document.getElementById("upload-filename")!;
  let pending: Pending[] = [];
  const reference = (key: string) => `attachment:pending-${key}`;
  const markdown = (item: Pending, href: string) => `[${item.file.name.replace(/[\\\[\]]/g, "\\$&")}](${href})`;
  const render = () => {
    list.replaceChildren();
    label.textContent = pending.length ? `${pending.length} 个附件，随文章一起提交` : "可多选，也可以直接拖入文件";
    for (const item of pending) {
      const row = document.createElement("li");
      row.dataset.pendingAttachment = item.key;
      const name = document.createElement("span");
      name.textContent = `${item.file.name} · ${(item.file.size / 1024).toFixed(1)} KB`;
      const state = document.createElement("small");
      state.textContent = "已插入正文 · 待提交";
      const remove = document.createElement("button");
      remove.type = "button"; remove.textContent = "移除";
      remove.addEventListener("click", () => {
        if (options.busy()) return;
        pending = pending.filter(other => other !== item);
        options.remove(reference(item.key));
        options.changed(); render();
      });
      row.append(name, state, remove); list.append(row);
    }
  };
  const add = (files: File[]) => {
    if (options.busy()) return;
    const added: Pending[] = [];
    for (const file of files) {
      if (!file.size || new TextEncoder().encode(file.name).length > 255) { options.notify(`“${file.name}”为空或文件名过长，请换一个文件。`, true); continue; }
      if (pending.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
      const item = { key: browserUuid(), file };
      pending.push(item); added.push(item);
    }
    input.value = "";
    if (added.length) {
      options.insert(added.map(item => markdown(item, reference(item.key))).join("\n"));
      options.changed();
    }
    render();
  };
  input.addEventListener("change", () => add([...input.files ?? []]));
  document.getElementById("attach-files")!.addEventListener("click", () => input.click());
  const drop = document.querySelector<HTMLElement>(".editor")!;
  drop.addEventListener("dragover", event => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "copy"; drop.classList.add("file-dragover");
  });
  drop.addEventListener("dragleave", event => { if (!drop.contains(event.relatedTarget as Node)) drop.classList.remove("file-dragover"); });
  drop.addEventListener("drop", event => {
    drop.classList.remove("file-dragover");
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault(); event.stopPropagation(); add([...event.dataTransfer.files]);
  }, true);
  const tabKey = () => {
    const key = "jokerbai-attachment-tab-v1";
    let id = sessionStorage.getItem(key);
    if (!id) { id = browserUuid(); sessionStorage.setItem(key, id); }
    return id;
  };
  const store = async (mode: "save" | "restore" | "clear") => {
    const key = tabKey();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("jokerbai-desk-files", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("pending");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Pending[]>((resolve, reject) => {
        const transaction = db.transaction("pending", "readwrite");
        const object = transaction.objectStore("pending");
        let restored: Pending[] = [];
        if (mode === "save") object.put({ files: pending, createdAt: Date.now() }, key);
        else if (mode === "clear") object.delete(key);
        else {
          const request = object.get(key);
          request.onsuccess = () => {
            const result = request.result;
            if (result && Date.now() - result.createdAt < 86400000) restored = result.files;
            object.delete(key);
          };
        }
        transaction.oncomplete = () => resolve(restored);
        transaction.onabort = transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  };
  render();
  return {
    hasPending: () => pending.length > 0,
    reset: () => { pending = []; input.value = ""; render(); },
    retainForLogin: async () => { if (pending.length) await store("save"); },
    restoreAfterLogin: async () => { pending = await store("restore"); render(); if (pending.length) options.changed(); },
    clearRecovery: async () => { await store("clear"); },
    appendTo: (body: FormData) => { for (const item of pending) body.append(`file-${item.key}`, item.file); },
  };
}
