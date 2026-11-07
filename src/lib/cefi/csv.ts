import type { FinancialEvent } from "../engine/schema";

/**
 * CeFi mode: the Gencaso CSV template.
 *
 * Centralised exchanges don't publish your trades, so you export them and upload the file. It is read in
 * your browser; only dates are sent to the server (for exchange rates). This template works with any
 * exchange: copy the rows from its futures / derivatives P&L or transaction-history export.
 *
 * Columns (header row required, any order, case-insensitive):
 *   date        ISO date or date-time, UTC (2026-03-10 or 2026-03-10T14:05:00Z)
 *   exchange    e.g. Binance
 *   market      e.g. BTCUSDT
 *   type        realized_pnl | funding | fee | deposit | withdrawal
 *   amount_usd  realized_pnl and funding: signed (+ profit/received, − loss/paid);
 *               fee: amount paid (positive); deposit/withdrawal: amount moved (positive)
 *   fee_usd     optional, a fee paid on that realized_pnl row
 *   note        optional
 *
 * USDT and USDC count as USD. Rows with other currencies must be converted first.
 */

export const TEMPLATE_HEADER = ["date", "exchange", "market", "type", "amount_usd", "fee_usd", "note"] as const;
export const CEFI_TYPES = ["realized_pnl", "funding", "fee", "deposit", "withdrawal"] as const;
export type CefiType = (typeof CEFI_TYPES)[number];

export const TEMPLATE_CSV = [
  TEMPLATE_HEADER.join(","),
  "2026-01-05T09:30:00Z,Binance,BTCUSDT,realized_pnl,1250.40,2.10,Closed BTC long",
  "2026-01-05T16:00:00Z,Binance,BTCUSDT,funding,-3.85,,",
  "2026-01-12T11:02:00Z,Bybit,ETHUSDT,realized_pnl,-420.00,1.35,Stopped out",
  "2026-01-20T08:00:00Z,OKX,SOL-USDT-SWAP,fee,0.90,,Maker/taker fee",
  "2026-02-01T00:00:00Z,Binance,USDT,deposit,5000,,From bank",
].join("\n");

export interface CsvIssue {
  /** 1-based line number in the file (header = line 1) */
  line: number;
  message: string;
}

export interface CefiParse {
  events: FinancialEvent[];
  issues: CsvIssue[];
  rows: number;
  exchanges: string[];
}

/** RFC-4180-style CSV: quoted fields, escaped quotes (""), commas and new lines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, ""); // Excel adds a byte-order mark
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "1,250.40", "$1250.40", "(420)" and "−420" all read as numbers. */
function num(raw: string): number | null {
  let s = raw.trim().replace(/[$\s]/g, "").replace(/−/g, "-");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

function when(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  // Date-only and naive date-times are read as UTC
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Hash for stable event ids: re-uploading the same file never double-counts. */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Read a Gencaso CSV template file into events. Bad rows are reported, never guessed. */
export function parseCefiCsv(text: string, fileName = "upload.csv", now = Date.now()): CefiParse {
  const table = parseCsv(text);
  const issues: CsvIssue[] = [];
  if (!table.length) return { events: [], issues: [{ line: 1, message: "The file is empty." }], rows: 0, exchanges: [] };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const missing = ["date", "type", "amount_usd"].filter((c) => col(c) < 0);
  if (missing.length)
    return { events: [], issues: [{ line: 1, message: `Missing column(s): ${missing.join(", ")}. Use the Gencaso template header: ${TEMPLATE_HEADER.join(",")}` }], rows: 0, exchanges: [] };

  const events: FinancialEvent[] = [];
  const exchanges = new Set<string>();
  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (name: string) => (col(name) >= 0 ? (cells[col(name)] ?? "").trim() : "");
    const ts = when(get("date"));
    const type = get("type").toLowerCase() as CefiType;
    const amount = num(get("amount_usd"));
    const feeRaw = get("fee_usd");
    const fee = feeRaw ? num(feeRaw) : 0;
    if (ts === null) return issues.push({ line, message: `Date "${get("date")}" isn't a date like 2026-03-10 or 2026-03-10T14:05:00Z.` });
    if (ts > now + 86_400_000) return issues.push({ line, message: "Date is in the future." });
    if (!CEFI_TYPES.includes(type)) return issues.push({ line, message: `Type "${get("type")}" must be one of: ${CEFI_TYPES.join(", ")}.` });
    if (amount === null) return issues.push({ line, message: `Amount "${get("amount_usd")}" isn't a number.` });
    if (fee === null || fee < 0) return issues.push({ line, message: `Fee "${feeRaw}" must be a positive number or empty.` });
    if ((type === "fee" || type === "deposit" || type === "withdrawal") && amount < 0)
      return issues.push({ line, message: `For "${type}" rows, enter the amount as a positive number.` });

    const exchange = get("exchange") || "Exchange";
    const market = get("market") || "—";
    exchanges.add(exchange);
    // Identical rows in one file get an occurrence counter, so real repeats still count once each
    const base = `${fileName}|${cells.join("|")}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const common = {
      id: `cefi-${hash(base)}-${n}`,
      protocol: "cefi" as const,
      chain: exchange,
      account: `cefi:${exchange.toLowerCase()}`,
      timestamp: ts,
      asset: market,
      market: { id: `${exchange}:${market}`, name: `${market} · ${exchange}` },
      quantity: 0,
      fiat: { currency: "USD" as const, source: "Amounts entered in USD (USDT/USDC = USD)" },
      source: `Exchange CSV · ${fileName} line ${line}`,
      verification: "estimated" as const,
      confidence: 0.9,
      notes: get("note") || undefined,
    };
    if (type === "realized_pnl") events.push({ ...common, category: "perp", type: "PERP_CLOSE", realizedPnlUsd: amount, feeUsd: fee ?? 0, fundingUsd: 0 });
    else if (type === "funding") events.push({ ...common, category: "perp", type: "FUNDING", realizedPnlUsd: 0, feeUsd: 0, fundingUsd: amount });
    else if (type === "fee") events.push({ ...common, category: "perp", type: "PERP_CLOSE", realizedPnlUsd: 0, feeUsd: amount, fundingUsd: 0 });
    else events.push({ ...common, category: "account", type: type === "deposit" ? "DEPOSIT" : "WITHDRAWAL", amountUsd: amount, realizedPnlUsd: 0, feeUsd: 0, fundingUsd: 0 });
  });
  return { events, issues, rows: table.length - 1, exchanges: [...exchanges] };
}
