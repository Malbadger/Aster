import React from "react";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection } from "@codemirror/view";

function languageFor(path: string): Extension {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(extension ?? "")) return javascript({ typescript: extension?.startsWith("t"), jsx: extension?.endsWith("x") });
  if (extension === "py") return python();
  if (extension === "json") return json();
  if (["md", "mdx"].includes(extension ?? "")) return markdown();
  return [];
}

const lawEditorTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--law-color-text)", backgroundColor: "var(--law-editor-bg)" },
  ".cm-scroller": { fontFamily: '"IBM Plex Mono", "Cascadia Code", "DejaVu Sans Mono", monospace', fontSize: "13px", lineHeight: "1.65", overflow: "auto" },
  ".cm-content": { caretColor: "var(--law-color-accent-strong)", padding: "12px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--law-color-accent-strong)" },
  ".cm-gutters": { backgroundColor: "var(--law-editor-gutter)", color: "var(--law-color-text-faint)", border: "none", borderRight: "1px solid var(--law-color-border)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--law-color-accent) 6%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--law-color-accent) 25%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--law-color-bg-panel)", color: "var(--law-color-text)" },
  ".cm-searchMatch": { backgroundColor: "rgba(224,138,114,.25)", outline: "1px solid var(--law-color-warn)" },
  "&.cm-focused": { outline: "none" },
});

export function CodeEditor({ path, value, onChange }: { path: string; value: string; onChange: (value: string) => void }): React.JSX.Element {
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<EditorView>();
  const changeHandler = React.useRef(onChange);
  changeHandler.current = onChange;

  React.useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({ doc: value, extensions: [
      lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), drawSelection(), dropCursor(),
      EditorState.allowMultipleSelections.of(true), indentOnInput(), bracketMatching(), closeBrackets(), autocompletion(),
      rectangularSelection(), highlightActiveLine(), search(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]), languageFor(path), lawEditorTheme,
      EditorView.updateListener.of((update) => { if (update.docChanged) changeHandler.current(update.state.doc.toString()); }),
    ] });
    view.current = new EditorView({ state, parent: host.current });
    return () => { view.current?.destroy(); view.current = undefined; };
  }, [path]);

  React.useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  return <div className="code-editor" ref={host} aria-label={`Editing ${path}`} />;
}
