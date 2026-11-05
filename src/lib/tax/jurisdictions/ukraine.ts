import { basics, buildResult, calendarYear, money, money0, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Ukraine — no virtual-asset tax regime in force yet: draft law No. 10225-d (18% PIT + 5% military
 * levy on annual profit, reduced 5% PIT in the first year) passed first reading on 3 Sept 2025.
 * Under the general rules, crypto profit is other income: 18% PIT plus military levy
 * (1.5%, raised to 5% from 1 Dec 2024). Module v1.0.0. Calendar year.
 */

const VERSION = "UA-1.1.0";
const PIT = 0.18;
const YEARS: Record<string, { levy: number }> = { "2025": { levy: 0.05 }, "2026": { levy: 0.05 } };

const uah = (n: number) => money0(n, "UAH", "uk-UA");

export const Ukraine: Jurisdiction = {
  code: "UA",
  name: "Ukraine",
  flag: "🇺🇦",
  currency: "UAH",
  locale: "uk-UA",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { p, unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "UAH");
    const profit = b.perpNet + b.pmNet + b.nft.net + b.rewards;
    const pit = Math.max(0, profit) * PIT;
    const levy = Math.max(0, profit) * p.levy;
    const lines: TaxLine[] = [
      {
        label: b.nft.count ? "Crypto profit (perps, prediction markets, NFTs, rewards)" : "Crypto profit (perps, prediction markets, rewards)",
        category: "Other income — personal income tax",
        baseLocal: money(profit),
        rate: "18%",
        taxLocal: money(pit),
        rule: "Tax Code of Ukraine art. 164.2.20 and 167.1 (other income)",
        explanation: profit > 0 ? `Net profit ${uah(profit)} at 18%.` : `Net loss of ${uah(-profit)}: no tax.`,
      },
      {
        label: "Military levy",
        category: "Military levy",
        baseLocal: money(Math.max(0, profit)),
        rate: `${p.levy * 100}%`,
        taxLocal: money(levy),
        rule: "Tax Code transitional provisions, subsection 10 of section XX (5% from 1 Dec 2024)",
        explanation: `${p.levy * 100}% on the same profit.`,
      },
    ];

    return buildResult(input, {
      country: "UA",
      version: VERSION,
      rulesEffective: "General PIT rules; virtual-asset law pending",
      currency: "UAH",
      rows: b.rows,
      taxLocal: pit + levy,
      taxableLocal: Math.max(0, profit),
      lines,
      methodology: [
        "Events converted to UAH using daily rates from fawazahmed0's currency-api (the ECB publishes no UAH rate).",
        "All crypto results netted for the year: 18% PIT plus 5% military levy on net profit.",
      ],
      assumptions: ["Ukrainian tax resident individual."],
      uncertainties: [
        "Draft law No. 10225-d had not passed second reading as of November 2026. If enacted, its first-year 5% PIT rate on profit from conversions to fiat could apply instead.",
        "Without a specific regime, whether costs and losses can be deducted is unclear; net annual profit is assumed.",
      ],
      missing: b.missing,
      reporting: ["Annual property and income declaration by 1 May of the following year"],
      references: [
        { title: "EY Ukraine: virtual assets taxation bill approved by committee", url: "https://www.ey.com/en_ua/it-tax-law-digest/the-draft-law-on-the-taxation-of-income-from-virtual-assets-approved-by-the-parliamentary-committee" },
        { title: "LIGA: Ukraine crypto tax draft law passes first reading", url: "https://finance.liga.net/en/cryptoeconomics/news/ukraine-to-tax-profits-from-cryptocurrencies-draft-law-passes-first-reading" },
      ],
      carry: 0,
      unsupportedYear: unsupported,
      provisional: "Virtual-asset tax law (10225-d) not yet passed; general 18% + 5% applied",
    });
  },
};
