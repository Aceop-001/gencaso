import type { FinancialEvent, WalletDataset } from "./engine/schema";
import { rateOn } from "./fx/fx";
import { marketUrl, txUrl } from "./links";
import { datasetFingerprint } from "./reports";
import type { Jurisdiction, TaxProfile, TaxResult } from "./tax";

/**
 * The accountant's workbook (.xlsx — opens directly in Google Sheets with every tab intact).
 * Four tabs: Summary, Tax calculation, Transactions, By asset / market.
 * Every amount is a real number cell (sortable, summable); links are HYPERLINK formulas.
 * This module only builds the sheet data; `downloadWorkbook` writes the file in the browser.
 */

type CellObj = { value: string | number | Date | boolean | null; type?: unknown; format?: string; fontWeight?: "bold"; color?: string; wrap?: boolean };
export type WCell = CellObj | null;
export type WSheet = { sheet: string; data: WCell[][]; columns: { width: number }[]; stickyRowsCount?: number };

const MONEY = "#,##0.00";
const QTY = "#,##0.########";
const RATE = "0.0000";

const s = (value: string | undefined | null, extra: Partial<CellObj> = {}): WCell => (value ? { value, type: String, ...extra } : null);
const n = (value: number | undefined | null, format = MONEY, extra: Partial<CellObj> = {}): WCell =>
  value === undefined || value === null || !Number.isFinite(value) ? null : { value: Math.round(value * 1e8) / 1e8, type: Number, format, ...extra };
const d = (ms: number): WCell => ({ value: new Date(ms), type: Date, format: "yyyy-mm-dd" });
const bold = (value: string): WCell => ({ value, type: String, fontWeight: "bold" });
const link = (url: string | undefined, label: string): WCell =>
  url ? { value: `HYPERLINK("${url.replace(/"/g, "%22")}","${label}")`, type: "Formula" } : null;
const sumFormula = (col: string, from: number, to: number, format = MONEY): WCell => ({ value: `SUM(${col}${from}:${col}${to})`, type: "Formula", format, fontWeight: "bold" });

/** Spreadsheet column letter for a 0-based index. */
const colLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

const typeLabel = (e: FinancialEvent) => e.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const NOT_TAXABLE = new Set(["DEPOSIT", "WITHDRAWAL", "TRANSFER"]);
/** Net trading effect of one event in USD (transfers contribute nothing). */
const netUsd = (e: FinancialEvent) => (NOT_TAXABLE.has(e.type) ? 0 : e.type === "REWARD" ? e.amountUsd ?? 0 : e.realizedPnlUsd + e.fundingUsd - e.feeUsd);

export function buildWorkbookSheets(ds: WalletDataset, r: TaxResult, profile: TaxProfile, j: Jurisdiction, generatedAt = new Date()): WSheet[] {
  const cur = r.currency;
  const inYear = ds.events.filter((e) => e.timestamp >= r.taxYear.start && e.timestamp < r.taxYear.end);

  // ── Summary ──────────────────────────────────────────────────────────────────
  const row = (label: string, value: WCell): WCell[] => [bold(label), value];
  const summary: WCell[][] = [
    [{ value: "GENCASO tax estimate", type: String, fontWeight: "bold" }, s("Estimate only — not professional tax advice. Verify before filing.", { color: "#B45309" })],
    [],
    row("Wallet", s(ds.address)),
    row("Demo data", s(ds.isDemo ? "Yes — synthetic, not a real liability" : "No")),
    row("Country", s(j.name)),
    row("Tax year", s(r.taxYear.label)),
    row("Tax year start", d(r.taxYear.start)),
    row("Tax year end", d(r.taxYear.end - 86_400_000)),
    row("Currency", s(cur)),
    row("Trader type", s(profile.traderType === "business" ? "Business / trader" : "Individual investor")),
    row(`Other income entered (${cur})`, n(profile.otherIncomeLocal)),
    [],
    row(`Estimated final tax (${cur})`, n(r.taxLocal, MONEY, { fontWeight: "bold" })),
    row("Estimated final tax (USD)", n(r.taxUsd, MONEY, { fontWeight: "bold" })),
    row(`USD rate used (${cur} per USD)`, n(r.usdRate?.rate, RATE)),
    row("USD rate date", s(r.usdRate?.date)),
    row(`Net trading result (${cur})`, n(r.netTradingLocal)),
    row(`Taxable amount (${cur})`, n(r.taxableLocal)),
    row(`Loss carried forward (${cur})`, n(r.carryForwardLossLocal)),
    row("Events in tax year", n(r.eventsInYear, "0")),
    [],
    row("Rules status", s(r.provisional ? `Provisional — ${r.provisional}` : r.unsupportedYear ? `No verified rules for ${r.unsupportedYear}` : "Settled")),
    row("Tax module", s(r.moduleVersion)),
    row("Rules effective", s(r.rulesEffective)),
    row("Exchange rates", s(ds.fx.source)),
    row("Data fetched (UTC)", s(new Date(ds.fetchedAt).toISOString().replace("T", " ").slice(0, 19))),
    row("Dataset fingerprint", s(datasetFingerprint(ds))),
    row("Generated (UTC)", s(generatedAt.toISOString().replace("T", " ").slice(0, 19))),
  ];
  if (ds.dataWarnings.length) {
    summary.push([], [bold("Data warnings")]);
    for (const w of ds.dataWarnings) summary.push([null, s(w, { wrap: true })]);
  }

  // ── Tax calculation ─────────────────────────────────────────────────────────
  const calcHead = ["Item", "Classification", `Base (${cur})`, "Rate", `Tax (${cur})`, "Legal basis", "How it was calculated"].map(bold);
  const calc: WCell[][] = [calcHead];
  for (const l of r.lines) calc.push([s(l.label), s(l.category), n(l.baseLocal), s(l.rate), n(l.taxLocal), s(l.rule, { wrap: true }), s(l.explanation, { wrap: true })]);
  calc.push([bold("Total"), null, null, null, sumFormula("E", 2, r.lines.length + 1)]);
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    calc.push([], [bold(title)]);
    for (const it of items) calc.push([null, s(it, { wrap: true })]);
  };
  section("Methodology", r.methodology);
  section("Assumptions", r.assumptions);
  section("What remains uncertain", r.uncertainties);
  section("Missing data", r.missing);
  section("Reporting obligations", r.reporting);
  if (r.references.length) {
    calc.push([], [bold("References")]);
    for (const ref of r.references) calc.push([null, link(ref.url, ref.title)]);
  }

  // ── Transactions ────────────────────────────────────────────────────────────
  const txCols = [
    "Date (UTC)", "Time (UTC)", "Protocol", "Category", "Type", "Asset", "Market", "Outcome",
    "Quantity", "Price (USD)", "Proceeds (USD)", "Cost basis (USD)", "Realized P&L (USD)", "Fee (USD)", "Funding (USD)", "Cash amount (USD)", "Net result (USD)",
    `FX rate (${cur}/USD)`, "FX date", `Realized P&L (${cur})`, `Fee (${cur})`, `Funding (${cur})`, `Net result (${cur})`,
    "Data quality", "Transaction", "Market page", "Event ID", "Notes",
  ];
  const tx: WCell[][] = [txCols.map(bold)];
  for (const e of inYear) {
    const fx = cur === "USD" ? { rate: 1, date: new Date(e.timestamp).toISOString().slice(0, 10) } : rateOn(ds.fx, cur, e.timestamp);
    const L = (usd: number) => (fx ? usd * fx.rate : null);
    const iso = new Date(e.timestamp).toISOString();
    tx.push([
      d(e.timestamp), s(iso.slice(11, 19)), s(e.protocol), s(e.category), s(typeLabel(e)), s(e.asset), s(e.market?.name), s(e.market?.outcome),
      n(e.quantity, QTY), n(e.price, QTY), n(e.exitValueUsd), n(e.entryValueUsd), n(e.realizedPnlUsd), n(e.feeUsd), n(e.fundingUsd), n(e.amountUsd), n(netUsd(e)),
      n(fx?.rate, RATE), s(fx?.date), n(L(e.realizedPnlUsd)), n(L(e.feeUsd)), n(L(e.fundingUsd)), n(L(netUsd(e))),
      s(e.verification), link(txUrl(e), "View transaction"), link(marketUrl(e), "View market"), s(e.id),
      s(NOT_TAXABLE.has(e.type) ? `Not a taxable trading event${e.notes ? ` — ${e.notes}` : ""}` : e.notes),
    ]);
  }
  const last = inYear.length + 1;
  if (inYear.length) {
    const totals: WCell[] = txCols.map(() => null);
    totals[0] = bold("Total");
    for (const name of ["Realized P&L (USD)", "Fee (USD)", "Funding (USD)", "Net result (USD)", `Realized P&L (${cur})`, `Fee (${cur})`, `Funding (${cur})`, `Net result (${cur})`]) {
      const i = txCols.indexOf(name);
      totals[i] = sumFormula(colLetter(i), 2, last);
    }
    tx.push(totals);
  }

  // ── By asset / market ───────────────────────────────────────────────────────
  const groups = new Map<string, { protocol: string; kind: string; name: string; n: number; realized: number; fee: number; funding: number; netUsd: number }>();
  for (const e of inYear) {
    if (NOT_TAXABLE.has(e.type)) continue;
    const fx = cur === "USD" ? { rate: 1 } : rateOn(ds.fx, cur, e.timestamp);
    if (!fx) continue;
    const name = e.category === "prediction" && e.market ? `${e.market.name}${e.market.outcome ? ` — ${e.market.outcome}` : ""}` : e.asset;
    const key = `${e.protocol}|${e.category}|${name}`;
    const g = groups.get(key) ?? { protocol: e.protocol, kind: e.category === "prediction" ? "Prediction market" : e.category === "perp" ? "Perpetual" : e.category === "nft" ? "NFT" : "Account", name, n: 0, realized: 0, fee: 0, funding: 0, netUsd: 0 };
    g.n++;
    g.realized += (e.type === "REWARD" ? e.amountUsd ?? 0 : e.realizedPnlUsd) * fx.rate;
    g.fee += e.feeUsd * fx.rate;
    g.funding += e.fundingUsd * fx.rate;
    g.netUsd += netUsd(e);
    groups.set(key, g);
  }
  const byHead = ["Protocol", "Type", "Asset / market", "Events", `Realized P&L (${cur})`, `Fees (${cur})`, `Funding (${cur})`, `Net result (${cur})`, "Net result (USD)"].map(bold);
  const by: WCell[][] = [byHead];
  const sorted = [...groups.values()].sort((a, b) => b.realized - b.fee + b.funding - (a.realized - a.fee + a.funding));
  for (const g of sorted) by.push([s(g.protocol), s(g.kind), s(g.name), n(g.n, "0"), n(g.realized), n(g.fee), n(g.funding), n(g.realized - g.fee + g.funding), n(g.netUsd)]);
  if (sorted.length) {
    const end = sorted.length + 1;
    by.push([bold("Total"), null, null, sumFormula("D", 2, end, "0"), sumFormula("E", 2, end), sumFormula("F", 2, end), sumFormula("G", 2, end), sumFormula("H", 2, end), sumFormula("I", 2, end)]);
  }

  const widths = (...w: number[]) => w.map((width) => ({ width }));
  return [
    { sheet: "Summary", data: summary, columns: widths(34, 90) },
    { sheet: "Tax calculation", data: calc, columns: widths(34, 30, 16, 22, 16, 48, 70), stickyRowsCount: 1 },
    { sheet: "Transactions", data: tx, columns: widths(12, 10, 12, 11, 16, 10, 40, 10, 14, 12, 14, 14, 16, 12, 13, 14, 14, 14, 11, 18, 14, 15, 18, 11, 18, 14, 34, 40), stickyRowsCount: 1 },
    { sheet: "By asset or market", data: by, columns: widths(12, 18, 50, 9, 18, 15, 16, 18, 16), stickyRowsCount: 1 },
  ];
}

export function workbookFileName(ds: WalletDataset, r: TaxResult, j: Jurisdiction) {
  const who = ds.isDemo ? "demo" : `${ds.address.slice(0, 6)}${ds.address.slice(-4)}`;
  return `GENCASO_${j.name.replace(/[^A-Za-z]+/g, "")}_${r.taxYear.id.replace(/[^\w-]+/g, "-")}_${who}.xlsx`;
}

/** Build and download the workbook (browser only; the writer is loaded on demand). */
export async function downloadWorkbook(ds: WalletDataset, r: TaxResult, profile: TaxProfile, j: Jurisdiction) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const sheets = buildWorkbookSheets(ds, r, profile, j);
  // The library's cell typing is stricter than this module's builder; the shapes match at runtime.
  await writeXlsxFile(sheets as unknown as Parameters<typeof writeXlsxFile>[0] & unknown[]).toFile(workbookFileName(ds, r, j));
}
