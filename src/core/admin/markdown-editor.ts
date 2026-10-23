import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentUnit } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { attachmentLinkChanges } from "./attachment-links";

export function mountMarkdownEditor(textarea: HTMLTextAreaElement) {
  const parent = document.getElementById("markdown-editor")!;
  const editable = new Compartment();
  const removedAttachments = new Set<string>();
  let cleanupQueued = false;
  let replacing = false;
  const colors = HighlightStyle.define([
    { tag: tags.heading, color: "#527db3", fontWeight: "700" },
    { tag: tags.strong, color: "#8d69a8", fontWeight: "700" },
    { tag: tags.emphasis, color: "#b46b92", fontStyle: "italic" },
    { tag: [tags.monospace, tags.string], color: "#b67b5f" },
    { tag: [tags.url, tags.link], color: "#499886" },
    { tag: tags.quote, color: "#62966c" },
    { tag: tags.meta, color: "#96a4b6" },
    { tag: tags.processingInstruction, color: "#527db3" },
  ]);
  const updateStatus = (view: EditorView) => {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    document.getElementById("cursor-position")!.textContent = `行 ${line.number}，列 ${pos - line.from + 1}`;
    document.getElementById("word-count")!.textContent = `${view.state.doc.length} 字符`;
  };
  const extensions = [
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), history(), drawSelection(), dropCursor(), rectangularSelection(), bracketMatching(), highlightSelectionMatches(),
        markdownLanguage, syntaxHighlighting(colors), indentUnit.of("  "), EditorView.lineWrapping,
        keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        editable.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
        EditorView.contentAttributes.of({ "aria-label": "Markdown 正文", spellcheck: "false" }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !replacing) {
            textarea.value = update.state.doc.toString();
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            // History transactions bypass filters; clean restored references after the update.
            if (removedAttachments.size && !cleanupQueued) {
              cleanupQueued = true;
              queueMicrotask(() => {
                cleanupQueued = false;
                if (!parent.isConnected) return;
                const changes = attachmentLinkChanges(update.view.state.doc.toString(), removedAttachments);
                if (changes.length) update.view.dispatch({ changes, annotations: Transaction.addToHistory.of(false) });
              });
            }
          }
          updateStatus(update.view);
        }),
        EditorView.theme({
          "&": { backgroundColor: "#ffffff", color: "#40516b", height: "100%", fontSize: "14px" },
          ".cm-content": { fontFamily: '"Maple Mono", "HarmonyOS Sans SC", monospace', padding: "14px 0 90px", caretColor: "#6d91b4" },
          ".cm-line": { padding: "0 22px 0 6px", lineHeight: "25px" },
          ".cm-gutters": { backgroundColor: "#ffffff", color: "#9aadc2", border: "none", minWidth: "49px" },
          ".cm-gutterElement": { padding: "0 12px 0 10px" },
          ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#527db3" },
          ".cm-activeLine": { backgroundColor: "#89b4df12" },
          ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#6d91b4" },
          ".cm-selectionBackground": { backgroundColor: "#d4e3f2" },
          "&.cm-focused .cm-selectionBackground": { backgroundColor: "#b7d4f2" },
          ".cm-selectionMatch": { backgroundColor: "#d9e8f680", outline: "1px solid #a7c6e0" },
          "&.cm-focused": { outline: "none" },
          ".cm-scroller": { overflow: "auto", fontFamily: '"Maple Mono", "HarmonyOS Sans SC", monospace' },
          ".cm-searchMatch": { backgroundColor: "#fff2c7", outline: "1px solid #d8bc70" },
          ".cm-searchMatch-selected": { backgroundColor: "#d7e8fa" },
          ".cm-panels": { backgroundColor: "#f3f7fc", color: "#47536b" },
          ".cm-textfield": { backgroundColor: "#fff", color: "#47536b", border: "1px solid #dfe7f0" },
          ".cm-button": { background: "#fff", color: "#47536b", border: "1px solid #dfe7f0" },
        }, { dark: false }),
      ];
  const view = new EditorView({ parent, state: EditorState.create({ doc: textarea.value, extensions }) });
  textarea.hidden = true;
  textarea.addEventListener("invalid", event => {
    event.preventDefault();
    view.focus();
    document.getElementById("message")!.textContent = "先写一点正文，再保存吧。";
  });
  updateStatus(view);
  return {
    view,
    setContent(value: string) {
      replacing = true;
      removedAttachments.clear();
      // Reset history when opening another article so undo cannot restore another draft.
      view.setState(EditorState.create({ doc: value, extensions }));
      updateStatus(view);
      replacing = false;
    },
    focus: () => view.focus(),
    setReadOnly(value: boolean) { view.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(value), EditorView.editable.of(!value)]) }); },
    removeAttachment(href: string) {
      removedAttachments.add(href);
      const changes = attachmentLinkChanges(view.state.doc.toString(), href);
      // Undo must not resurrect a link to a file that has already been removed.
      if (changes.length) view.dispatch({ changes, annotations: Transaction.addToHistory.of(false) });
    },
    insert(before: string, after = before) {
      const selection = view.state.selection.main;
      const text = view.state.sliceDoc(selection.from, selection.to);
      view.dispatch({ changes: { from: selection.from, to: selection.to, insert: before + text + after }, selection: { anchor: selection.from + before.length, head: selection.from + before.length + text.length } });
      view.focus();
    },
  };
}
