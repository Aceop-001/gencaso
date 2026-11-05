import { basics, buildResult, calendarYear, disposalValue, money, money0, sum, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Indonesia — final income tax on the transaction value of crypto sales, not on gains.
 * PMK 50/2025 (from 1 Aug 2025): 1% for sales through foreign platforms (0.21% domestic).
 * Before: PMK 68/2022 (folded into PMK 81/2024 from 2025), 0.2% through platforms not registered with Bappebti. Module v1.0.0. Calendar year.
 */

const VERSION = "ID-1.2.0";
const YEARS: Record<string, null> = { "2024": null, "2025": null, "2026": null };
const PMK50_FROM = Date.UTC(2025, 7, 1);

const idr = (n: number) => money0(n, "IDR", "id-ID");

export const Indonesia: Jurisdiction = {
  code: "ID",
  name: "Indonesia",
  flag: "🇮🇩",
  currency: "IDR",
  locale: "id-ID",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "IDR");
    const before = b.rows.filter((r) => r.e.timestamp < PMK50_FROM);
    const after = b.rows.filter((r) => r.e.timestamp >= PMK50_FROM);
    const valueBefore = sum(before, disposalValue);
    const valueAfter = sum(after, disposalValue);
    const taxDue = valueBefore * 0.002 + valueAfter * 0.01;
    const lines: TaxLine[] = [];

    if (valueAfter)
      lines.push({
        label: "Crypto sales value from 1 Aug 2025",
        category: "Final income tax (PPh 22 final) — foreign platform",
        baseLocal: money(valueAfter),
        rate: "1% of transaction value",
        taxLocal: money(valueAfter * 0.01),
        rule: "PMK 50/2025: 1% final PPh 22 where no Indonesian-appointed collector (foreign platforms); the seller pays it",
        explanation: `Gross value of closing trades, prediction-market sales/redemptions${b.nft.count ? " and NFT sales" : ""} (${idr(valueAfter)}) at 1%. Gains or losses do not matter.`,
      });
    if (valueBefore)
      lines.push({
        label: "Crypto sales value before 1 Aug 2025",
        category: "Final income tax — unregistered platform",
        baseLocal: money(valueBefore),
        rate: "0.2% of transaction value",
        taxLocal: money(valueBefore * 0.002),
        rule: "PMK 68/PMK.03/2022; from 1 Jan 2025 PMK 81/2024, which replaced it at the same rates",
        explanation: `Gross value ${idr(valueBefore)} at 0.2%.`,
      });
    if (!lines.length) lines.push({ label: "Crypto sales", category: "Final income tax", baseLocal: 0, rate: "1%", taxLocal: 0, rule: "PMK 50/2025", explanation: "No sales in this year." });

    return buildResult(input, {
      country: "ID",
      version: VERSION,
      rulesEffective: "PMK 50/2025 from 1 Aug 2025",
      currency: "IDR",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: valueBefore + valueAfter,
      lines,
      methodology: [
        "Events converted to IDR at the ECB reference rate on each date.",
        "Tax base = gross value of each disposal (perp closes at notional value; prediction-market sells and redemptions at proceeds).",
        "Final tax: no deduction for costs or losses.",
      ],
      assumptions: ["Indonesian tax resident.", "Hyperliquid and Polymarket are foreign platforms not appointed as collectors, so you pay the tax yourself."],
      uncertainties: [
        "PMK 50/2025 covers sales of crypto assets; law-firm and KPMG summaries describe spot trading only and do not mention futures or perpetuals. Applying it to perp fills is an assumption; derivatives could instead fall under general income tax.",
        "It is unclear whether every perp fill or only position-reducing fills count as a 'sale'; closing fills are used here.",
        "Before Aug 2025, buyers on unregistered platforms also owed 0.22% VAT on purchases; not modelled.",
        ...(b.nft.count ? ["NFT sales are counted as crypto-asset sales. NFTs are not on Indonesia's list of tradable crypto assets, so they might instead be taxed as ordinary income at progressive rates."] : []),
      ],
      missing: b.missing,
      reporting: ["Self-payment of final PPh by the 15th of the following month", "Report in your annual SPT"],
      references: [
        { title: "DJP: PMK 50/2025 — new era of crypto taxation", url: "https://www.pajak.go.id/id/artikel/pmk-502025-babak-baru-pemajakan-aset-kripto" },
        { title: "KPMG: Indonesia updated tax rates for crypto transactions", url: "https://kpmg.com/us/en/taxnewsflash/news/2025/11/tnf-indonesia-updated-tax-rates-for-cryptoasset-transactions.html" },
      ],
      carry: 0,
      unsupportedYear: unsupported,
      provisional: "Derivatives treatment under PMK 50/2025 not confirmed from the regulation text",
    });
  },
};
