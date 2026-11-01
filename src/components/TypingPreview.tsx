"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { blockText, type Block, type Span } from "@/lib/docs/model";
import { Pause, Play, Restart } from "./icons";
import { Button } from "./ui";

const CHARS_PER_WORD = 5;

function SpanView({ span }: { span: Span }) {
  const lines = span.text.split("\n");
  let node: React.ReactNode = lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{l}</Fragment>);
  if (span.code) node = <code>{node}</code>;
  if (span.bold) node = <strong>{node}</strong>;
  if (span.italic) node = <em>{node}</em>;
  if (span.underline) node = <u>{node}</u>;
  if (span.strike) node = <s>{node}</s>;
  if (span.link) node = <span className="text-accent-ink underline">{node}</span>;
  return <>{node}</>;
}

function ProgressiveText({ blocks, shown, caret }: { blocks: Block[]; shown: number; caret: boolean }) {
  const out: React.ReactNode[] = [];
  let left = shown;
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i]!;
    const length = blockText(b).length;
    const spans: Span[] = [];
    let rem = left;
    for (const s of b.spans) {
      if (rem <= 0) break;
      spans.push({ ...s, text: s.text.slice(0, rem) });
      rem -= s.text.length;
    }
    const done = left >= length && i < blocks.length - 1;
    const Tag = (b.style !== "normal" ? b.style : b.quote ? "blockquote" : "p") as "p";
    const indent = b.list ? { marginLeft: `${(b.list.level + 1) * 1.25}em` } : undefined;
    out.push(
      <Tag key={i} style={{ textAlign: b.align, ...indent }}>
        {b.list && <span aria-hidden="true" className="mr-2 text-muted">{b.list.ordered ? "#" : "•"}</span>}
        {spans.map((s, j) => <SpanView key={j} span={s} />)}
        {!done && caret && <span className="caret" aria-hidden="true" />}
        {!spans.length && !(!done && caret) && <br />}
      </Tag>,
    );
    if (!done) break;
    left -= length + 1;
  }
  return <>{out}</>;
}

export function TypingPreview({ blocks, visible }: { blocks: Block[]; visible: boolean }) {
  const total = useMemo(() => blocks.reduce((n, b) => n + blockText(b).length + 1, 0), [blocks]);
  const [wpm, setWpm] = useState(120);
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const position = useRef(0);
  const speed = useRef(wpm);
  speed.current = wpm;

  useEffect(() => {
    position.current = 0;
    setShown(0);
    setPlaying(false);
  }, [blocks]);

  useEffect(() => {
    if (!visible) setPlaying(false);
  }, [visible]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      position.current += ((now - last) / 1000) * (speed.current * CHARS_PER_WORD) / 60;
      last = now;
      if (position.current >= total) {
        position.current = total;
        setShown(total);
        setPlaying(false);
        return;
      }
      setShown(Math.floor(position.current));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, total]);

  const finished = total > 0 && shown >= total;
  const seconds = Math.max(0, total - shown) / ((wpm * CHARS_PER_WORD) / 60);
  const start = () => {
    if (finished) { position.current = 0; setShown(0); }
    setPlaying((p) => !p);
  };
  const restart = () => { position.current = 0; setShown(0); setPlaying(true); };
  const percent = total ? Math.min(100, (shown / total) * 100) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-testid="preview-banner" className="flex items-start gap-2.5 border-b border-line bg-warn-soft px-4 py-2.5 text-[13px] leading-relaxed text-warn">
        <strong className="shrink-0 rounded bg-warn/15 px-1.5 text-[11px] font-bold uppercase leading-5 tracking-wide">Preview only</strong>
        <span>This animation runs in your browser for presentation. It doesn't type into Google Docs or change any document.</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <Button variant="primary" onClick={start} disabled={!total} className="min-w-24">
          {playing ? <Pause /> : <Play />}
          {playing ? "Pause" : shown > 0 && !finished ? "Resume" : "Play"}
        </Button>
        <Button onClick={restart} disabled={!total}><Restart />Restart</Button>
        <label className="flex min-w-52 flex-1 items-center gap-3 text-[13px] text-muted">
          <span className="shrink-0">Speed</span>
          <input
            type="range"
            min={20}
            max={600}
            step={10}
            value={wpm}
            onChange={(e) => setWpm(Number(e.target.value))}
            aria-valuetext={`${wpm} words per minute`}
            className="min-w-0 flex-1 accent-(--accent)"
          />
          <span className="w-16 shrink-0 text-right tabular-nums text-ink">{wpm} wpm</span>
        </label>
      </div>

      <div className="h-1 bg-surface-2" role="progressbar" aria-label="Preview position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <div className="brand-gradient h-full" style={{ width: `${percent}%` }} />
      </div>

      <div className="min-h-[320px] flex-1 overflow-y-auto bg-surface-2/60 p-4 sm:p-6">
        {total ? (
          <div className="doc-text mx-auto max-w-2xl rounded-lg border border-line bg-surface p-6 sm:p-10">
            <ProgressiveText blocks={blocks} shown={shown} caret={!finished} />
          </div>
        ) : (
          <p className="pt-20 text-center text-sm text-muted">Add text in the editor, then come back to play the preview.</p>
        )}
      </div>

      <div className="border-t border-line px-4 py-2 text-xs tabular-nums text-muted" data-testid="preview-status">
        {finished ? "Preview finished" : total ? `${Math.ceil(seconds)}s remaining at this speed` : "Nothing to preview yet"}
      </div>
    </div>
  );
}
