"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { domToBlocks, pasteToHtml } from "@/lib/client/rich-text";
import { isSafeLink, type Block } from "@/lib/docs/model";
import { AlignCenter, AlignLeft, AlignRight, LinkIcon, ListBullet, ListNumber, Quote } from "./icons";

const DRAFT_KEY = "ft-draft";

export interface EditorHandle {
  clear(): void;
}

// execCommand is deprecated on paper, but it is still the only browser API that
// keeps native undo/redo working in a contentEditable without a large editor library.
const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);

const INLINE = [
  { cmd: "bold", label: "Bold", glyph: <b>B</b> },
  { cmd: "italic", label: "Italic", glyph: <i className="font-serif">I</i> },
  { cmd: "underline", label: "Underline", glyph: <u>U</u> },
  { cmd: "strikeThrough", label: "Strikethrough", glyph: <s>S</s> },
];
const BLOCKS = [
  { value: "h1", label: "Heading 1", glyph: "H1" },
  { value: "h2", label: "Heading 2", glyph: "H2" },
  { value: "blockquote", label: "Quote", glyph: <Quote /> },
];
const LISTS = [
  { cmd: "insertUnorderedList", label: "Bulleted list", glyph: <ListBullet /> },
  { cmd: "insertOrderedList", label: "Numbered list", glyph: <ListNumber /> },
];
const ALIGN = [
  { cmd: "justifyLeft", label: "Align left", glyph: <AlignLeft /> },
  { cmd: "justifyCenter", label: "Align center", glyph: <AlignCenter /> },
  { cmd: "justifyRight", label: "Align right", glyph: <AlignRight /> },
];

function ToolButton({ label, active, onRun, children }: { label: string; active?: boolean; onRun: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault() /* keep the text selection */}
      onClick={onRun}
      className={`flex size-9 shrink-0 items-center justify-center rounded-md text-[13px] font-medium transition ${active ? "bg-accent-soft text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

export const Editor = forwardRef<EditorHandle, { onChange: (blocks: Block[]) => void; disabled?: boolean }>(function Editor({ onChange, disabled }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(true);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("https://");
  const [linkError, setLinkError] = useState(false);
  const savedRange = useRef<Range | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const sync = useCallback(() => {
    const root = el.current;
    if (!root) return;
    const blocks = domToBlocks(root);
    setEmpty(!root.textContent?.trim() && !root.querySelector("li"));
    onChange(blocks);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try { sessionStorage.setItem(DRAFT_KEY, root.innerHTML); } catch { /* no draft recovery in this browser */ }
    }, 200);
  }, [onChange]);

  const saveNow = useCallback(() => {
    clearTimeout(timer.current);
    try { if (el.current) sessionStorage.setItem(DRAFT_KEY, el.current.innerHTML); } catch { /* as above */ }
  }, []);

  useEffect(() => {
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      // Drafts are re-sanitized so stored HTML can never add anything the editor wouldn't produce itself.
      if (draft && el.current) el.current.innerHTML = pasteToHtml(draft, "");
    } catch { /* start empty */ }
    sync();
    // The Google sign-in redirect leaves the page; the draft must be on disk first.
    window.addEventListener("pagehide", saveNow);
    return () => window.removeEventListener("pagehide", saveNow);
  }, [sync, saveNow]);

  useImperativeHandle(ref, () => ({
    clear() {
      if (!el.current) return;
      el.current.innerHTML = "";
      sync();
    },
  }), [sync]);

  useEffect(() => {
    const update = () => {
      const sel = document.getSelection();
      if (!sel || !el.current || !el.current.contains(sel.anchorNode)) return;
      const state: Record<string, boolean> = {};
      for (const { cmd } of [...INLINE, ...LISTS, ...ALIGN]) state[cmd] = document.queryCommandState(cmd);
      state.block = false;
      state[`block:${String(document.queryCommandValue("formatBlock")).toLowerCase()}`] = true;
      setActive(state);
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  const run = (fn: () => void) => {
    el.current?.focus();
    exec("styleWithCSS", "false");
    exec("defaultParagraphSeparator", "p");
    fn();
    sync();
  };

  const openLink = () => {
    const sel = document.getSelection();
    savedRange.current = sel && sel.rangeCount && el.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    setLinkValue("https://");
    setLinkError(false);
    setLinkOpen((v) => !v);
  };

  const applyLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSafeLink(linkValue) || linkValue === "https://") return setLinkError(true);
    const range = savedRange.current;
    run(() => {
      if (range) {
        const sel = document.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      if (range?.collapsed !== false) exec("insertHTML", pasteToHtml(`<a href="${linkValue.replace(/"/g, "%22")}">${linkValue.replace(/</g, "&lt;")}</a>`, "").replace(/^<p>|<\/p>$/g, ""));
      else exec("createLink", linkValue);
    });
    setLinkOpen(false);
  };

  const divider = <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden="true" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-2 py-1.5">
        {INLINE.map((t) => <ToolButton key={t.cmd} label={t.label} active={active[t.cmd]} onRun={() => run(() => exec(t.cmd))}>{t.glyph}</ToolButton>)}
        {divider}
        {BLOCKS.map((t) => {
          const on = active[`block:${t.value}`];
          return <ToolButton key={t.value} label={t.label} active={on} onRun={() => run(() => exec("formatBlock", on ? "p" : t.value))}>{t.glyph}</ToolButton>;
        })}
        {divider}
        {LISTS.map((t) => <ToolButton key={t.cmd} label={t.label} active={active[t.cmd]} onRun={() => run(() => exec(t.cmd))}>{t.glyph}</ToolButton>)}
        {divider}
        {ALIGN.map((t) => <ToolButton key={t.cmd} label={t.label} active={active[t.cmd]} onRun={() => run(() => exec(t.cmd))}>{t.glyph}</ToolButton>)}
        {divider}
        <ToolButton label="Add link" active={linkOpen} onRun={openLink}><LinkIcon /></ToolButton>
      </div>
      {linkOpen && (
        <form onSubmit={applyLink} className="fade-in flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
          <label htmlFor="link-url" className="text-[13px] text-muted">Link address</label>
          <input
            id="link-url"
            autoFocus
            value={linkValue}
            onChange={(e) => { setLinkValue(e.target.value); setLinkError(false); }}
            aria-invalid={linkError}
            className="min-h-9 min-w-40 flex-1 rounded-md border border-line bg-surface px-2.5 text-sm"
          />
          <button type="submit" className="min-h-9 rounded-md bg-accent-soft px-3 text-sm font-medium text-accent-ink">Apply</button>
          {linkError && <span role="alert" className="w-full text-[13px] text-bad">Enter a full web address, starting with https://</span>}
        </form>
      )}
      <div className="relative min-h-[320px] flex-1 overflow-y-auto">
        <div
          ref={el}
          role="textbox"
          aria-multiline="true"
          aria-label="Your text"
          contentEditable={!disabled}
          suppressContentEditableWarning
          data-empty={empty}
          data-placeholder="Paste your essay or paragraph here, or start typing."
          spellCheck
          onInput={sync}
          onPaste={(e) => {
            e.preventDefault();
            const html = pasteToHtml(e.clipboardData.getData("text/html") || null, e.clipboardData.getData("text/plain"));
            if (html) exec("insertHTML", html);
            sync();
          }}
          onDrop={(e) => e.preventDefault()}
          className="editor-surface doc-text min-h-full px-5 py-5 sm:px-8 sm:py-7"
        />
      </div>
    </div>
  );
});
