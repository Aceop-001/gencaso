import roadmap from "@/lib/roadmap.json";

/** Number of planned (not yet live) entries on the DefiLlama roadmap. */
export const roadmapPlannedCount = roadmap.categories.reduce((n, c) => n + c.items.filter((x) => !x.live).length, 0);

const tvl = (m: number) => (m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`);

/** DefiLlama's top N per category, ranked by TVL. Live = supported and verified in Gencaso today. */
export function RoadmapLists() {
  return (
    <div className="space-y-2">
      {roadmap.categories.map((c) => {
        const live = c.items.filter((x) => x.live).length;
        return (
          <details key={c.id} className="group rounded-2xl border border-line bg-surface-2/40 open:bg-surface-2/60">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-ink">
              <span className="font-medium">
                {c.label} <span className="text-ink-3">· top {c.items.length}</span>
              </span>
              <span className="flex items-center gap-2 text-xs">
                {live > 0 && <span className="rounded-full border border-good/40 px-2 py-0.5 text-good">{live} live</span>}
                <span className="rounded-full border border-line px-2 py-0.5 text-ink-3">{c.items.length - live} planned</span>
                <span className="text-ink-3 transition group-open:rotate-180" aria-hidden>⌄</span>
              </span>
            </summary>
            <ol className="grid gap-x-4 gap-y-1 px-4 pb-4 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
              {c.items.map((x) => (
                <li key={x.rank} className="flex min-w-0 items-baseline gap-2">
                  <span className="w-6 shrink-0 text-right font-mono text-[11px] text-ink-3">{x.rank}</span>
                  <span className="truncate text-ink-2" title={`${x.name} · ${x.chains.join(", ")} · TVL ${tvl(x.tvlUsdM)}`}>
                    {x.name}
                  </span>
                  {x.live ? <span className="shrink-0 text-[10px] uppercase tracking-wider text-good">live</span> : <span className="shrink-0 font-mono text-[11px] text-ink-3">{tvl(x.tvlUsdM)}</span>}
                </li>
              ))}
            </ol>
          </details>
        );
      })}
    </div>
  );
}

export const roadmapMeta = { source: roadmap.source, fetchedOn: roadmap.fetchedOn, perCategory: roadmap.perCategory };
