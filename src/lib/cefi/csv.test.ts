import { describe, expect, it } from "vitest";
import { summarize } from "../engine/summary";
import { parseCefiCsv, parseCsv, TEMPLATE_CSV, TEMPLATE_HEADER } from "./csv";

const NOW = Date.UTC(2026, 10, 7);
const header = TEMPLATE_HEADER.join(",");

describe("CSV reading", () => {
  it("handles quotes, escaped quotes, commas and new lines inside fields, CRLF and Excel's BOM", () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n');
    expect(rows).toEqual([["a", "b", "c"], ["x, y", 'say "hi"', "line1\nline2"]]);
  });
});

describe("Gencaso CSV template", () => {
  it("the downloadable template itself parses cleanly", () => {
    const r = parseCefiCsv(TEMPLATE_CSV, "template.csv", NOW);
    expect(r.issues).toEqual([]);
    expect(r.rows).toBe(5);
    expect(r.exchanges).toEqual(["Binance", "Bybit", "OKX"]);
  });

  it("maps each row type to the right event, and totals add up", () => {
    const r = parseCefiCsv(TEMPLATE_CSV, "template.csv", NOW);
    const s = summarize(r.events);
    expect(s.realizedProfit).toBeCloseTo(1250.4, 6);
    expect(s.realizedLoss).toBeCloseTo(420, 6);
    expect(s.netFunding).toBeCloseTo(-3.85, 6);
    expect(s.fees).toBeCloseTo(2.1 + 1.35 + 0.9, 6);
    const dep = r.events.find((e) => e.type === "DEPOSIT")!;
    expect(dep.amountUsd).toBe(5000);
    expect(s.netTradingResult).toBeCloseTo(1250.4 - 420 - 3.85 - (2.1 + 1.35 + 0.9), 6); // deposits never count
  });

  it("columns can be in any order and any case", () => {
    const r = parseCefiCsv("AMOUNT_USD,Type,Date\n100,realized_pnl,2026-03-01", "f.csv", NOW);
    expect(r.issues).toEqual([]);
    expect(r.events[0].realizedPnlUsd).toBe(100);
    expect(r.events[0].timestamp).toBe(Date.UTC(2026, 2, 1));
  });

  it("reads thousands separators, $ signs, (negative) and the minus sign", () => {
    const r = parseCefiCsv(`${header}\n2026-03-01,X,M,realized_pnl,"$1,250.50",,\n2026-03-02,X,M,realized_pnl,(20),,\n2026-03-03,X,M,funding,−5,,`, "f.csv", NOW);
    expect(r.issues).toEqual([]);
    expect(r.events.map((e) => e.realizedPnlUsd + e.fundingUsd)).toEqual([1250.5, -20, -5]);
  });

  it("reports bad rows with their line number and never guesses", () => {
    const r = parseCefiCsv(`${header}\nyesterday,X,M,realized_pnl,10,,\n2026-03-01,X,M,trade,10,,\n2026-03-01,X,M,realized_pnl,ten,,\n2026-03-01,X,M,fee,-1,,\n2030-01-01,X,M,funding,1,,\n2026-03-01,X,M,funding,1,,`, "f.csv", NOW);
    expect(r.issues.map((i) => i.line)).toEqual([2, 3, 4, 5, 6]);
    expect(r.events).toHaveLength(1);
  });

  it("a file without the required columns explains the template", () => {
    const r = parseCefiCsv("Time,Symbol,PnL\n2026-01-01,BTC,5", "binance.csv", NOW);
    expect(r.events).toEqual([]);
    expect(r.issues[0].message).toMatch(/Missing column\(s\): date, type, amount_usd/);
  });

  it("re-uploading the same file gives the same ids; identical rows in one file still count separately", () => {
    const text = `${header}\n2026-03-01,X,M,funding,1,,\n2026-03-01,X,M,funding,1,,`;
    const a = parseCefiCsv(text, "f.csv", NOW);
    const b = parseCefiCsv(text, "f.csv", NOW);
    expect(a.events.map((e) => e.id)).toEqual(b.events.map((e) => e.id));
    expect(new Set(a.events.map((e) => e.id)).size).toBe(2);
  });

  it("date-only and naive date-times are UTC", () => {
    const r = parseCefiCsv(`${header}\n2026-03-01 14:05:00,X,M,funding,1,,`, "f.csv", NOW);
    expect(r.events[0].timestamp).toBe(Date.UTC(2026, 2, 1, 14, 5));
  });
});
