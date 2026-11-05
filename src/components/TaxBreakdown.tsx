"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { fmtMoney } from "@/lib/format";
import type { Jurisdiction, TaxResult } from "@/lib/tax";

function Section({ title, count, children, defaultOpen = false, tone }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean; tone?: "warn" }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-line first:border-t-0">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm text-ink transition hover:bg-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan/50">
        <span className="flex-1 font-medium">{title}</span>
        {count !== undefined && <span className={`num rounded-full px-2 py-0.5 text-[11px] ${tone === "warn" ? "bg-warn/10 text-warn" : "bg-surface-2 text-ink-3"}`}>{count}</span>}
        <svg width="12" height="12" viewBox="0 0 14 14" className={`text-ink-3 transition ${open ? "rotate-180" : ""}`} aria-hidden><path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="px-5 pb-5 text-sm leading-relaxed text-ink-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const List = ({ items }: { items: string[] }) => (
  <ul className="space-y-2">
    {items.map((x) => (
      <li key={x} className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-cyan/70" />{x}</li>
    ))}
  </ul>
);

export function TaxBreakdown({ result, j }: { result: TaxResult; j: Jurisdiction }) {
  const m = (n: number) => fmtMoney(n, result.currency, j.locale);
  return (
    <div className="glass overflow-hidden rounded-3xl">
      <Section title="How this tax was calculated" defaultOpen>
        <div className="space-y-3">
          {result.lines.map((l) => (
            <div key={l.label} className="rounded-2xl border border-line bg-bg/40 p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <div className="flex-1 font-medium text-ink">{l.label}</div>
                <div className="num font-mono text-ink">{m(l.taxLocal)}</div>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
                <span>{l.category}</span>
                <span className="num">Base {m(l.baseLocal)}</span>
                {l.rate && <span>Rate {l.rate}</span>}
                <span className="text-cyan/80">{l.rule}</span>
              </div>
              <p className="mt-2 text-[13px] text-ink-2">{l.explanation}</p>
            </div>
          ))}
          <div className="grid gap-x-8 gap-y-1 pt-1 text-xs text-ink-3 sm:grid-cols-2">
            <span>Module {result.moduleVersion}</span>
            <span>Rules: {result.rulesEffective}</span>
            <span>Tax year: {result.taxYear.label}</span>
            <span>{result.eventsInYear.toLocaleString()} events in year</span>
            {result.usdRate && <span className="num">USD conversion: 1 USD = {result.usdRate.rate} {result.currency} (ECB, {result.usdRate.date})</span>}
            {result.carryForwardLossLocal > 0 && <span className="num text-warn">Loss carried forward: {m(result.carryForwardLossLocal)}</span>}
          </div>
        </div>
      </Section>
      <Section title="Methodology" count={result.methodology.length}><List items={result.methodology} /></Section>
      <Section title="Residency & assumptions" count={result.assumptions.length}><List items={result.assumptions} /></Section>
      <Section title="What remains uncertain" count={result.uncertainties.length} tone="warn"><List items={result.uncertainties} /></Section>
      {result.missing.length > 0 && <Section title="Missing data" count={result.missing.length} tone="warn"><List items={result.missing} /></Section>}
      <Section title="Reporting requirements" count={result.reporting.length}><List items={result.reporting} /></Section>
      <Section title="Legal references" count={result.references.length}>
        <ul className="space-y-2">
          {result.references.map((r) => (
            <li key={r.title}><a href={r.url} target="_blank" rel="noreferrer noopener" className="text-cyan underline decoration-cyan/30 underline-offset-4 hover:decoration-cyan">{r.title}</a></li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
