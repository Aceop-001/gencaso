"use client";

import { useMemo, useState } from "react";
import type { FinancialEvent } from "@/lib/engine/schema";
import { fmtDate, fmtMoney, fmtSigned } from "@/lib/format";
import { eventLinks } from "@/lib/links";
import { protocolById } from "@/lib/registry";
import { ProtocolLogo } from "./ProtocolLogo";

const PAGE = 20;
const FILTERS = [
  { id: "all", label: "All" },
  { id: "perp", label: "Perps" },
  { id: "prediction", label: "Prediction" },
  { id: "nft", label: "NFTs" },
  { id: "closing", label: "Realized" },
  { id: "funding", label: "Funding" },
  { id: "account", label: "Account" },
] as const;

const VER_STYLE: Record<string, string> = {
  verified: "text-good border-good/30",
  estimated: "text-warn border-warn/30",
  mock: "text-violet border-violet/40",
  missing: "text-bad border-bad/30",
  unsupported: "text-ink-3 border-line",
};

export function EventsTable({ events }: { events: readonly FinancialEvent[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const f = events.filter((e) => {
      if (filter === "all") return true;
      if (filter === "closing") return e.realizedPnlUsd !== 0;
      if (filter === "funding") return e.type === "FUNDING";
      return e.category === filter;
    });
    return [...f].reverse();
  }, [events, filter]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter events">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => { setFilter(f.id); setPage(0); }}
            className={`rounded-full px-3 py-1 text-xs transition ${filter === f.id ? "bg-blue/20 text-ink ring-1 ring-blue/40" : "text-ink-3 hover:text-ink-2"}`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-ink-3">{rows.length.toLocaleString()} events</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead className="bg-surface-solid/80 text-[11px] uppercase tracking-wider text-ink-3">
            <tr>
              <th className="px-4 py-3 font-medium">Time (UTC)</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Asset / market</th>
              <th className="px-4 py-3 text-right font-medium">Qty</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              <th className="px-4 py-3 text-right font-medium">Realized</th>
              <th className="px-4 py-3 text-right font-medium">Fee</th>
              <th className="px-4 py-3 text-right font-medium">Funding / amt</th>
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-line">
            {view.map((e) => (
              <tr key={e.id} className="transition hover:bg-blue/5">
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink-3">{fmtDate(e.timestamp)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-ink-2">{e.type.replace(/_/g, " ").toLowerCase()}</td>
                <td className="max-w-[260px] truncate px-4 py-2.5 text-ink" title={e.market?.name ?? e.asset}>
                  {e.market ? <><span className="text-ink-2">{e.market.outcome} · </span>{e.market.name}</> : e.asset}
                </td>
                <td className="px-4 py-2.5 text-right text-ink-2">{e.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                <td className="px-4 py-2.5 text-right text-ink-2">{e.price !== undefined ? e.price.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}</td>
                <td className={`px-4 py-2.5 text-right ${e.realizedPnlUsd > 0 ? "text-good" : e.realizedPnlUsd < 0 ? "text-bad" : "text-ink-3"}`}>{e.realizedPnlUsd ? fmtSigned(e.realizedPnlUsd) : "—"}</td>
                <td className="px-4 py-2.5 text-right text-ink-3">{e.feeUsd ? fmtMoney(e.feeUsd) : "—"}</td>
                <td className="px-4 py-2.5 text-right text-ink-2">{e.fundingUsd ? fmtSigned(e.fundingUsd) : e.amountUsd ? fmtMoney(e.amountUsd) : "—"}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${VER_STYLE[e.verification]}`} title={`${e.source} · confidence ${(e.confidence * 100).toFixed(0)}%${e.notes ? ` · ${e.notes}` : ""}`}>
                    {e.verification}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                  {e.protocol === "mock" ? (
                    <span className="text-ink-3" title="Demo data has no real transaction">—</span>
                  ) : (
                    <span className="inline-flex items-center gap-2" title={protocolById(e.protocol)?.name ?? e.protocol}>
                      <ProtocolLogo protocol={e.protocol} />
                      {eventLinks(e).length ? (
                        eventLinks(e).map((l) => (
                          <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="text-cyan/80 underline-offset-2 hover:text-cyan hover:underline">
                            {l.label}
                            <span aria-hidden> ↗</span>
                          </a>
                        ))
                      ) : (
                        <span className="text-ink-3" title="No on-chain transaction for this event (e.g. funding, an internal fill, or an exchange without per-trade explorer links)">
                          {protocolById(e.protocol)?.name ?? e.protocol}
                        </span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!view.length && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-ink-3">No events for this filter in the selected tax year.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-ink-3">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-40 hover:text-ink">Prev</button>
          <span className="num">{page + 1} / {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-40 hover:text-ink">Next</button>
        </div>
      )}
    </div>
  );
}
