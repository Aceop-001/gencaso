"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ROADMAP_ITEMS } from "./ComingSoon";

/** The header's ⋯ button: a small panel with what Gencaso builds next, plus a link to the legal page. */
export function MoreMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label="More: coming soon"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`grid h-8 w-8 place-items-center rounded-full border text-ink-2 transition hover:border-line-strong hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${open ? "border-line-strong bg-surface-2 text-white" : "border-line"}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Coming soon"
          className="absolute right-0 top-11 z-50 w-[min(380px,calc(100vw-32px))] overflow-hidden rounded-3xl border border-line-strong normal-case tracking-normal shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)]"
          style={{ background: "linear-gradient(180deg, rgba(16,26,56,.97), rgba(8,14,32,.97))" }}
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-[#c9bcff]">
              <span className="h-1.5 w-1.5 rounded-full bg-violet shadow-[0_0_10px_var(--violet)]" />
              Coming soon
            </div>
            <span className="text-[11px] text-ink-3">Not live yet</span>
          </div>
          <ul className="max-h-[min(440px,65vh)] space-y-1 overflow-y-auto p-2">
            {ROADMAP_ITEMS.map((it) => (
              <li key={it.title} className="flex gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-surface-2">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-cyan">
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{it.icon}</svg>
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">{it.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{it.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-ink-3">
            <span>Follow the build in the footer links</span>
            <span className="flex gap-4">
              <Link href="/docs" className="text-ink-2 hover:text-white" onClick={() => setOpen(false)}>Docs</Link>
              <Link href="/legal" className="text-ink-2 hover:text-white" onClick={() => setOpen(false)}>Legal</Link>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
