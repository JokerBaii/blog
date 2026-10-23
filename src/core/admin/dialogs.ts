import choices from "../data/sticker-choices.json";

export function confirmAction(message: string, title = "确认操作") {
  const dialog = document.getElementById("confirm-dialog") as HTMLDialogElement;
  if (dialog.open) return Promise.resolve(false);
  document.getElementById("confirm-title")!.textContent = title;
  document.getElementById("confirm-text")!.textContent = message;
  dialog.returnValue = "cancel";
  return new Promise<boolean>(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
  });
}

export function chooseImage(current = "") {
  const dialog = document.getElementById("image-dialog") as HTMLDialogElement;
  const grid = document.getElementById("image-grid")!;
  if (dialog.open) return Promise.resolve<string | undefined>(undefined);
  const filters = document.getElementById("image-filters")!;
  const groups = [{ id: "all", name: "全部" }, { id: "chibi", name: "Q 版贴纸" }, { id: "cutout", name: "透明立绘" }, { id: "portrait", name: "插画原图" }];
  let selectedGroup = "all";
  const render = () => {
    grid.replaceChildren();
    filters.replaceChildren();
    for (const group of groups) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.textContent = `${group.name} ${choices.filter(choice => group.id === "all" || choice.group === group.id).length}`;
      tab.dataset.imageGroup = group.id;
      tab.setAttribute("aria-pressed", String(group.id === selectedGroup));
      tab.addEventListener("click", () => {
        selectedGroup = group.id;
        render();
        filters.querySelector<HTMLButtonElement>("[aria-pressed='true']")?.focus();
      });
      filters.append(tab);
    }
    for (const choice of choices.filter(choice => selectedGroup === "all" || choice.group === selectedGroup)) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = choice.name;
      button.setAttribute("aria-label", choice.name);
      button.setAttribute("aria-pressed", String(current === choice.src));
      button.dataset.imageSource = choice.src;
      const image = document.createElement("img");
      image.src = choice.thumbnail ?? choice.src;
      image.alt = "";
      image.width = 80;
      image.height = 80;
      image.loading = "lazy";
      button.append(image);
      button.addEventListener("click", () => dialog.close(choice.src));
      grid.append(button);
    }
  };
  render();
  dialog.returnValue = "";
  return new Promise<string | undefined>(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue || undefined), { once: true });
    dialog.showModal();
  });
}
document.getElementById("image-close")!.addEventListener("click", () => {
  (document.getElementById("image-dialog") as HTMLDialogElement).close("");
});
for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog")) {
  dialog.addEventListener("click", event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close("");
  });
}
