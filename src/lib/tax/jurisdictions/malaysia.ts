import { bands, basics, buildResult, calendarYear, money, money0, nftUncertainties, progressiveTax, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Malaysia — no capital gains tax on crypto for individual investors; gains of someone trading
 * as a business (badges of trade) are income at resident progressive rates. Module v1.0.0.
 * Year of assessment = calendar year.
 */

const VERSION = "MY-1.1.0";
// Resident rates from YA2023 (PwC, reviewed June 2026)
const RATES = bands([[5_000, 0], [20_000, 0.01], [35_000, 0.03], [50_000, 0.06], [70_000, 0.11], [100_000, 0.19], [400_000, 0.25], [600_000, 0.26], [2_000_000, 0.28], [Infinity, 0.3]]);
const YEARS: Record<string, null> = { "2024": null, "2025": null, "2026": null };

const rm = (n: number) => money0(n, "MYR", "en-MY");

export const Malaysia: Jurisdiction = {
  code: "MY",
  name: "Malaysia",
  flag: "🇲🇾",
  currency: "MYR",
  locale: "en-MY",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "MYR");
    const lines: TaxLine[] = [];
    const uncertainties: string[] = [];
    const income = b.business ? b.perpNet + b.nft.net + b.rewards : 0;
    const taxDue = progressiveTax(b.other + Math.max(0, income), RATES) - progressiveTax(b.other, RATES);

    lines.push(
      b.business
        ? {
            label: b.nft.count ? "Perpetual DEX, NFT trading profits & rewards" : "Perpetual DEX trading profits & rewards",
            category: "Business income",
            baseLocal: money(income),
            rate: "0–30%",
            taxLocal: money(taxDue),
            rule: "Income Tax Act 1967 s.4(a); IRBM guidelines on digital currency transactions",
            explanation: income > 0 ? `Net profit ${rm(income)} added to your chargeable income.` : `Business loss of ${rm(-income)}: can offset other business income (not modelled).`,
          }
        : {
            label: b.nft.count ? "Perpetual DEX and NFT results" : "Perpetual DEX results",
            category: "Capital gains — not taxable",
            baseLocal: money(b.perpNet + b.nft.net),
            rate: "0%",
            taxLocal: 0,
            rule: "No capital gains tax on crypto for individuals (CGT covers only real property and unlisted shares)",
            explanation: "Gains from investment-type trading are capital in nature; losses are likewise not deductible.",
          },
    );
    if (b.markets.length)
      lines.push({ label: "Prediction market results", category: "Gambling winnings — not taxable", baseLocal: money(b.pmNet), rate: "0%", taxLocal: 0, rule: "Gambling winnings are not income under the Income Tax Act 1967 unless a business", explanation: "Winnings are not taxed and losses are not deductible." });
    uncertainties.push(...nftUncertainties(b.nft));
    if (!b.business) {
      uncertainties.push("LHDN applies 'badges of trade': frequent, short-term or leveraged trading may be business income. Switch the trader type to 'Business' to see that treatment.");
      if (b.rewards) uncertainties.push("Rewards are not taxed in this estimate; LHDN may treat staking/incentive rewards as income.");
    }

    return buildResult(input, {
      country: "MY",
      version: VERSION,
      rulesEffective: "Resident rates from YA2023",
      currency: "MYR",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: Math.max(0, income),
      lines,
      methodology: ["Events converted to MYR at the ECB reference rate on each date.", "Individual investors: no tax on crypto capital gains or gambling winnings.", "Business traders: net profit added to chargeable income at resident rates."],
      assumptions: [`Malaysian tax resident. Other chargeable income entered (after reliefs): ${rm(b.other)}.`],
      uncertainties,
      missing: b.missing,
      reporting: b.business ? ["Form B (business income) by 30 June"] : ["No reporting for capital gains; keep records in case LHDN reviews the activity"],
      references: [
        { title: "IRBM: Guidelines on the tax treatment of digital currency transactions (copy)", url: "https://ccs-co.com/wp-content/uploads/152.1-Guidelines-on-the-tax-treatment-of-Digital-Currency-Transactions.pdf" },
        { title: "PwC: Malaysia individual taxes", url: "https://taxsummaries.pwc.com/malaysia/individual/taxes-on-personal-income" },
      ],
      carry: b.business ? -income : 0,
      unsupportedYear: unsupported,
    });
  },
};
