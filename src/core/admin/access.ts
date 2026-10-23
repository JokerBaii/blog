// Share a request within each page visit; never infer permissions from local storage.
let pending: Promise<boolean> | undefined;
export function isAdministrator(refresh = false) {
  if (!pending || refresh) {
    pending = fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" })
      .then(async response => response.ok && (await response.json()).authenticated === true)
      .catch(() => false);
  }
  return pending;
}
document.addEventListener("astro:before-swap", () => { pending = undefined; });
