"use client";

import { animate, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WalletDataset } from "@/lib/engine/schema";
import { dailySeries, summarize } from "@/lib/engine/summary";
import { walletLabel, walletsOf } from "@/lib/engine/combine";
import { fmtDate, fmtMoney, fmtPct, fmtSigned, shortAddr } from "@/lib/format";
import { protocolById } from "@/lib/registry";
import { downloadWorkbook } from "@/lib/workbook";
import { calculateTax, jurisdiction, taxYearsWithActivity, type CountryCode, type TaxProfile } from "@/lib/tax";
import { CountrySelect } from "./CountrySelect";
import { EventsTable } from "./EventsTable";
import { Flag } from "./Flag";
import { PnlChart } from "./PnlChart";
import { TaxBreakdown } from "./TaxBreakdown";
import { TaxCardButton } from "./TaxCard";

function AnimatedUsd({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      el.textContent = fmtMoney(value);
      prev.current = value;
      return;
    }
    const c = animate(prev.current, value, { duration: 0.7, ease: [0.2, 0.8, 0.2, 1], onUpdate: (v) => (el.textContent = fmtMoney(v)) });
    prev.current = value;
    return () => c.stop();
  }, [value]);
  return <span ref={ref}>{fmtMoney(value)}</span>;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-ink-3">{label}</div>
      <div className={`num mt-1.5 font-mono text-lg ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-ink"}`}>{value}</div>
      {sub && <div className="num mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function Results({ dataset, country, onCountry, onReset, onRefresh }: { dataset: WalletDataset; country: CountryCode; onCountry: (c: CountryCode) => void; onReset: () => void; onRefresh: () => void }) {
  const j = jurisdiction(country);
  const years = useMemo(() => taxYearsWithActivity(j, dataset), [j, dataset]);
  const [yearByCountry, setYearByCountry] = useState<Partial<Record<CountryCode, string>>>({});
  const [traderType, setTraderType] = useState<TaxProfile["traderType"]>("individual");
  const [otherIncome, setOtherIncome] = useState<Partial<Record<CountryCode, number>>>({});
  // Default to the latest completed tax year (the one being filed), else the current one.
  const year = years.find((y) => y.id === yearByCountry[country]) ?? years.find((y) => y.end <= dataset.fetchedAt) ?? years[0];
  const profile: TaxProfile = { traderType, otherIncomeLocal: otherIncome[country] ?? 0 };

  // Country switch = pure local recalculation over the cached dataset. No network.
  const { result, ms } = useMemo(() => {
    if (!year) return { result: null, ms: 0 };
    const t = performance.now();
    const r = calculateTax(dataset, country, year, profile);
    return { result: r, ms: performance.now() - t };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, country, year, traderType, profile.otherIncomeLocal]);

  const yearEvents = useMemo(() => (year ? dataset.events.filter((e) => e.timestamp >= year.start && e.timestamp < year.end) : []), [dataset, year]);
  const s = useMemo(() => summarize(yearEvents), [yearEvents]);
  const series = useMemo(() => dailySeries(yearEvents), [yearEvents]);
  const rate = result?.usdRate?.rate;
  const toUsd = (local: number) => (rate ? local / rate : null);
  const effective = result?.taxUsd != null && s.netTradingResult > 0 ? result.taxUsd / s.netTradingResult : null;

  if (!year || !result) {
    return (
      <div className="glass mx-auto max-w-xl rounded-3xl p-8 text-center">
        <div className="text-lg text-ink">No supported trading activity found</div>
        <p className="mt-2 text-sm text-ink-2">We checked {dataset.providers.map((p) => protocolById(p.protocol)?.name ?? p.provider).join(", ")} for {walletLabel(dataset)}. Nothing taxable was found, so no tax was calculated.</p>
        <ProviderList dataset={dataset} />
        {dataset.dataWarnings.length > 0 && <ul className="mt-4 space-y-1 text-left text-xs text-warn">{dataset.dataWarnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <button onClick={onReset} className="mt-6 rounded-full border border-line px-5 py-2 text-sm text-ink hover:border-line-strong">Analyse another wallet</button>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }} className="space-y-6">
      {dataset.isDemo && (
        <div className="rounded-2xl border border-violet/40 bg-violet/10 px-4 py-3 text-sm text-ink" role="note">
          <strong className="font-medium">Demo wallet — mock data.</strong> Every trade below is synthetic. Tax figures show how the engine works; they are not anyone&apos;s real liability.
        </div>
      )}

      {/* Context bar: wallet, country (switchable), tax year, profile */}
      <div className="glass relative z-30 flex flex-col gap-3 rounded-3xl p-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-3 px-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-good shadow-[0_0_10px_var(--good)]" />
          <span className="truncate font-mono text-sm text-ink" title={walletsOf(dataset).join("\n")}>{walletLabel(dataset)}</span>
          {walletsOf(dataset).length > 1 && <span className="hidden truncate font-mono text-xs text-ink-3 md:inline">{walletsOf(dataset).map(shortAddr).join(" · ")}</span>}
          <span className="hidden text-xs text-ink-3 sm:inline">synced {fmtDate(dataset.fetchedAt)} UTC</span>
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end">
          <div className="w-[200px]"><CountrySelect value={country} onChange={onCountry} size="sm" /></div>
          <label className="sr-only" htmlFor="taxyear">Tax year</label>
          <select id="taxyear" value={year.id} onChange={(e) => setYearByCountry((m) => ({ ...m, [country]: e.target.value }))} className="h-11 rounded-2xl border border-line bg-surface-2 px-3 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60">
            {years.map((y) => <option key={y.id} value={y.id} className="bg-surface-solid">{y.id}{!j.supportedYears.includes(y.id) ? " (unsupported)" : y.end > dataset.fetchedAt ? " (in progress)" : ""}</option>)}
          </select>
          <label className="sr-only" htmlFor="tradertype">Trader type</label>
          <select id="tradertype" value={traderType} onChange={(e) => setTraderType(e.target.value as TaxProfile["traderType"])} className="h-11 rounded-2xl border border-line bg-surface-2 px-3 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60">
            <option value="individual" className="bg-surface-solid">Individual investor</option>
            <option value="business" className="bg-surface-solid">Business / trader</option>
          </select>
          <label className="flex h-11 items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3 text-sm text-ink-3">
            <span className="whitespace-nowrap">Other income ({j.currency})</span>
            <input
              type="number"
              min={0}
              step={1000}
              inputMode="numeric"
              value={otherIncome[country] ?? 0}
              onChange={(e) => setOtherIncome((m) => ({ ...m, [country]: Math.max(0, Number(e.target.value) || 0) }))}
              className="num w-24 bg-transparent text-right font-mono text-ink focus:outline-none"
            />
          </label>
        </div>
      </div>

      {/* Final tax — the focal point */}
      <section className="relative overflow-hidden rounded-[32px] border border-line-strong p-8 md:p-12" style={{ background: "radial-gradient(120% 140% at 0% 0%, rgba(61,123,255,.22), transparent 55%), radial-gradient(90% 120% at 100% 100%, rgba(139,108,255,.14), transparent 60%), linear-gradient(180deg, #0a1430, #050a1a)" }}>
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-cyan">
              <Flag code={j.code} size={18} /> Estimated final tax · {j.name}
            </div>
            <motion.div key={country + year.id} initial={{ opacity: 0.4, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.45 }} className="num mt-4 font-sans text-[clamp(44px,8vw,92px)] font-semibold leading-none tracking-[-0.035em] text-ink">
              {result.taxUsd != null ? <AnimatedUsd value={result.taxUsd} /> : "—"}
              <span className="ml-3 align-middle text-xl font-normal tracking-normal text-ink-3">USD</span>
            </motion.div>
            <div className="num mt-3 font-mono text-sm text-ink-2">
              {result.currency !== "USD" ? `≈ ${fmtMoney(result.taxLocal, result.currency, j.locale)}` : "Federal income tax"} · {result.taxYear.label}
            </div>
            {result.taxUsd == null && <div className="mt-2 text-sm text-warn">No {result.currency}/USD rate available — USD amount cannot be shown.</div>}
          </div>
          <div className="flex flex-col items-start gap-2 text-xs text-ink-3 md:items-end">
            {result.taxUsd != null && (
              <TaxCardButton
                data={{
                  country: j.code,
                  countryName: j.name,
                  taxUsd: result.taxUsd,
                  localLine: result.currency !== "USD" ? `≈ ${fmtMoney(result.taxLocal, result.currency, j.locale)}` : undefined,
                  yearLabel: result.taxYear.label,
                  yearId: year.id,
                  inProgress: year.end > dataset.fetchedAt,
                  netTradingResult: s.netTradingResult,
                  taxableUsd: toUsd(result.taxableLocal),
                  effective,
                  address: walletsOf(dataset).length > 1 || dataset.cefi ? walletLabel(dataset) : dataset.address,
                  isDemo: !!dataset.isDemo,
                  moduleVersion: result.moduleVersion,
                  provisional: result.provisional,
                }}
              />
            )}
            <span className="rounded-full border border-line px-3 py-1">Recalculated locally in {ms < 1 ? "<1" : ms.toFixed(1)} ms · 0 API calls</span>
            <span className="rounded-full border border-line px-3 py-1">Module {result.moduleVersion}</span>
            {result.unsupportedYear && <span className="rounded-full border border-warn/40 px-3 py-1 text-warn">No verified rules for {result.unsupportedYear}</span>}
            {result.provisional && <span className="max-w-xs rounded-full border border-warn/40 px-3 py-1 text-warn" title="This country's crypto tax rules are new, pending or unclear — see 'What remains uncertain'">Provisional: {result.provisional}</span>}
          </div>
        </div>
        <p className="mt-8 max-w-3xl text-xs leading-relaxed text-ink-3">
          Estimate under {j.name}&apos;s rules for comparison only — choosing a country does not change your tax residency or obligations. Trading profit ≠ taxable income ≠ tax payable. Not professional tax advice.
        </p>
      </section>

      {/* Key figures */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Stat label="Realized profit" value={fmtMoney(s.realizedProfit)} tone="good" />
        <Stat label="Realized losses" value={fmtMoney(s.realizedLoss)} tone="bad" />
        <Stat label="Net realized P&L" value={fmtSigned(s.netRealized)} tone={s.netRealized >= 0 ? "good" : "bad"} />
        <Stat label="Funding (net)" value={fmtSigned(s.netFunding)} sub={`+${fmtMoney(s.fundingReceived)} / −${fmtMoney(s.fundingPaid)}`} />
        <Stat label="Trading fees" value={fmtMoney(s.fees)} />
        <Stat label="Prediction markets" value={fmtSigned(s.prediction.net)} sub={`${s.prediction.winningMarkets} won · ${s.prediction.losingMarkets} lost`} />
        {s.nft.sold > 0 && <Stat label="NFT sales" value={fmtSigned(s.nft.realized)} sub={`${s.nft.sold} sold${s.nft.noBasis ? ` · ${s.nft.noBasis} no cost basis` : ""}`} />}
        {(s.rewards !== 0 || !s.nft.sold) && <Stat label="Rewards" value={fmtMoney(s.rewards)} />}
        <Stat label="Taxable amount" value={toUsd(result.taxableLocal) != null ? fmtMoney(toUsd(result.taxableLocal)!) : "—"} sub={result.currency !== "USD" ? fmtMoney(result.taxableLocal, result.currency, j.locale) : undefined} />
        <Stat label="Estimated tax" value={result.taxUsd != null ? fmtMoney(result.taxUsd) : "—"} sub={result.currency !== "USD" ? fmtMoney(result.taxLocal, result.currency, j.locale) : undefined} />
        <Stat label="Effective rate" value={effective != null ? fmtPct(effective) : "n/a"} sub="tax ÷ net trading result" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <TaxBreakdown result={result} j={j} />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <div className="glass rounded-3xl p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-medium text-ink">Cumulative net result</h3>
              <span className="num font-mono text-xs text-ink-3">{fmtSigned(s.netTradingResult)}</span>
            </div>
            <PnlChart data={series} />
          </div>
          <div className="glass rounded-3xl p-5">
            <h3 className="text-sm font-medium text-ink">Data sources</h3>
            <ProviderList dataset={dataset} />
            {dataset.dataWarnings.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-line pt-4 text-xs text-warn">
                {dataset.dataWarnings.map((w) => <li key={w}>⚠ {w}</li>)}
              </ul>
            )}
            {dataset.openPositions.length > 0 && (
              <div className="mt-4 border-t border-line pt-4 text-xs text-ink-3">
                <div className="mb-2 text-ink-2">{dataset.openPositions.length} open position(s) — unrealized, not taxed</div>
                {dataset.openPositions.slice(0, 6).map((p, i) => (
                  <div key={i} className="num flex justify-between gap-3 py-0.5"><span className="truncate">{p.market?.name ?? p.asset}</span><span className="font-mono">{p.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}{p.unrealizedPnlUsd !== undefined ? ` · ${fmtSigned(p.unrealizedPnlUsd)}` : ""}</span></div>
                ))}
              </div>
            )}
          </div>
          <SheetExport onDownload={() => downloadWorkbook(dataset, result, profile, j)} />
        </div>
      </div>

      <section className="glass rounded-3xl p-5">
        <h3 className="mb-4 text-sm font-medium text-ink">Normalised events · {year.id}</h3>
        <EventsTable events={yearEvents} />
      </section>

      <div className="flex flex-wrap justify-center gap-3 pb-8">
        <button onClick={onReset} className="rounded-full border border-line px-5 py-2 text-sm text-ink-2 hover:border-line-strong hover:text-ink">Analyse another wallet</button>
        {!dataset.isDemo && !dataset.cefi && <button onClick={onRefresh} className="rounded-full border border-line px-5 py-2 text-sm text-ink-3 hover:text-ink-2">Sync new activity</button>}
      </div>
    </motion.div>
  );
}

function ProviderList({ dataset }: { dataset: WalletDataset }) {
  const tone: Record<string, string> = { ok: "text-good", empty: "text-ink-3", error: "text-bad", unverified: "text-warn", unsupported: "text-ink-3" };
  return (
    <ul className="mt-3 space-y-2 text-left text-sm">
      {dataset.providers.map((p) => (
        <li key={`${p.wallet ?? ""}|${p.provider}`} className="flex items-start gap-3">
          <span className={`mt-0.5 text-[10px] uppercase tracking-wider ${tone[p.status]}`}>{p.status}</span>
          <span className="flex-1">
            <span className="text-ink">{protocolById(p.protocol)?.name ?? (p.protocol === "mock" ? "Mock data" : p.provider)}</span>
            {p.wallet && <span className="ml-2 font-mono text-[11px] text-ink-3">{shortAddr(p.wallet)}</span>}
            <span className="num ml-2 text-xs text-ink-3">{p.eventCount.toLocaleString()} events · {p.fromCache ? "cached, 0 requests" : `${p.requests} requests`}</span>
            {p.message && <span className="block text-xs text-ink-3">{p.message}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One download for the accountant: an .xlsx workbook that opens directly in Google Sheets. */
function SheetExport({ onDownload }: { onDownload: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const run = async () => {
    setState("busy");
    try {
      await onDownload();
      setState("idle");
    } catch {
      setState("error");
    }
  };
  return (
    <div className="glass rounded-3xl p-5">
      <h3 className="text-sm font-medium text-ink">Report for your accountant</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-3">
        One spreadsheet with four tabs — Summary, Tax calculation, Transactions (with source links) and By asset / market. Open it in Google Sheets: File → Import → Upload.
      </p>
      <button
        onClick={run}
        disabled={state === "busy"}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-[linear-gradient(100deg,#1f8f4e,#34a853)] px-5 py-2.5 text-sm font-medium text-white shadow-[0_8px_24px_-8px_rgba(52,168,83,.6)] transition hover:brightness-110 disabled:opacity-60"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h8M12 8v8" />
        </svg>
        {state === "busy" ? "Preparing spreadsheet…" : "Download for Google Sheets (.xlsx)"}
      </button>
      {state === "error" && <p className="mt-2 text-xs text-bad">The spreadsheet could not be created. Try again.</p>}
    </div>
  );
}
