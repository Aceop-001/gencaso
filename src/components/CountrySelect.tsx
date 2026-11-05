"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { JURISDICTIONS, type CountryCode } from "@/lib/tax";
import { Flag } from "./Flag";

/** Flag-based country selector: accessible listbox with full keyboard support. */
export function CountrySelect({
  value,
  onChange,
  size = "lg",
}: {
  value: CountryCode;
  onChange: (c: CountryCode) => void;
  size?: "lg" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = JURISDICTIONS.find((j) => j.code === value)!;

  useEffect(() => {
    if (!open) return;
    setHi(JURISDICTIONS.findIndex((j) => j.code === value));
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, value]);

  // Keep the keyboard-highlighted option visible in the scrolling list
  useEffect(() => {
    if (open) document.getElementById(`${id}-${JURISDICTIONS[hi]?.code}`)?.scrollIntoView({ block: "nearest" });
  }, [open, hi, id]);

  const pick = (i: number) => {
    onChange(JURISDICTIONS[i].code);
    setOpen(false);
    btn.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % JURISDICTIONS.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + JURISDICTIONS.length) % JURISDICTIONS.length); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(hi); }
    else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
  };

  const lg = size === "lg";
  return (
    <div ref={root} className="relative" onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`Tax country: ${current.name}`}
        onClick={() => setOpen((o) => !o)}
        className={`group flex w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 text-left transition hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${lg ? "h-16 px-4" : "h-11 px-3"}`}
      >
        <Flag code={current.code} size={lg ? 28 : 22} />
        <span className="flex-1 truncate">
          <span className={`block font-medium text-ink ${lg ? "text-[15px]" : "text-sm"}`}>{current.name}</span>
          {lg && <span className="block text-[11px] uppercase tracking-[0.18em] text-ink-3">{current.currency} · tax rules</span>}
        </span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className={`text-ink-3 transition ${open ? "rotate-180" : ""}`}>
          <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            id={`${id}-list`}
            role="listbox"
            aria-activedescendant={`${id}-${JURISDICTIONS[hi]?.code}`}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute right-0 z-50 mt-2 max-h-[min(60vh,420px)] w-full min-w-[230px] overflow-y-auto rounded-2xl border border-line-strong bg-surface-solid/[.97] p-1.5 shadow-[0_24px_60px_-12px_rgba(0,0,0,.9)] backdrop-blur-xl"
          >
            {JURISDICTIONS.map((j, i) => (
              <li
                key={j.code}
                id={`${id}-${j.code}`}
                role="option"
                aria-selected={j.code === value}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(i)}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${i === hi ? "bg-blue/15 text-ink" : "text-ink-2"}`}
              >
                <Flag code={j.code} />
                <span className="flex-1">{j.name}</span>
                <span className="font-mono text-[11px] text-ink-3">{j.currency}</span>
                {j.code === value && <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_10px_var(--cyan)]" />}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
