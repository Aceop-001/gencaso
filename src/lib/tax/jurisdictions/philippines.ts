import { bands, basics, buildResult, calendarYear, money, money0, progressiveTax, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Philippines — no crypto-specific statute; BIR/DOF position is that crypto gains are taxable
 * income at the graduated rates (TRAIN schedule from 2023). Module v1.0.0. Calendar year.
 */

const VERSION = "PH-1.1.0";
const RATES = bands([[250_000, 0], [400_000, 0.15], [800_000, 0.2], [2_000_000, 0.25], [8_000_000, 0.3], [Infinity, 0.35]]);
const YEARS: Record<string, null> = { "2024": null, "2025": null, "2026": null };

const php = (n: number) => money0(n, "PHP", "en-PH");

export const Philippines: Jurisdiction = {
  code: "PH",
  name: "Philippines",
  flag: "🇵🇭",
  currency: "PHP",
  locale: "en-PH",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "PHP");
    const lines: TaxLine[] = [];
    const income = b.perpNet + b.pmNet + b.nft.net + b.rewards;
    const taxDue = progressiveTax(b.other + Math.max(0, income), RATES) - progressiveTax(b.other, RATES);

    lines.push({
      label: b.nft.count ? "Crypto trading results (perps, prediction markets, NFTs, rewards)" : "Crypto trading results (perps, prediction markets, rewards)",
      category: "Taxable income — graduated rates",
      baseLocal: money(income),
      rate: "0–35%",
      taxLocal: money(taxDue),
      rule: "NIRC s.24(A) as amended by TRAIN (RA 10963), 2023 schedule; DOF/BIR statements that crypto gains are taxable",
      explanation: income > 0 ? `Net ${php(income)} added to your taxable income.` : `Net loss of ${php(-income)}: not deductible against other income in this estimate.`,
    });

    return buildResult(input, {
      country: "PH",
      version: VERSION,
      rulesEffective: "TRAIN graduated rates from 1 Jan 2023",
      currency: "PHP",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: Math.max(0, income),
      lines,
      methodology: ["Events converted to PHP at the ECB reference rate on each date.", "All crypto results netted for the year and taxed as ordinary income at the graduated rates."],
      assumptions: [`Resident citizen. Other taxable income entered: ${php(b.other)}.`, "Graduated rates (not the 8% optional rate for self-employed)."],
      uncertainties: [
        "There is no crypto-specific BIR issuance; some advisers treat crypto as a capital asset with loss limits. Ordinary-income treatment is assumed.",
        "Prediction-market winnings from a foreign platform might instead be a prize/winnings subject to 20% final tax.",
      ],
      missing: b.missing,
      reporting: ["BIR Form 1700/1701 annual return by 15 April"],
      references: [
        { title: "PwC: Philippines individual taxes", url: "https://taxsummaries.pwc.com/philippines/individual/taxes-on-personal-income" },
        { title: "Grant Thornton: Taxing income from cryptocurrencies", url: "https://www.grantthornton.com.ph/insights/articles-and-updates1/lets-talk-tax/taxing-income-from-cryptocurrencies/" },
      ],
      carry: 0,
      unsupportedYear: unsupported,
    });
  },
};
