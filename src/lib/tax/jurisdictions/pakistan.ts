import { bands, basics, buildResult, fiscalYear, money, money0, progressiveTax, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Pakistan — no crypto-specific rate: a crypto CGT was floated for Budget 2026-27 but the Finance
 * Act 2026 (in force 1 July 2026) did not include it. Under existing law officials treat gains on sales as capital gains (s.37),
 * included in taxable income at the normal slab rates. Module v1.0.0.
 * Tax year 1 July – 30 June, named by the year it ends ("TY2026" = Jul 2025 – Jun 2026).
 */

const VERSION = "PK-1.2.0";
// Non-salaried individuals: unchanged by the Finance Act 2026 (which cut only salaried slabs);
// the 10% surcharge above ₨10m was removed for salaried people only
const SLABS = bands([[600_000, 0], [1_200_000, 0.15], [1_600_000, 0.2], [3_200_000, 0.3], [5_600_000, 0.4], [Infinity, 0.45]]);
const SURCHARGE_ABOVE = 10_000_000;
const YEARS: Record<string, null> = { TY2026: null, TY2027: null };

const pkr = (n: number) => money0(n, "PKR", "en-PK");
const tax = (x: number) => progressiveTax(x, SLABS) * (x > SURCHARGE_ABOVE ? 1.1 : 1);

export const Pakistan: Jurisdiction = {
  code: "PK",
  name: "Pakistan",
  flag: "🇵🇰",
  currency: "PKR",
  locale: "en-PK",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: (ms) => fiscalYear(ms, 6, 1, (y) => `TY${y + 1}`),
  calculate(input) {
    const { unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "PKR");
    const lines: TaxLine[] = [];
    const gains = b.perpNet + b.pmNet + b.nft.net + b.rewards;
    const taxDue = tax(b.other + Math.max(0, gains)) - tax(b.other);

    lines.push({
      label: b.nft.count ? "Crypto gains (perps, prediction markets, NFTs, rewards)" : "Crypto gains (perps, prediction markets, rewards)",
      category: "Capital gains — included in taxable income",
      baseLocal: money(gains),
      rate: "0–45% slabs (+10% surcharge above ₨10m)",
      taxLocal: money(taxDue),
      rule: "Income Tax Ordinance 2001 s.37(1); First Schedule Part I Div I (non-salaried)",
      explanation: gains > 0 ? `Net ${pkr(gains)} added to your taxable income at the slab rates.` : `Net loss of ${pkr(-gains)}: capital losses are not set off against other income.`,
    });

    return buildResult(input, {
      country: "PK",
      version: VERSION,
      rulesEffective: "Non-salaried slabs, unchanged by the Finance Act 2026 (from 1 July 2026); no crypto-specific rate",
      currency: "PKR",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: Math.max(0, gains),
      lines,
      methodology: [
        "Events converted to PKR using daily rates from fawazahmed0's currency-api (the ECB publishes no PKR rate).",
        "All crypto results netted for the tax year and taxed as capital gains at the non-salaried slab rates.",
      ],
      assumptions: [`Pakistani resident, non-salaried. Other taxable income entered: ${pkr(b.other)}.`, "Assets held under a year: gains included in full (no 25% reduction)."],
      uncertainties: [
        "A crypto-specific capital gains tax (proposed s.37C, reported at 10–30%) was planned for Budget 2026-27; I could not confirm it was enacted. If it was, the rate here is wrong.",
        "Salaried taxpayers use a different slab table; not modelled.",
      ],
      missing: b.missing,
      reporting: ["Annual return of income (IRIS) by 30 September", "Wealth statement including crypto holdings"],
      references: [
        { title: "PwC: Pakistan individual taxes", url: "https://taxsummaries.pwc.com/pakistan/individual/taxes-on-personal-income" },
        { title: "Arab News: Pakistan considers 10–20% crypto gains tax (June 2026)", url: "https://www.arabnews.pk/node/2646604" },
      ],
      carry: -gains,
      unsupportedYear: unsupported,
      provisional: "No crypto-specific tax; the crypto CGT floated for Budget 2026-27 was not enacted",
    });
  },
};
