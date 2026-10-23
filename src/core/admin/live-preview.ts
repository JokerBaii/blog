import type { EditorView } from "@codemirror/view";

/** One persistent sandboxed document: typing updates its body without reloading the iframe. */
export function mountLivePreview(editor: EditorView, render: (markdown: string) => Promise<{ content_html: string }>) {
  const iframe = document.getElementById("preview") as HTMLIFrameElement;
  const panel = document.getElementById("preview-panel")!;
  const panes = document.getElementById("editor-panes")!;
  const toggle = document.getElementById("preview-button")!;
  const state = document.getElementById("preview-state")!;
  const source = document.getElementById("content") as HTMLTextAreaElement;
  let timer = 0;
  let revision = 0;
  let running = false;
  let pending = false;
  let expectedEditor = -1;
  let expectedPreview = -1;
  let ready = false;
  let lastHtml = "";
  let syncFrame = 0;
  let lastSide: "source" | "preview" = "source";

  iframe.srcdoc = `<!doctype html><html lang="zh-CN" data-preview-theme="${document.documentElement.dataset.adminTheme === "blank" ? "blank" : "manga"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="/fonts/site-fonts.css"><style>
  *{box-sizing:border-box}html{overflow-wrap:anywhere;scrollbar-width:thin}body{margin:0;padding:16px 22px 70px;font:14px/1.95 system-ui,sans-serif;color:#40516b;background:#fff}body:empty::before{content:'这一页的故事，会在这里慢慢展开。';display:block;padding:34px 0;color:#9ca8ba;font-size:12px}h1,h2,h3{line-height:1.55;color:#506b90}h1{font-size:25px}h2{font-size:21px}h3{font-size:17px}p{margin:0 0 1em}img{max-width:100%;height:auto;border-radius:6px}pre{overflow:auto;padding:14px;background:#f3f6fb;border-radius:7px;font:12px/1.8 monospace}code{font-family:monospace}p code,li code{background:#f5eff8;color:#977394;padding:2px 5px;border-radius:4px}blockquote{margin:16px 0;padding:5px 14px;border-left:3px solid #b5cddf;color:#7c8ca3;background:#f6fafd}blockquote p:last-child{margin:0}a{color:#678eae}table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}th,td{padding:8px 12px;border:1px solid #dfe7f0}hr{border:0;border-top:1px dashed #dfd9e8;margin:26px 0}input{accent-color:#9caec7}ul,ol{padding-left:25px}
  html[data-preview-theme=blank] body,html[data-preview-theme=blank] :is(h1,h2,h3,a){color:#222}html[data-preview-theme=blank] :is(pre,blockquote,p code,li code){background:#f6f6f6;color:#555}html[data-preview-theme=blank] blockquote{border-color:#ccc}
  </style></head><body></body></html>`;

  const points = () => {
    const doc = iframe.contentDocument;
    if (!doc || !ready) return [];
    const contentTop = editor.documentTop - editor.scrollDOM.getBoundingClientRect().top + editor.scrollDOM.scrollTop;
    const anchors = [...doc.querySelectorAll<HTMLElement>("body > [data-preview-line]")].map(node => {
      const line = Math.max(1, Math.min(editor.state.doc.lines, Number(node.dataset.previewLine) || 1));
      return { source: contentTop + editor.lineBlockAt(editor.state.doc.line(line).from).top, preview: node.getBoundingClientRect().top + doc.documentElement.scrollTop };
    });
    const sourceMax = Math.max(0, editor.scrollDOM.scrollHeight - editor.scrollDOM.clientHeight);
    const previewMax = Math.max(0, doc.documentElement.scrollHeight - doc.documentElement.clientHeight);
    // Clamp both endpoints; paragraphs near the bottom cannot scroll beyond the pane.
    return [{ source: 0, preview: 0 }, ...anchors.filter(p => p.source > 0 && p.preview > 0 && p.source < sourceMax && p.preview < previewMax), { source: sourceMax, preview: previewMax }];
  };
  const sync = (side: "source" | "preview") => {
    if (panel.hidden || !ready) return;
    const doc = iframe.contentDocument!;
    const positions = points();
    const from = side === "source" ? "source" : "preview";
    const to = side === "source" ? "preview" : "source";
    const y = side === "source" ? editor.scrollDOM.scrollTop : doc.documentElement.scrollTop;
    let index = positions.findIndex((point, i) => i > 0 && point[from] >= y);
    if (index < 1) index = positions.length - 1;
    if (index < 1) return;
    const a = positions[index - 1], b = positions[index];
    const progress = Math.max(0, Math.min(1, (y - a[from]) / (b[from] - a[from] || 1)));
    const target = a[to] + progress * (b[to] - a[to]);
    if (side === "source") {
      if (Math.abs(doc.documentElement.scrollTop - target) < 1) return;
      expectedPreview = target;
      doc.documentElement.scrollTop = target;
      requestAnimationFrame(() => { expectedPreview = -1; });
    } else {
      if (Math.abs(editor.scrollDOM.scrollTop - target) < 1) return;
      expectedEditor = target;
      editor.scrollDOM.scrollTop = target;
      requestAnimationFrame(() => { expectedEditor = -1; });
    }
  };
  const scheduleSync = (side: "source" | "preview") => {
    lastSide = side;
    cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => sync(side));
  };
  editor.scrollDOM.addEventListener("scroll", () => {
    if (expectedEditor >= 0 && Math.abs(editor.scrollDOM.scrollTop - expectedEditor) < 2) { expectedEditor = -1; return; }
    scheduleSync("source");
  }, { passive: true });
  const paint = () => {
    if (!ready || panel.hidden) return;
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = lastHtml;
    doc.querySelectorAll("img").forEach(image => image.addEventListener("load", () => scheduleSync(lastSide), { once: true }));
    scheduleSync("source");
  };
  iframe.addEventListener("load", () => {
    if (!iframe.contentDocument) return;
    ready = true;
    iframe.contentWindow!.addEventListener("scroll", () => {
      const y = iframe.contentDocument!.documentElement.scrollTop;
      if (expectedPreview >= 0 && Math.abs(y - expectedPreview) < 2) { expectedPreview = -1; return; }
      scheduleSync("preview");
    }, { passive: true });
    iframe.contentDocument.addEventListener("click", event => {
      if ((event.target as HTMLElement)?.closest("a")) event.preventDefault();
    });
    paint();
    void iframe.contentDocument.fonts.ready.then(() => scheduleSync(lastSide));
  });
  const refresh = async () => {
    if (panel.hidden) return;
    if (running) { pending = true; return; }
    const version = revision;
    running = true;
    state.textContent = "正在更新…";
    try {
      const result = source.value.trim() ? await render(source.value) : { content_html: "" };
      if (version !== revision) { pending = true; return; }
      lastHtml = result.content_html;
      paint();
      state.textContent = "";
    } catch (error) {
      state.textContent = error instanceof Error ? `预览未更新：${error.message}` : "预览暂不可用，正文仍可继续编辑。";
    } finally {
      running = false;
      if (pending) { pending = false; void refresh(); }
    }
  };
  const update = () => {
    revision++;
    clearTimeout(timer);
    timer = window.setTimeout(() => { void refresh(); }, 300);
  };
  const visible = (show: boolean) => {
    panel.hidden = !show;
    panes.classList.toggle("preview-closed", !show);
    toggle.setAttribute("aria-expanded", String(show));
    if (show) update();
    editor.requestMeasure();
  };
  toggle.addEventListener("click", () => visible(panel.hidden));
  document.getElementById("close-preview")!.addEventListener("click", () => visible(false));
  source.addEventListener("input", update);
  window.addEventListener("resize", () => scheduleSync(lastSide));
  return { update };
}
