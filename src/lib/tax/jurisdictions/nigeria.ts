import { bands, basics, buildResult, calendarYear, money, money0, progressiveTax, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Nigeria — 2025: digital assets are chargeable assets, 10% CGT (Finance Act 2023).
 * From 1 Jan 2026 (Nigeria Tax Act 2025): gains on digital assets are taxed at the person's
 * income tax rates; digital-asset losses offset only digital-asset gains. Module v1.0.0. Calendar year.
 */

const VERSION = "NG-1.2.0";
const PIT_2026 = bands([[800_000, 0], [3_000_000, 0.15], [12_000_000, 0.18], [25_000_000, 0.21], [50_000_000, 0.23], [Infinity, 0.25]]);
// 2025 (Personal Income Tax Act, Sixth Schedule) on income after the consolidated relief allowance
const PITA_2025 = bands([[300_000, 0.07], [600_000, 0.11], [1_100_000, 0.15], [1_600_000, 0.19], [3_200_000, 0.21], [Infinity, 0.24]]);
/** PITA s.33(1A): relief of the higher of ₦200,000 or 1% of gross income, plus 20% of gross income */
const pita2025 = (gross: number) => (gross <= 0 ? 0 : progressiveTax(Math.max(0, gross - Math.max(200_000, gross * 0.01) - gross * 0.2), PITA_2025));
const YEARS: Record<string, { regime: "cgt10" | "income" }> = { "2025": { regime: "cgt10" }, "2026": { regime: "income" } };

const naira = (n: number) => money0(n, "NGN", "en-NG");

export const Nigeria: Jurisdiction = {
  code: "NG",
  name: "Nigeria",
  flag: "🇳🇬",
  currency: "NGN",
  locale: "en-NG",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { p, unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "NGN");
    const lines: TaxLine[] = [];
    const gains = b.perpNet + b.pmNet + b.nft.net; // NFTs are digital assets too
    let taxDue: number;
    if (p.regime === "cgt10") {
      taxDue = Math.max(0, gains) * 0.1;
      lines.push({
        label: b.nft.count ? "Digital asset gains (perps, prediction markets, NFTs)" : "Digital asset gains (perps + prediction markets)",
        category: "Chargeable gains — CGT",
        baseLocal: money(gains),
        rate: "10%",
        taxLocal: money(taxDue),
        rule: "Capital Gains Tax Act s.3 as amended by Finance Act 2023 (digital assets)",
        explanation: gains > 0 ? `Net gain ${naira(gains)} at 10%.` : `Net loss of ${naira(-gains)}: no CGT.`,
      });
      if (b.rewards) {
        const rewardTax = pita2025(b.other + b.rewards) - pita2025(b.other);
        taxDue += rewardTax;
        lines.push({ label: "Rewards", category: "Personal income tax", baseLocal: money(b.rewards), rate: "7–24% after relief allowance", taxLocal: money(rewardTax), rule: "Personal Income Tax Act s.33 and Sixth Schedule (2025)", explanation: `Rewards added to your other income (${naira(b.other)}); after the consolidated relief allowance (₦200,000 or 1% of income, plus 20%), taxed at the 2025 bands.` });
      }
    } else {
      const income = gains + b.rewards;
      taxDue = progressiveTax(b.other + Math.max(0, income), PIT_2026) - progressiveTax(b.other, PIT_2026);
      lines.push({
        label: "Digital asset gains & rewards",
        category: "Taxed at personal income tax rates",
        baseLocal: money(income),
        rate: "0–25%",
        taxLocal: money(taxDue),
        rule: "Nigeria Tax Act 2025 (chargeable gains at income rates; Fourth Schedule bands)",
        explanation: income > 0 ? `Net ${naira(income)} added to your income and taxed at the 2026 bands.` : `Net loss of ${naira(-income)}: offsets only digital-asset gains.`,
      });
    }

    return buildResult(input, {
      country: "NG",
      version: VERSION,
      rulesEffective: "Finance Act 2023 (2025); Nigeria Tax Act 2025 (from 1 Jan 2026)",
      currency: "NGN",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: p.regime === "cgt10" ? Math.max(0, gains) + b.rewards : Math.max(0, gains + b.rewards),
      lines,
      methodology: [
        "Events converted to NGN using daily rates from fawazahmed0's currency-api (the ECB publishes no NGN rate).",
        "Perps and prediction markets netted for the calendar year.",
      ],
      assumptions: [`Nigerian resident. Other taxable income entered: ${naira(b.other)}.`, "Reliefs (e.g. rent relief) are not modelled."],
      uncertainties: [
        "Prediction-market results are treated as digital-asset gains; they could instead be betting winnings.",
        "Perpetual contracts are treated as dispositions of digital assets.",
      ],
      missing: b.missing,
      reporting: ["Annual self-assessment return with your State Internal Revenue Service by 31 March"],
      references: [
        { title: "Nigeria Tax Act 2025 (text)", url: "https://africacheck.org/sites/default/files/media/documents/2025-07/NIGERIA-TAX-ACT-2025.pdf" },
        { title: "PwC: Nigeria individual taxes", url: "https://taxsummaries.pwc.com/nigeria/individual/taxes-on-personal-income" },
      ],
      carry: -gains,
      unsupportedYear: unsupported,
    });
  },
};
