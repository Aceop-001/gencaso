import { basics, buildResult, fiscalYear, money, money0, sum, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Sri Lanka — the Inland Revenue Department treats crypto as an intangible investment asset:
 * gains are subject to capital gains tax (Inland Revenue Act 2017). Rate 10%, raised to 15% for
 * individuals by Inland Revenue (Amendment) Act No. 11 of 2026 (certified 3 June, published 5 June 2026).
 * Module v1.0.0. Year of assessment 1 April – 31 March.
 */

const VERSION = "LK-1.2.0";
const YEARS: Record<string, null> = { "2024/25": null, "2025/26": null, "2026/27": null };
const CHANGE = Date.UTC(2026, 5, 3); // Amendment Act No. 11 of 2026 certified 3 June 2026
// Small-gains exemption for resident individuals: no CGT if each gain ≤ Rs 50,000 and the year's total ≤ Rs 600,000
const SMALL_GAIN = 50_000;
const SMALL_TOTAL = 600_000;

const lkr = (n: number) => money0(n, "LKR", "en-LK");

export const SriLanka: Jurisdiction = {
  code: "LK",
  name: "Sri Lanka",
  flag: "🇱🇰",
  currency: "LKR",
  locale: "en-LK",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: (ms) => fiscalYear(ms, 3, 1, (y) => `${y}/${String((y + 1) % 100).padStart(2, "0")}`),
  calculate(input) {
    const { unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "LKR");
    const gain = (from: number, to: number) =>
      sum(b.rows.filter((r) => r.e.timestamp >= from && r.e.timestamp < to), (r) => r.realized + r.funding - r.fee + r.reward);
    const before = gain(-Infinity, CHANGE);
    const after = gain(CHANGE, Infinity);
    const net = before + after;
    // Blend the two rates by where the year's gains arose
    const pos = Math.max(0, before) + Math.max(0, after);
    const rate = pos ? (Math.max(0, before) * 0.1 + Math.max(0, after) * 0.15) / pos : 0.1;
    const biggest = Math.max(0, ...b.rows.map((r) => r.realized + r.funding - r.fee + r.reward));
    const smallExempt = net > 0 && net <= SMALL_TOTAL && biggest <= SMALL_GAIN;
    const taxDue = smallExempt ? 0 : Math.max(0, net) * rate;
    const lines: TaxLine[] = [
      {
        label: b.nft.count ? "Crypto gains (perps, prediction markets, NFTs, rewards)" : "Crypto gains (perps, prediction markets, rewards)",
        category: "Capital gains on investment assets",
        baseLocal: money(net),
        rate: before && after ? `10% → 15% (blended ${(rate * 100).toFixed(1)}%)` : `${(rate * 100).toFixed(0)}%`,
        taxLocal: money(taxDue),
        rule: "Inland Revenue Act No. 24 of 2017 s.37 and Fifth Schedule; Amendment Act No. 11 of 2026 (15% for individuals)",
        explanation: smallExempt
          ? `Net gain ${lkr(net)} is within the small-gains exemption (no single gain over Rs 50,000 and under Rs 600,000 in total), so no tax.`
          : net > 0 ? `Net gain ${lkr(net)}: gains before 3 June 2026 at 10%, from 3 June at 15%.` : `Net loss of ${lkr(-net)}: no tax.`,
      },
    ];

    return buildResult(input, {
      country: "LK",
      version: VERSION,
      rulesEffective: "CGT 15% for individuals from 3 June 2026 (Amendment Act No. 11 of 2026)",
      currency: "LKR",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: Math.max(0, net),
      lines,
      methodology: [
        "Events converted to LKR using daily rates from fawazahmed0's currency-api (the ECB publishes no LKR rate).",
        "All crypto results netted for the year of assessment; capital gains tax applied by date of gain.",
      ],
      assumptions: ["Sri Lankan resident individual.", "Investment activity (not a trading business)."],
      uncertainties: [
        "There is no crypto-specific statute; CGT treatment rests on the IRD treating crypto as an intangible asset. Active traders may be taxed on business income at progressive rates (not modelled).",
        "The 15% rate applies from the date of enactment; under Article 79 of the Constitution a bill becomes law when the Speaker certifies it (3 June 2026), two days before the Gazette publication (5 June). Gains on 3–4 June could be argued either way.",
        "The small-gains exemption (each gain up to Rs 50,000, total up to Rs 600,000) is applied per closing trade; whether a perp fill counts as a separate asset is not settled.",
      ],
      missing: b.missing,
      reporting: ["CGT return and payment within the IRD's deadlines for each realisation"],
      references: [
        { title: "KPMG: Sri Lanka tax amendments enacted (June 2026)", url: "https://kpmg.com/us/en/taxnewsflash/news/2026/06/sri-lanka-tax-amendments-enacted.html" },
        { title: "Daily Mirror: crypto and Budget 2026", url: "https://www.dailymirror.lk/business/No-provisions-for-taxing-cryptocurrencies-in-Budget-2026-says-tax-expert/215-325611" },
      ],
      carry: 0,
      unsupportedYear: unsupported,
      provisional: "No crypto-specific law; CGT treatment per IRD practice",
    });
  },
};
